import { FOLD_AT, STORE_BYTES, cut, fit, itemBytes, itemText, type CardBody, type Item } from './model.ts';
import { stripOwn } from './sanitize.ts';
import { tokens } from './text.ts';

const TARGET = 0.7;
const DAY = 86400000;
const KEEP_DAYS = 30;

export interface Plan { fold: string[]; merge: { project: string; month: string; ids: string[] }[]; drop: string[] }

interface Unit { ids: string[]; created: number; bytes: number; merge?: Plan['merge'][number] }

export function totalBytes(items: Item[]): number {
  let n = 0;
  for (const i of items ?? []) n += itemBytes(i);
  return n;
}

function oneLine(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export function foldCard(item: Item): Item {
  const b = item.body as CardBody;
  const { agent, via, source, at } = item.origin;
  return { ...item, body: { goal: cut(oneLine(b.goal), 120) }, origin: { agent, via, source, at }, folded: true };
}

function month(ms: number): string {
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 7) : '0000-00';
}

function oldest(a: { created: number; ids?: string[]; id?: string }, b: { created: number; ids?: string[]; id?: string }): number {
  const ka = a.id ?? a.ids?.[0] ?? '';
  const kb = b.id ?? b.ids?.[0] ?? '';
  return a.created - b.created || (ka < kb ? -1 : ka > kb ? 1 : 0);
}

function recentHandoff(i: Item, now: number): boolean {
  return i.kind === 'handoff' && i.created > now - KEEP_DAYS * DAY;
}

export function isProtected(i: Item, now: number = Date.now()): boolean {
  return i.pinned || i.kind === 'rule' || recentHandoff(i, now);
}

export function foldPlan(items: Item[], limit: number = STORE_BYTES, at: number = FOLD_AT, now: number = Date.now()): Plan {
  const list = items ?? [];
  let total = totalBytes(list);
  const mark = at * limit;
  const target = TARGET * limit;
  const plan: Plan = { fold: [], merge: [], drop: [] };
  if (total <= mark) return plan;
  const cards = list.filter((i) => i.kind === 'card' && !i.pinned).sort(oldest);
  const folded = new Map<string, Item>();
  for (const i of cards) if (i.folded) folded.set(i.id, i);
  for (const i of cards) {
    if (total < target) break;
    if (i.folded) continue;
    const f = foldCard(i);
    total += itemBytes(f) - itemBytes(i);
    folded.set(i.id, f);
    plan.fold.push(i.id);
  }
  if (cards.some((i) => !folded.has(i.id)) || total <= mark) return plan;

  const groups = new Map<string, Item[]>();
  for (const i of cards) {
    const key = `${month(i.created)}\u0001${i.project}`;
    const g = groups.get(key) ?? [];
    g.push(folded.get(i.id) as Item);
    groups.set(key, g);
  }
  const units: Unit[] = [];
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key) as Item[];
    if (total >= target && g.length >= 2) {
      const merged = mergeFolded(g);
      const bytes = itemBytes(merged);
      total += bytes - totalBytes(g);
      const [m, project] = key.split('\u0001');
      const entry = { project, month: m, ids: g.map((i) => i.id) };
      plan.merge.push(entry);
      units.push({ ids: entry.ids, created: g[0].created, bytes, merge: entry });
    } else {
      for (const i of g) units.push({ ids: [i.id], created: i.created, bytes: itemBytes(i) });
    }
  }
  if (total <= mark) return plan;

  const dropped = new Set<string>();
  for (const u of units.sort(oldest)) {
    if (total < target) break;
    if (u.merge) plan.merge = plan.merge.filter((m) => m !== u.merge);
    for (const id of u.ids) dropped.add(id);
    total -= u.bytes;
  }
  const old = now - KEEP_DAYS * DAY;
  const rest = list.filter((i) => !i.pinned && !dropped.has(i.id) && (i.kind === 'handoff' || i.kind === 'dropped'));
  const late = [
    ...rest.filter((i) => i.created <= old).sort(oldest),
    ...rest.filter((i) => i.kind === 'dropped' && i.created > old).sort(oldest),
  ];
  for (const i of late) {
    if (total < target) break;
    dropped.add(i.id);
    total -= itemBytes(i);
  }
  plan.drop = list.filter((i) => dropped.has(i.id)).map((i) => i.id);
  return plan;
}

export function applyPlan(items: Item[], plan: Plan): Item[] {
  const list = items ?? [];
  const drop = new Set(plan.drop ?? []);
  const fold = new Set(plan.fold ?? []);
  const byId = new Map<string, Item>();
  for (const i of list) byId.set(i.id, fold.has(i.id) ? foldCard(i) : i);
  const lead = new Map<string, Item>();
  const merged = new Set<string>();
  for (const m of plan.merge ?? []) {
    const group = m.ids.filter((id) => !drop.has(id) && !merged.has(id)).map((id) => byId.get(id)).filter((i): i is Item => !!i);
    if (group.length < 2) continue;
    for (const g of group) merged.add(g.id);
    lead.set(group[0].id, mergeFolded(group));
  }
  const out: Item[] = [];
  for (const i of list) {
    if (drop.has(i.id)) continue;
    if (merged.has(i.id)) {
      const m = lead.get(i.id);
      if (m) out.push(m);
      continue;
    }
    out.push(byId.get(i.id) as Item);
  }
  return out;
}

