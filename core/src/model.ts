import { redact } from './redact.ts';

export const ITEM_BYTES = 2048;
export const RESULT_CHARS = 600;
export const CALL_CHARS = 2400;
export const FIRST_CHARS = 3000;
export const RULE_MIN = 12;
export const RULE_MAX = 300;
export const RULE_PROMPT_MAX = 800;
export const RULES_AUTO_PER_DAY = 5;
export const RULES_SHOWN = 10;
export const STORE_BYTES = 10 * 1024 * 1024;
export const FOLD_AT = 0.8;

export function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  if (n < 2) return n < 1 ? '' : '…';
  let sl = s.slice(0, n - 1);
  if (/[\uD800-\uDBFF]$/.test(sl)) sl = sl.slice(0, -1);
  const sp = sl.lastIndexOf(' ');
  return (sp > n * 0.6 ? sl.slice(0, sp) : sl).trimEnd() + '…';
}

const encoder = new TextEncoder();

export function bytes(s: string): number {
  return encoder.encode(s).length;
}

export function clean(text: string, max: number): string {
  return cut(redact(text ?? ''), max);
}

export type Kind = 'card' | 'handoff' | 'rule' | 'dropped';
export type Via = 'hook' | 'tool' | 'page' | 'import';
export type Source = 'person' | 'agent' | 'untrusted';
export interface Origin { agent: string; model?: string; machine?: string; session?: string; via: Via; source: Source; at: number }
export interface Change { path: string; what?: string }
export interface Decision { what: string; why?: string }
export interface CardBody { goal: string; changed?: Change[]; decisions?: Decision[]; commands?: string[]; dead_ends?: string[]; open?: string[]; prompts?: string[]; last?: string; auto?: boolean }
export interface HandoffBody { goal: string; done?: string; next: string; blockers?: string[]; files?: string[]; check?: string; question?: string; task?: string; auto?: boolean }
export interface RuleBody { text: string; words: string; scope: 'project' | 'all'; status: 'active' | 'pending' | 'off'; proof?: 'hook' | 'elicit' | 'page' }
export interface DroppedBody { label: string; text: string; size: number }
export type Body = CardBody | HandoffBody | RuleBody | DroppedBody;
export interface Item { id: string; project: string; kind: Kind; body: Body; origin: Origin; flags: string[]; held: boolean; pinned: boolean; folded: boolean; created: number }

export function newItem(kind: Kind, project: string, body: Body, origin: Origin): Item {
  return { id: crypto.randomUUID(), project, kind, body, origin, flags: [], held: false, pinned: false, folded: false, created: origin.at };
}

function strings(v: unknown, out: string[]): void {
  if (typeof v === 'string') {
    if (v) out.push(v);
  } else if (Array.isArray(v)) {
    for (const x of v) strings(x, out);
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v)) strings(x, out);
  }
}

export function itemText(item: Item): string {
  const out: string[] = [];
  strings(item.body, out);
  return out.join('\n');
}

export function itemBytes(item: Item): number {
  return bytes(JSON.stringify(item.body));
}

type Rec = Record<string, unknown>;
type Step = (b: Rec, max: number) => void;

const FLOOR = 120;

function size(b: Rec): number {
  return bytes(JSON.stringify(b));
}

function drop(key: string): Step {
  return (b, max) => {
    const a = b[key];
    if (!Array.isArray(a)) return;
    while (a.length && size(b) > max) a.shift();
    if (!a.length) delete b[key];
  };
}

function shorten(key: string, floor: number, keep: boolean): Step {
  return (b, max) => {
    let s = b[key];
    while (typeof s === 'string' && s.length > floor && size(b) > max) {
      const over = size(b) - max;
      const n = Math.max(floor, s.length - Math.max(1, Math.ceil(over / 2)));
      s = n < 4 ? '' : cut(s, n);
      b[key] = s;
    }
    if (s === '' && !keep) delete b[key];
  };
}

