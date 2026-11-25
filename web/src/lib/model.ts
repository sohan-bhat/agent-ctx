import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';

export interface SpanRow {
  b: number;
  e?: number;
  c: number;
  t: number;
  l?: number;
  i?: number;
  u?: number;
  n?: number;
  s?: number[];
}

export interface Line {
  cats: string[];
  labels: string[];
  closed: SpanRow[];
  live: SpanRow[];
}

export type Kind = 'system' | 'memory' | 'prompts' | 'replies' | 'tools' | 'summary';

export const KIND_ORDER: Kind[] = ['system', 'memory', 'prompts', 'replies', 'tools', 'summary'];

export function kindOf(cat: string): Kind {
  if (cat.startsWith('tool:')) return 'tools';
  if (cat === 'system' || cat === 'prompts' || cat === 'replies' || cat === 'summary') return cat;
  return 'memory';
}

export interface Block {
  id: string;
  cat: string;
  kind: Kind;
  label: string;
  tok: number;
  birth: number;
  end?: number;
  count: number;
  group: boolean;
  file: boolean;
  members?: Block[];
}

export function tokAt(s: SpanRow, n: number): number {
  if (s.b > n || (s.e !== undefined && n >= s.e)) return 0;
  if (!s.s) return s.t;
  let sum = 0;
  for (let i = 0; i < s.s.length; i += 2) if (s.s[i] <= n) sum += s.s[i + 1];
  return sum;
}

function block(line: Line, s: SpanRow, id: string, tok: number): Block {
  const cat = line.cats[s.c] ?? 'other';
  const group = !!s.s;
  return {
    id,
    cat,
    kind: kindOf(cat),
    label: group || s.l === undefined ? '' : line.labels[s.l] ?? '',
    tok,
    birth: s.b,
    end: s.e,
    count: s.n ?? 1,
    group,
    file: !group && cat === 'tool:Read',
  };
}

export function spanId(s: SpanRow, index: number, closed: boolean): string {
  if (s.s) return `${s.c}@${s.u ?? 0}${s.e !== undefined ? `/${s.e}` : ''}`;
  return closed ? `c${index}` : `#${s.i ?? index}`;
}

export function blocksAt(line: Line, n: number): Block[] {
  const out: Block[] = [];
  line.closed.forEach((s, i) => {
    const tok = tokAt(s, n);
    if (tok > 0) out.push(block(line, s, spanId(s, i, true), tok));
  });
  line.live.forEach((s, i) => {
    const tok = tokAt(s, n);
    if (tok > 0) out.push(block(line, s, spanId(s, i, false), tok));
  });
  return out;
}

export type State = 'stand' | 'gone';

export interface Piece {
  block: Block;
  size: number;
  age: number;
  state: State;
}

export function piecesAt(line: Line, n: number, total: number): Piece[] {
  const blocks = blocksAt(line, n);
  const raw = blocks.reduce((a, b) => a + b.tok, 0);
  const k = raw > 0 ? total / raw : 0;
  return blocks.map((b) => ({ block: b, size: b.tok * k, age: Math.max(0, n - b.birth), state: 'stand' }));
}

export function piecesAround(line: Line, n: number, before: number, after: number): Piece[] {
  const now = piecesAt(line, n, after);
  const seen = new Set(now.map((p) => p.block.id));
  const prev = piecesAt(line, n - 1, before).filter((p) => !seen.has(p.block.id) && p.block.end === n);
  return [...now, ...prev.map((p): Piece => ({ ...p, state: 'gone' }))];
}

export interface Lot {
  piece: Piece;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface District {
  kind: Kind;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  size: number;
}

export interface Plan {
  side: number;
  region: number;
  total: number;
  window: number;
  lots: Lot[];
  districts: District[];
}

interface TreeNode {
  key: string;
  piece?: Piece;
  children?: TreeNode[];
}

export const SMALL_SHARE = 1 / 8000;

function merged(kind: Kind, small: Piece[]): Piece {
  const members = small.map((p) => p.block);
  const gone = small.every((p) => p.state === 'gone');
  return {
    block: {
      id: `${kind}~${gone ? 'gone' : 'small'}`,
      cat: kind === 'tools' ? 'tool:' : kind,
      kind,
      label: '',
      tok: members.reduce((a, b) => a + b.tok, 0),
      birth: Math.min(...members.map((b) => b.birth)),
      count: members.reduce((a, b) => a + b.count, 0),
      group: true,
      file: false,
      members,
    },
    size: small.reduce((a, p) => a + p.size, 0),
    age: 0,
    state: gone ? 'gone' : 'stand',
  };
}

export function plan(pieces: Piece[], window: number, side: number, smallShare = SMALL_SHARE): Plan {
  const total = pieces.reduce((a, p) => a + p.size, 0);
  const win = Math.max(window, total, 1);
  const region = side * Math.sqrt(total / win);
  const cut = win * smallShare;
  const kinds: TreeNode[] = [];
  for (const kind of KIND_ORDER) {
    const mine = pieces.filter((p) => p.block.kind === kind && p.size > 0);
    if (!mine.length) continue;
    const big: Piece[] = [];
    const small = { stand: [] as Piece[], gone: [] as Piece[] };
    for (const p of mine) {
      if (p.size >= cut || mine.length === 1) big.push(p);
      else small[p.state].push(p);
    }
    for (const list of [small.stand, small.gone]) {
      if (list.length === 1) big.push(list[0]);
      else if (list.length > 1) big.push(merged(kind, list));
    }
    let children: TreeNode[];
    if (kind === 'tools') {
      const byCat = new Map<string, Piece[]>();
      for (const p of big) {
        const key = p.block.members ? '~' : p.block.cat;
        byCat.set(key, [...(byCat.get(key) ?? []), p]);
      }
      children = [...byCat].map(([cat, list]) => ({ key: cat, children: list.map((p) => ({ key: p.block.id, piece: p })) }));
    } else children = big.map((p) => ({ key: p.block.id, piece: p }));
    kinds.push({ key: kind, children });
  }
  const order = new Map(KIND_ORDER.map((k, i) => [k, i]));
  const root = hierarchy<TreeNode>({ key: 'used', children: kinds }, (d) => d.children)
    .sum((d) => d.piece?.size ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || (a.depth === 1 ? (order.get(a.data.key as Kind) ?? 0) - (order.get(b.data.key as Kind) ?? 0) : a.data.key.localeCompare(b.data.key)));
  const laid = treemap<TreeNode>().tile(treemapSquarify.ratio(1)).size([region, region]).round(false)(root);
  const lots: Lot[] = [];
  const districts: District[] = [];
  for (const d of laid.descendants()) {
    if (d.depth === 1) districts.push({ kind: d.data.key as Kind, x0: d.x0, z0: d.y0, x1: d.x1, z1: d.y1, size: d.value ?? 0 });
    if (d.data.piece) lots.push({ piece: d.data.piece, x0: d.x0, z0: d.y0, x1: d.x1, z1: d.y1 });
  }
  return { side, region, total, window: win, lots, districts };
}

export const AGE_CAP = 1000;
export const AGE_TICKS = [1, 10, 100, 1000];

export function heightShare(age: number): number {
  return Math.log10(1 + Math.min(Math.max(0, age), AGE_CAP)) / Math.log10(1 + AGE_CAP);
}

export function siblingKey(b: Block): string | null {
  return b.group || !b.label ? null : `${b.cat}\u0000${b.label}`;
}
