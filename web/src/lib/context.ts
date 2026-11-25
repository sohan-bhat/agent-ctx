import { hierarchy, partition, type HierarchyRectangularNode } from 'd3-hierarchy';
import type { Top } from './api';
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

export function layout(root: Node): Cell {
  const order = new Map(KINDS.map((k, i) => [k.key, i]));
  const h = hierarchy(root, (d) => d.children)
    .sum((d) => d.own)
    .sort((a, b) => (a.depth === 1 && b.depth === 1 ? (order.get(a.data.id) ?? 0) - (order.get(b.data.id) ?? 0) : (b.value ?? 0) - (a.value ?? 0)));
  return partition<Node>().size([1, 1])(h);
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

export function treeOf(pieces: Piece[], withKept = false): Node {
  const kinds: Node[] = [];
  const share = (all: number, stay: number) => (withKept && all > 0 ? stay / all : undefined);
  for (const kind of KINDS) {
    const mine = pieces.filter((p) => p.block.kind === kind.key && (withKept || p.state === 'stand') && p.size > 0);
    if (!mine.length) continue;
    const rows = new Map<string, Node>();
    const byCatSize = new Map<string, [number, number]>();
    let all = 0;
    let stay = 0;
    for (const p of mine) {
      const kept = p.state === 'stand' ? p.size : 0;
      all += p.size;
      stay += kept;
      const c = byCatSize.get(p.block.cat);
      if (c) {
        c[0] += p.size;
        c[1] += kept;
      } else byCatSize.set(p.block.cat, [p.size, kept]);
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
      for (const n of children) {
        const list = byCat.get(n.item!.cat);
        if (list) list.push(n);
        else byCat.set(n.item!.cat, [n]);
      }
      children = [...byCat].map(([cat, list]) => {
        const [a, k] = byCatSize.get(cat) ?? [0, 0];
        return { id: cat, label: toolName(cat), kind: kind.key, own: 0, kept: share(a, k), children: list };
      });
    }
    kinds.push({ id: kind.key, label: kind.label, kind: kind.key, own: 0, kept: share(all, stay), children });
  }
  return { id: 'used', label: 'Used', kind: 'used', own: 0, children: kinds };
}
