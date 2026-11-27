import { bytes, fit, type Body, type Item, type Kind, type Origin, type RuleBody, type Via } from '../../core/src/model.ts';
import { sanitizeItem } from '../../core/src/sanitize.ts';

export interface Rec { v: 1; at: number; device: string; op: 'put' | 'drop'; id: string; item?: Item }

type Obj = Record<string, unknown>;
type Timed = Item & { updated?: number };

const DEVICE = /^[a-z0-9-]{8,32}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FLAG = /^[a-z][a-z0-9_-]{0,31}$/;
const BREAK = /[\u0000-\u001F\u007F\u0085\u2028\u2029]/;
const LAST_MS = 253402300799999;
const LINE_BYTES = 8192;
const KINDS: Kind[] = ['card', 'handoff', 'rule', 'dropped'];
const VIAS: Via[] = ['hook', 'tool', 'page', 'import'];
const NEED: Record<Kind, string[]> = { card: ['goal'], handoff: ['goal', 'next'], rule: ['text'], dropped: ['label', 'text'] };

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= LAST_MS;
}

function plain(v: unknown): v is string {
  return typeof v === 'string' && v !== '' && !BREAK.test(v);
}

function needDevice(device: string): void {
  if (typeof device !== 'string' || !DEVICE.test(device)) throw new TypeError('A device id is 8 to 32 lower case letters, digits and hyphens.');
}

function asBody(kind: Kind, b: Obj): Body | null {
  const out: Obj = {};
  const text = (...keys: string[]): void => {
    for (const k of keys) if (typeof b[k] === 'string') out[k] = b[k];
  };
  const many = (...keys: string[]): void => {
    for (const k of keys) if (Array.isArray(b[k])) out[k] = (b[k] as unknown[]).filter((x) => typeof x === 'string');
  };
  const pairs = (key: string, need: string, more: string): void => {
    if (!Array.isArray(b[key])) return;
    out[key] = (b[key] as unknown[])
      .filter((x): x is Obj => isObj(x) && typeof x[need] === 'string')
      .map((x) => (typeof x[more] === 'string' ? { [need]: x[need], [more]: x[more] } : { [need]: x[need] }));
  };
  if (kind === 'card') {
    text('goal');
    pairs('changed', 'path', 'what');
    pairs('decisions', 'what', 'why');
    many('commands', 'dead_ends', 'open', 'prompts');
    text('last');
  } else if (kind === 'handoff') {
    text('goal', 'done', 'next');
    many('blockers', 'files');
    text('check', 'question', 'task');
  } else if (kind === 'rule') {
    text('text');
    out.words = typeof b.words === 'string' ? b.words : '';
    out.scope = b.scope === 'all' ? 'all' : 'project';
    out.status = b.status === 'active' || b.status === 'off' ? b.status : 'pending';
    if (b.proof === 'hook' || b.proof === 'elicit' || b.proof === 'page') out.proof = b.proof;
  } else {
    text('label', 'text');
    out.size = typeof b.size === 'number' && Number.isFinite(b.size) ? b.size : 0;
  }
  if ((kind === 'card' || kind === 'handoff') && typeof b.auto === 'boolean') out.auto = b.auto;
  return NEED[kind].every((k) => typeof out[k] === 'string') ? (out as unknown as Body) : null;
}

function asOrigin(o: unknown, created: number): Origin | null {
  if (!isObj(o) || !plain(o.agent)) return null;
  const out: Obj = { agent: o.agent };
  for (const k of ['model', 'machine', 'session']) if (plain(o[k])) out[k] = o[k];
  out.via = VIAS.includes(o.via as Via) ? o.via : 'import';
  out.source = o.source === 'person' || o.source === 'agent' ? o.source : 'untrusted';
  out.at = isTime(o.at) ? o.at : created;
  return out as unknown as Origin;
}

function asItem(x: unknown): Item | null {
  if (!isObj(x) || typeof x.id !== 'string' || !ID.test(x.id) || !plain(x.project)) return null;
  if (!KINDS.includes(x.kind as Kind) || !isObj(x.body) || !isTime(x.created)) return null;
  const kind = x.kind as Kind;
  const body = asBody(kind, x.body);
  const origin = asOrigin(x.origin, x.created);
  if (!body || !origin) return null;
  const flags = Array.isArray(x.flags) ? x.flags.filter((f): f is string => typeof f === 'string' && FLAG.test(f)) : [];
  return { id: x.id, project: x.project, kind, body, origin, flags, held: x.held === true, pinned: x.pinned === true, folded: x.folded === true, created: x.created };
}

function check(x: unknown): Rec | null {
  if (!isObj(x) || x.v !== 1 || !isTime(x.at) || typeof x.device !== 'string' || !DEVICE.test(x.device)) return null;
  if (typeof x.id !== 'string' || !ID.test(x.id)) return null;
  if (x.op === 'drop') return { v: 1, at: x.at, device: x.device, op: 'drop', id: x.id };
  if (x.op !== 'put') return null;
  const item = asItem(x.item);
  if (!item || item.id !== x.id) return null;
  return { v: 1, at: x.at, device: x.device, op: 'put', id: x.id, item };
}

