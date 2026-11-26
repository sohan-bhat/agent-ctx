import { ITEM_BYTES, bytes, cut } from './caps.ts';

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