export function underCeiling(items: Item[], limit: number = STORE_BYTES, now: number = Date.now()): { items: Item[]; full: boolean } {
  let cur = items ?? [];
  for (let round = 0; round < 4 && totalBytes(cur) > FOLD_AT * limit; round++) {
    const plan = foldPlan(cur, limit, FOLD_AT, now);
    if (!plan.fold.length && !plan.merge.length && !plan.drop.length) break;
    cur = applyPlan(cur, plan);
  }
  const full = totalBytes(cur) > limit && cur.every((i) => isProtected(i, now));
  return { items: cur, full };
}

export function mergeFolded(items: Item[]): Item {
  const sorted = [...(items ?? [])].sort((a, b) => a.created - b.created);
  const first = sorted[0];
  const goals = sorted
    .flatMap((i) => String((i.body as CardBody)?.goal ?? '').split('\n'))
    .map((g) => cut(oneLine(g), 60))
    .filter(Boolean);
  const agents = [...new Set(sorted.map((i) => i.origin?.agent).filter(Boolean))];
  const created = first?.created ?? 0;
  const merged: Item = {
    id: crypto.randomUUID(),
    project: first?.project ?? '',
    kind: 'card',
    body: { goal: goals.join('\n') },
    origin: { agent: agents.join(', '), via: first?.origin?.via ?? 'tool', source: first?.origin?.source ?? 'agent', at: created },
    flags: [...new Set(sorted.flatMap((i) => i.flags ?? []))],
    held: sorted.some((i) => i.held),
    pinned: false,
    folded: true,
    created,
  };
  return fit(merged);
}

export const SAME_JACCARD = 0.65;
export const SAME_CONTAINS = 0.8;
export const SAME_MIN_TERMS = 12;

const LISTS = ['changed', 'decisions', 'dead_ends', 'open', 'commands', 'prompts'] as const;
type ListKey = (typeof LISTS)[number];

const known = new WeakMap<Item, Set<string>>();

function terms(i: Item): Set<string> {
  const hit = known.get(i);
  if (hit) return hit;
  const out = new Set(tokens(stripOwn(itemText(i))));
  known.set(i, out);
  return out;
}

export function overlap(a: Item, b: Item): { jaccard: number; contains: number; small: number } {
  const x = terms(a);
  const y = terms(b);
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  const small = Math.min(x.size, y.size);
  return { jaccard: shared / Math.max(1, x.size + y.size - shared), contains: shared / Math.max(1, small), small };
}

export function sameCard(a: Item, b: Item): boolean {
  if (!a || !b || a.kind !== 'card' || b.kind !== 'card' || a.project !== b.project || a.id === b.id) return false;
  const o = overlap(a, b);
  return o.small >= SAME_MIN_TERMS && o.jaccard >= SAME_JACCARD && o.contains >= SAME_CONTAINS;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function keyOf(k: ListKey, v: unknown): string {
  if (typeof v === 'string') return norm(v);
  const o = (v ?? {}) as Record<string, unknown>;
  if (k === 'changed') return norm(`${o.path ?? ''} ${o.what ?? ''}`);
  return norm(`${o.what ?? ''} ${o.why ?? ''}`);
}

function stated(goal: unknown): goal is string {
  return typeof goal === 'string' && goal.trim() !== '' && !/^not stated\.?$/i.test(goal.trim());
}

export function addedLines(old: CardBody, incoming: CardBody): number {
  let n = 0;
  for (const k of LISTS) {
    const have = new Set(((old[k] ?? []) as unknown[]).map((v) => keyOf(k, v)));
    for (const v of (incoming[k] ?? []) as unknown[]) if (keyOf(k, v) && !have.has(keyOf(k, v))) n++;
  }
  return n;
}

export function mergeCard(old: Item, incoming: Item, now: number): Item {
  const a = old.body as CardBody;
  const b = incoming.body as CardBody;
  if (!addedLines(a, b)) return old;
  const body: CardBody = { ...a, goal: stated(b.goal) ? b.goal : a.goal };
  for (const k of LISTS) {
    const seen = new Set<string>();
    const out: unknown[] = [];
    for (const v of [...((b[k] ?? []) as unknown[]), ...((a[k] ?? []) as unknown[])]) {
      const key = keyOf(k, v);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    if (out.length) (body as unknown as Record<string, unknown>)[k] = out;
  }
  if (typeof b.last === 'string' && b.last.trim()) body.last = b.last;
  const flags = [...new Set([...(old.flags ?? []), ...(incoming.flags ?? [])])];
  return fit({ ...old, body, flags, origin: { ...incoming.origin, at: now } });
}