export function line(rec: Rec): string {
  const ok = check(rec);
  if (!ok) throw new TypeError('A mirror record needs version 1, a time, a device id, an item id and one whole item for a put.');
  const text = JSON.stringify(ok).replace(/[\u0085\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  if (bytes(text) > LINE_BYTES) throw new RangeError('A mirror line is at most 8 KB long.');
  return text;
}

export function parse(text: string): { recs: Rec[]; bad: number } {
  const recs: Rec[] = [];
  let bad = 0;
  for (const raw of typeof text === 'string' ? text.split('\n') : []) {
    const row = raw.trim();
    if (!row) continue;
    let rec: Rec | null = null;
    if (row.length <= LINE_BYTES && bytes(row) <= LINE_BYTES) {
      try {
        rec = check(JSON.parse(row));
      } catch {
        rec = null;
      }
    }
    if (rec) recs.push(rec);
    else bad++;
  }
  return { recs, bad };
}

export function logPath(device: string, at: number): string {
  needDevice(device);
  if (!isTime(at)) throw new RangeError('The time of a mirror record is a count of milliseconds.');
  return `log/${device}/${new Date(at).toISOString().slice(0, 7)}.jsonl`;
}

function stamp(item: Item): number {
  const times = [item.created, item.origin?.at, (item as Timed).updated].filter(isTime);
  return times.length ? Math.max(...times) : 0;
}

function order(a: Rec, b: Rec): number {
  if (a.at !== b.at) return a.at - b.at;
  if (a.device !== b.device) return a.device < b.device ? -1 : 1;
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function outgoing(items: Item[], dropped: { id: string; at: number }[], since: number, device: string): Rec[] {
  needDevice(device);
  const from = typeof since === 'number' && !Number.isNaN(since) ? since : -Infinity;
  const out: Rec[] = [];
  const add = (rec: Rec | null): void => {
    if (rec && rec.at > from) out.push(rec);
  };
  for (const item of items ?? []) if (item) add(check({ v: 1, at: stamp(item), device, op: 'put', id: item.id, item: fit(item) }));
  for (const d of dropped ?? []) if (d) add(check({ v: 1, at: d.at, device, op: 'drop', id: d.id }));
  return out.sort(order);
}

function content(item: Item): string {
  const body: Obj = { ...(item.body as unknown as Obj) };
  if (item.kind === 'rule') {
    delete body.status;
    delete body.proof;
  }
  return JSON.stringify([item.kind, item.project, item.created, body]);
}

function arrive(raw: Item, known: Item | null): Item {
  const o = raw.origin;
  const side = sanitizeItem({ ...raw, kind: 'dropped', flags: [], held: false, body: { label: '', text: [raw.project, o.agent, o.model ?? '', o.machine ?? ''].join('\n'), size: 0 } });
  const origin: Origin = { ...o, via: o.via === 'page' ? 'import' : o.via, source: o.source === 'person' ? 'agent' : o.source };
  let next = sanitizeItem({ ...raw, origin, flags: [...new Set([...raw.flags, ...side.flags])], held: raw.held || side.held });
  if (next.kind === 'rule') {
    const { proof: _proof, ...rest } = next.body as RuleBody;
    next = { ...next, body: { ...rest, status: 'pending' } };
  }
  next = fit(next);
  if (known && content(known) === content(next)) next = { ...next, origin: known.origin, flags: known.flags, held: known.held, body: known.kind === 'rule' ? known.body : next.body };
  return asItem(next) ?? next;
}

export function merge(local: Item[], incoming: Rec[], device: string): { put: Item[]; hide: string[] } {
  needDevice(device);
  const best = new Map<string, Rec>();
  for (const raw of incoming ?? []) {
    const rec = check(raw);
    if (!rec || rec.device === device) continue;
    const now = best.get(rec.id);
    if (!now || order(rec, now) > 0) best.set(rec.id, rec);
  }
  const mine = new Map<string, Item>();
  for (const item of local ?? []) if (item) mine.set(item.id, item);
  const put: Item[] = [];
  const hide: string[] = [];
  for (const id of [...best.keys()].sort()) {
    const rec = best.get(id);
    if (!rec) continue;
    const here = mine.get(id);
    if (here) {
      const at = stamp(here);
      if (at > rec.at || (at === rec.at && device > rec.device)) continue;
    }
    if (rec.op === 'drop' || !rec.item) {
      hide.push(id);
      continue;
    }
    const known = here ? asItem(here) : null;
    const next = arrive(rec.item, known);
    if (known && JSON.stringify(known) === JSON.stringify(next)) continue;
    const taken: Timed = { ...next, updated: rec.at };
    put.push(taken);
  }
  return { put, hide };
}