const STEPS: Record<Kind, Step[]> = {
  card: [
    drop('prompts'),
    drop('commands'),
    drop('changed'),
    shorten('last', FLOOR, false),
    drop('dead_ends'),
    drop('open'),
    drop('decisions'),
    shorten('goal', FLOOR, true),
    shorten('last', 0, false),
    shorten('goal', 0, true),
  ],
  handoff: [
    drop('files'),
    drop('blockers'),
    shorten('done', FLOOR, false),
    shorten('check', FLOOR, false),
    shorten('question', FLOOR, false),
    shorten('next', FLOOR, true),
    shorten('goal', FLOOR, true),
    shorten('task', 0, false),
    shorten('done', 0, false),
    shorten('check', 0, false),
    shorten('question', 0, false),
    shorten('next', 0, true),
    shorten('goal', 0, true),
  ],
  rule: [shorten('text', FLOOR, true), shorten('words', FLOOR, true), shorten('text', 0, true), shorten('words', 0, true)],
  dropped: [shorten('text', FLOOR, true), shorten('label', 40, true), shorten('text', 0, true), shorten('label', 0, true)],
};

const REQUIRED: Record<Kind, string[]> = {
  card: ['goal'],
  handoff: ['goal', 'next'],
  rule: ['text', 'words', 'scope', 'status', 'proof'],
  dropped: ['label', 'text', 'size'],
};

export function fit(item: Item, max: number = ITEM_BYTES): Item {
  if (itemBytes(item) <= max) return item;
  const b = JSON.parse(JSON.stringify(item.body ?? {})) as Rec;
  const steps = STEPS[item.kind] ?? [];
  for (const step of steps) {
    if (size(b) <= max) break;
    step(b, max);
  }
  for (const key of Object.keys(b)) {
    if (size(b) <= max) break;
    if (!(REQUIRED[item.kind] ?? []).includes(key)) delete b[key];
  }
  return { ...item, body: b as unknown as Body };
}

export interface Known { paths: Record<string, string>; aliases: Record<string, string>; repos: string[] }

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;
const SCP = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)([^?#\s]+)/;
const DRIVE = /^[a-z]:(?:[\\/]|$)/i;

function cleanPath(host: string, path: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h || !/^[a-z0-9.-]+$/.test(h)) return null;
  const parts = path
    .split('/')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  if (parts.length && parts[parts.length - 1] === '.git') parts.pop();
  if (!parts.length) return null;
  const last = parts.length - 1;
  parts[last] = parts[last].replace(/\.git$/, '');
  if (!parts[last]) return null;
  return [h, ...parts].join('/');
}

export function cleanRemote(url: string): string | null {
  const s = (url ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  if (s.startsWith('/') || s.startsWith('.') || s.startsWith('~') || s.startsWith('\\') || DRIVE.test(s)) return null;
  if (/^folder:/i.test(s)) return null;
  const m = SCHEME.exec(s);
  if (m) {
    if (m[1].toLowerCase() === 'file') return null;
    const auth = m[2].slice(m[2].lastIndexOf('@') + 1).replace(/:\d*$/, '');
    return cleanPath(auth, m[3]);
  }
  const scp = SCP.exec(s);
  if (scp) return cleanPath(scp[1], scp[2]);
  const slash = s.indexOf('/');
  if (slash > 0) {
    const host = s.slice(0, slash);
    if (host.includes('.') && !host.includes('@') && !host.includes(':')) return cleanPath(host, s.slice(slash).replace(/[?#].*$/, ''));
  }
  return null;
}

export function folderName(path: string): string {
  const parts = (path ?? '')
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  if (/^[a-z]:$/i.test(last)) return '';
  return last.toLowerCase();
}

export function projectName(key: string): string {
  const k = key ?? '';
  if (k.startsWith('folder:')) return k.slice('folder:'.length);
  const parts = k.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export function resolveProject(input: { repo?: string; folder?: string }, known: Known): { key: string; learn?: { path?: string; alias?: string } } {
  const folder = (input.folder ?? '').trim();
  const name = folder ? folderName(folder) : '';
  const repo = input.repo ? cleanRemote(input.repo) : null;
  if (repo) {
    if (!folder) return { key: repo };
    return { key: repo, learn: { path: folder, ...(name ? { alias: name } : {}) } };
  }
  if (folder && Object.hasOwn(known.paths, folder)) return { key: known.paths[folder] };
  if (name && Object.hasOwn(known.aliases, name)) return { key: known.aliases[name] };
  if (name) {
    const same = known.repos.filter((r) => projectName(r) === name);
    if (same.length === 1) return { key: same[0] };
  }
  return { key: name ? `folder:${name}` : 'folder:unknown' };
}
