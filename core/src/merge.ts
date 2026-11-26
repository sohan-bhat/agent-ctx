import { fit, itemText, type CardBody, type Item } from './model.ts';
import { stripOwn } from './sanitize.ts';
import { tokens } from './text.ts';

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
