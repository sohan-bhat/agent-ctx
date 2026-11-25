import { hierarchy, partition, type HierarchyRectangularNode } from 'd3-hierarchy';
import type { Point, Top } from './api';
import type { Block, Piece } from './model';

export interface Kind {
  key: string;
  label: string;
  match: (cat: string) => boolean;
}

export const KINDS: Kind[] = [
  { key: 'system', label: 'System and tools', match: (c) => c === 'system' },
  { key: 'memory', label: 'Memory and attachments', match: (c) => c === 'memory' || c === 'skills' },
  { key: 'prompts', label: 'Your prompts', match: (c) => c === 'prompts' },
  { key: 'replies', label: "Claude's replies", match: (c) => c === 'replies' },
  { key: 'tools', label: 'Tool results', match: (c) => c.startsWith('tool:') },
  { key: 'summary', label: 'Compaction summary', match: (c) => c === 'summary' },
];

export function toolName(cat: string): string {
  const name = cat.slice(5);
  return name.startsWith('mcp__') ? name.slice(5) : name;
}

const MILLION = ['claude-fable', 'claude-mythos', 'claude-opus-5', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-5'];
const TWO_HUNDRED = ['claude-haiku-4-5', 'claude-opus-4-5', 'claude-opus-4-1', 'claude-opus-4-2', 'claude-sonnet-4-5', 'claude-sonnet-4-2', 'claude-3'];

export function windowOf(model: string | undefined, peak: number): number | null {
  if (!model) return null;
  if (MILLION.some((m) => model.startsWith(m))) return 1_000_000;
  if (TWO_HUNDRED.some((m) => model.startsWith(m))) return peak > 200_000 ? 1_000_000 : 200_000;
  return null;
}

export interface Node {
  id: string;
  label: string;
  kind: string;
  own: number;
  children?: Node[];
  item?: Top;
  kept?: number;
}

export type Cell = HierarchyRectangularNode<Node>;

function factor(p: Point): number {
  return p.raw > 0 ? p.total / p.raw : 0;
}

function leaves(items: Top[], cats: string[], k: number, kind: string, cap: number): Node[] {
  const kids = items
    .filter((it) => it.tok > 0 && cats.includes(it.cat))
    .map((it, i): Node => ({ id: `${it.cat}#${i}#${it.label}`, label: it.label, kind, own: it.tok * k, item: it }));
  const sum = kids.reduce((a, c) => a + c.own, 0);
  if (sum <= cap || sum <= 0) return kids;
  return kids.map((c) => ({ ...c, own: (c.own * cap) / sum }));
}

function withRest(node: Node, total: number): Node {
  const kids = node.children ?? [];
  const sum = kids.reduce((a, c) => a + c.own + (c.children ?? []).reduce((x, y) => x + y.own, 0), 0);
  return { ...node, own: Math.max(0, total - sum), children: kids.length ? kids : undefined };
}

export function tree(p: Point, items: Top[] = [], kept?: Record<string, number>): Node {
  const k = factor(p);
  const kinds: Node[] = [];
  for (const kind of KINDS) {
    const cats = Object.entries(p.est).filter(([c, v]) => v > 0 && kind.match(c));
    if (!cats.length) continue;
    const total = cats.reduce((a, [, v]) => a + v * k, 0);
    const keptTok = cats.reduce((a, [c, v]) => a + v * k * (kept?.[c] ?? 0), 0);
    let children: Node[];
    if (kind.key === 'tools') {
      children = cats.map(([cat, v]) => {
        const tok = v * k;
        return withRest({ id: cat, label: toolName(cat), kind: kind.key, own: 0, kept: kept ? kept[cat] ?? 0 : undefined, children: leaves(items, [cat], k, kind.key, tok) }, tok);
      });
    } else children = leaves(items, cats.map(([c]) => c), k, kind.key, total);
    kinds.push(withRest({ id: kind.key, label: kind.label, kind: kind.key, own: 0, kept: kept && total > 0 ? keptTok / total : undefined, children }, total));
  }
  return { id: 'used', label: 'Used', kind: 'used', own: 0, children: kinds };
}

export function layout(root: Node): Cell {
  const order = new Map(KINDS.map((k, i) => [k.key, i]));
  const h = hierarchy(root, (d) => d.children)
    .sum((d) => d.own)
    .sort((a, b) => (a.depth === 1 && b.depth === 1 ? (order.get(a.data.id) ?? 0) - (order.get(b.data.id) ?? 0) : (b.value ?? 0) - (a.value ?? 0)));
  return partition<Node>().size([1, 1])(h);
}

export function survival(before: Point, after: Point | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!after) return out;
  const kb = factor(before);
  const ka = factor(after);
  for (const [cat, v] of Object.entries(before.est)) {
    if (cat === 'summary' || v <= 0 || kb <= 0) continue;
    out[cat] = Math.min(1, ((after.est[cat] ?? 0) * ka) / (v * kb));
  }
  return out;
}

