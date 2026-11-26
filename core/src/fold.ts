import { FOLD_AT, STORE_BYTES, cut } from './caps.ts';
import { fit, itemBytes, type CardBody, type Item } from './model.ts';

const TARGET = 0.7;

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

export function foldPlan(items: Item[], limit: number = STORE_BYTES, at: number = FOLD_AT): { fold: string[]; merge: { project: string; month: string; ids: string[] }[] } {
  const list = items ?? [];
  let total = totalBytes(list);
  const mark = at * limit;
  const target = TARGET * limit;
  const plan = { fold: [] as string[], merge: [] as { project: string; month: string; ids: string[] }[] };
  if (total <= mark) return plan;
  const cards = list.filter((i) => i.kind === 'card' && !i.pinned).sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
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
  const order = [...groups.keys()].sort();
  for (const key of order) {
    if (total < target) break;
    const g = groups.get(key) as Item[];
    if (g.length < 2) continue;
    const merged = mergeFolded(g);
    total += itemBytes(merged) - totalBytes(g);
    const [m, project] = key.split('\u0001');
    plan.merge.push({ project, month: m, ids: g.map((i) => i.id) });
  }
  return plan;
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
    flags: [],
    held: false,
    pinned: false,
    folded: true,
    created,
  };
  return fit(merged);
}