export function toolOf(cat: string): string {
  return cat.startsWith('tool:') ? toolName(cat) : cat;
}

export function nameOf(b: Block): string {
  if (b.members) return `${b.count} smaller items`;
  if (b.group) {
    if (b.cat === 'replies') return b.count === 1 ? 'Reply' : `${b.count} replies`;
    if (b.cat.startsWith('tool:')) return `${b.count} small ${toolOf(b.cat)} results`;
    return `${b.count} small attachments`;
  }
  return b.label || toolOf(b.cat);
}

export function shortOf(b: Block): string {
  if (b.members) return 'Smaller items';
  if (b.group) return b.cat === 'replies' ? 'Replies' : toolOf(b.cat);
  if (b.cat === 'system' && b.label.startsWith('System prompt')) return 'System prompt';
  if (b.cat === 'summary') return 'Summary';
  const l = b.label;
  if (l.startsWith('/')) return l.split('/').filter(Boolean).pop() ?? l;
  if (b.kind === 'prompts') {
    const words = l.split(/\s+/).slice(0, 4).join(' ');
    return words.length < l.length ? `${words}…` : words;
  }
  return l.length > 26 ? `${l.slice(0, 25)}…` : l;
}

function itemOf(b: Block, size: number): Top {
  const kind = b.file ? 'file' : b.cat === 'tool:Bash' && !b.group ? 'command' : b.kind === 'prompts' ? 'prompt' : 'other';
  return { label: b.group ? nameOf(b) : b.label, cat: b.cat, tok: size, kind };
}

export function treeOf(pieces: Piece[]): Node {
  const kinds: Node[] = [];
  for (const kind of KINDS) {
    const mine = pieces.filter((p) => p.block.kind === kind.key && p.state === 'stand' && p.size > 0);
    if (!mine.length) continue;
    const rows = new Map<string, Node>();
    for (const p of mine) {
      const key = p.block.group ? p.block.id : `${p.block.cat}\u0000${p.block.label}`;
      const row = rows.get(key);
      if (row) {
        row.own += p.size;
        row.item = { ...row.item!, tok: row.own, count: (row.item!.count ?? 1) + 1 };
        continue;
      }
      rows.set(key, { id: `${kind.key}#${key}`, label: nameOf(p.block), kind: kind.key, own: p.size, item: itemOf(p.block, p.size) });
    }
    let children = [...rows.values()];
    if (kind.key === 'tools') {
      const byCat = new Map<string, Node[]>();
      for (const n of children) byCat.set(n.item!.cat, [...(byCat.get(n.item!.cat) ?? []), n]);
      children = [...byCat].map(([cat, list]) => ({ id: cat, label: toolName(cat), kind: kind.key, own: 0, children: list }));
    }
    kinds.push({ id: kind.key, label: kind.label, kind: kind.key, own: 0, children });
  }
  return { id: 'used', label: 'Used', kind: 'used', own: 0, children: kinds };
}
