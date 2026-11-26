import { hierarchy, treemap, treemapDice, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
import { Box3, Matrix4, Quaternion, Vector3, type OrthographicCamera } from 'three';
import type { CameraControlsImpl } from '@react-three/drei';
import { itemBytes } from '@core/model.ts';
import type { Item, Read, RuleBody } from '@/lib/types';

export const H_MIN = 0.08;
export const H_MAX = 1.6;
const POST = 1.19;
export const POST_W = 0.09;
export const CAP = 0.07;
export const FLAT = 0.012;
export const PLATE = 0.18;
export const EDGE = 0.045;
export const HOME = { theta: Math.PI / 4, phi: 0.98 };
const AREA = 1 / 1000;
const FILL = 0.72;
const MIN_SIDE = 3.2;
const GAP = 0.04;
const STREET = 0.24;
export const RIM = 0.4;

export type Look = 'solid' | 'cap' | 'post' | 'flat' | 'outline';

export interface District {
  plate: string;
  agent: string;
  slot: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Plate {
  key: string;
  name: string;
  cx: number;
  cz: number;
  side: number;
  districts: District[];
  corners: Vector3[];
}

export interface Placed {
  id: string;
  item: Item;
  look: Look;
  slot: number;
  plate: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
  y0: number;
  h: number;
  shown: boolean;
}

export interface Link {
  id: string;
  slot: number;
  at: number;
  a: [number, number];
  b: [number, number];
}

export interface Layout {
  plates: Plate[];
  placed: Placed[];
  links: Link[];
  box: Box3;
  corners: Vector3[];
  phi: number;
  top: number;
}

export interface LayoutInput {
  projects: { key: string; name: string }[];
  agents: string[];
  items: Item[];
  reads: Read[];
  aspect: number;
}

export function heightAt(age: number, span: number, top = H_MAX): number {
  if (age <= 0) return H_MIN;
  const share = Math.sqrt(age / Math.max(span, 60 * 60_000));
  return H_MIN + Math.min(1, share) * (top - H_MIN);
}

export function slotOf(agents: string[], label: string): number {
  const i = agents.indexOf(label);
  return i < 0 ? -1 : i;
}

function inDistrict(i: Item): boolean {
  return i.kind !== 'rule';
}

function ruleShown(i: Item): boolean {
  const s = (i.body as RuleBody).status;
  return i.kind === 'rule' && (s === 'active' || s === 'pending');
}

interface Leaf {
  id: string;
  area: number;
  created: number;
  children?: Leaf[];
}

function tile(items: Item[], agents: string[]): { leaves: Map<string, { x0: number; z0: number; x1: number; z1: number }>; districts: Omit<District, 'plate'>[]; side: number } {
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const list = groups.get(it.origin.agent);
    if (list) list.push(it);
    else groups.set(it.origin.agent, [it]);
  }
  const order = [...groups.keys()].sort((a, b) => slotOf(agents, a) - slotOf(agents, b) || (a < b ? -1 : 1));
  const total = items.reduce((s, it) => s + itemBytes(it) * AREA, 0);
  const side = Math.max(MIN_SIDE, Math.sqrt(total / FILL) + RIM * 2);
  const inner = side - RIM * 2;
  const root = hierarchy<Leaf>(
    {
      id: '',
      area: 0,
      created: 0,
      children: order.map((agent) => ({
        id: `@${agent}`,
        area: 0,
        created: Math.min(...groups.get(agent)!.map((i) => i.created)),
        children: groups.get(agent)!.map((i) => ({ id: i.id, area: itemBytes(i) * AREA, created: i.created })),
      })),
    },
    (d) => d.children,
  )
    .sum((d) => (d.children ? 0 : d.area))
    .sort((a, b) => (a.depth === 1 ? 0 : a.data.created - b.data.created));
  const tiler = (n: HierarchyRectangularNode<Leaf>, x0: number, y0: number, x1: number, y1: number) => (n.depth === 0 ? treemapDice(n, x0, y0, x1, y1) : treemapSquarify.ratio(1.3)(n, x0, y0, x1, y1));
  const laid = treemap<Leaf>().tile(tiler).size([inner, inner]).paddingInner((n) => (n.depth === 0 ? STREET : 0)).round(false)(root);
  const leaves = new Map<string, { x0: number; z0: number; x1: number; z1: number }>();
  const districts: Omit<District, 'plate'>[] = [];
  const o = -side / 2 + RIM;
  for (const n of laid.descendants()) {
    if (n.depth === 1) {
      const agent = n.data.id.slice(1);
      districts.push({ agent, slot: slotOf(agents, agent), x0: o + n.x0, z0: o + n.y0, x1: o + n.x1, z1: o + n.y1 });
    }
    if (n.depth === 2) leaves.set(n.data.id, { x0: o + n.x0, z0: o + n.y0, x1: o + n.x1, z1: o + n.y1 });
  }
  return { leaves, districts, side };
}

const GAP_SIDE = 0.9;
const GAP_ROW = 3.8;
const PHIS = [0.98, 0.92, 1.04, 0.86, 1.1, 0.8, 1.16, 0.74, 0.68, 0.62];

function arrange(sides: number[], cols: number): [number, number][] {
  const half = (s: number) => s / Math.SQRT2;
  const rows: { right: number[]; span: number }[] = [];
  for (let r = 0; r * cols < sides.length; r++) {
    const row = sides.slice(r * cols, r * cols + cols);
    const right: number[] = [];
    let at = 0;
    row.forEach((s, c) => {
      if (c > 0) at += half(row[c - 1]) + half(s) + GAP_SIDE;
      right.push(at);
    });
    rows.push({ right, span: at + half(row[0]) + half(row[row.length - 1]) });
  }
  const widest = Math.max(...rows.map((r) => r.span));
  const out: [number, number][] = [];
  let down = 0;
  rows.forEach((row, r) => {
    const deep = Math.max(...sides.slice(r * cols, r * cols + cols));
    if (r > 0) down += half(Math.max(...sides.slice((r - 1) * cols, r * cols))) + half(deep) + GAP_ROW;
    const shift = (widest - row.span) / 2;
    for (const at of row.right) out.push([(at + shift + down) * Math.SQRT1_2, (down - at - shift) * Math.SQRT1_2]);
  });
  return out;
}

function cornersOf(cx: number, cz: number, side: number, posts: [number, number][], top: number): Vector3[] {
  const out: Vector3[] = [];
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) for (const y of [-PLATE, 0, top]) out.push(new Vector3(cx + (dx * side) / 2, y, cz + (dz * side) / 2));
  for (const [x, z] of posts) out.push(new Vector3(cx + x, top * POST, cz + z));
  return out;
}

function extent(points: Vector3[], phi: number): [number, number] {
  const inv = viewQuat(HOME.theta, phi).invert();
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const v = new Vector3();
  for (const p of points) {
    v.copy(p).applyQuaternion(inv);
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y);
    y1 = Math.max(y1, v.y);
  }
  return [Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0)];
}

export function score(corners: Vector3[], phi: number, aspect: number): number {
  const [bw, bh] = extent(corners, phi);
  const [pw, ph] = extent(
    corners.filter((c) => c.y <= 0),
    phi,
  );
  const zoom = Math.min((aspect * 0.94) / bw, 0.9 / bh);
  const fw = (pw * zoom) / aspect;
  const fh = ph * zoom;
  const short = aspect >= 1 ? fh : fw;
  return Math.min(1, short / 0.73) * 3 + Math.min(fw, fh) * 1.5 - Math.abs(HOME.phi - phi);
}

export function bestPhi(corners: Vector3[], aspect: number): number {
  return PHIS.reduce((best, phi) => (score(corners, phi, aspect) > score(corners, best, aspect) + 1e-4 ? phi : best), PHIS[0]);
}

export function layout({ projects, agents, items, reads, aspect }: LayoutInput): Omit<Layout, 'placed'> & { base: Omit<Placed, 'h' | 'shown' | 'y0'>[] } {
  const keys = projects.map((p) => p.key);
  for (const it of items) if (!keys.includes(it.project)) keys.push(it.project);
  if (!keys.length) keys.push('');
  const byProject = new Map<string, Item[]>(keys.map((k) => [k, []]));
  for (const it of items) byProject.get(it.project)!.push(it);
  const tiles = keys.map((k) => tile(byProject.get(k)!.filter(inDistrict), agents));
  const rulesOf = keys.map((k) => byProject.get(k)!.filter(ruleShown).sort((a, b) => a.created - b.created));
  const posts = tiles.map((t, i) => {
    const step = Math.min(0.3, (t.side - RIM) / Math.max(1, rulesOf[i].length));
    return rulesOf[i].map((_, j): [number, number] => [-t.side / 2 + RIM / 2 + j * step, -t.side / 2 + RIM / 2]);
  });
  const sides = tiles.map((t) => t.side);
  const top = Math.min(H_MAX, Math.max(0.9, 0.26 * Math.max(...sides)));
  let best = { s: -Infinity, centres: arrange(sides, 1), phi: HOME.phi };
  for (let cols = 1; cols <= Math.min(keys.length, 6); cols++) {
    const centres = arrange(sides, cols);
    const all = centres.flatMap(([cx, cz], i) => cornersOf(cx, cz, sides[i], posts[i], top));
    for (const phi of PHIS) {
      const s = score(all, phi, aspect);
      if (s > best.s + 1e-4) best = { s, centres, phi };
    }
  }
  const plates: Plate[] = [];
  const base: Omit<Placed, 'h' | 'shown' | 'y0'>[] = [];
  const links: Link[] = [];
  const box = new Box3();
  keys.forEach((key, pi) => {
    const t = tiles[pi];
    const [cx, cz] = best.centres[pi];
    const name = projects.find((p) => p.key === key)?.name ?? key.split('/').pop() ?? key;
    const districts = t.districts.map((d) => ({ ...d, plate: key, x0: d.x0 + cx, x1: d.x1 + cx, z0: d.z0 + cz, z1: d.z1 + cz }));
    plates.push({ key, name, cx, cz, side: t.side, districts, corners: cornersOf(cx, cz, t.side, posts[pi], top) });
    box.expandByPoint(new Vector3(cx - t.side / 2, -PLATE, cz - t.side / 2));
    box.expandByPoint(new Vector3(cx + t.side / 2, top, cz + t.side / 2));
    const list = byProject.get(key)!;
    for (const it of list) {
      const slot = slotOf(agents, it.origin.agent);
      if (it.kind === 'rule') continue;
      const r = t.leaves.get(it.id);
      if (!r) continue;
      const w = Math.max(0.06, r.x1 - r.x0 - GAP * 2);
      const d = Math.max(0.06, r.z1 - r.z0 - GAP * 2);
      const c = { cx: cx + (r.x0 + r.x1) / 2, cz: cz + (r.z0 + r.z1) / 2 };
      const look: Look = it.held ? 'outline' : it.kind === 'dropped' ? 'flat' : 'solid';
      base.push({ id: it.id, item: it, look, slot, plate: key, ...c, w, d });
      if (it.kind === 'handoff' && !it.held) base.push({ id: `${it.id}^`, item: it, look: 'cap', slot, plate: key, ...c, w, d });
    }
    rulesOf[pi].forEach((it, i) => {
      const look: Look = (it.body as RuleBody).status === 'pending' || it.held ? 'outline' : 'post';
      base.push({ id: it.id, item: it, look, slot: -1, plate: key, cx: cx + posts[pi][i][0], cz: cz + posts[pi][i][1], w: POST_W, d: POST_W });
    });
  });
  for (const r of reads) {
    const from = base.find((b) => b.id === r.item && b.item.kind === 'handoff' && b.look === 'solid');
    const plate = from && plates.find((p) => p.key === from.plate);
    const dist = plate?.districts.find((d) => d.agent === r.agent);
    if (!from || !dist) continue;
    const tx = Math.min(Math.max(from.cx, dist.x0 + 0.2), dist.x1 - 0.2);
    const tz = Math.min(Math.max(from.cz, dist.z0 + 0.2), dist.z1 - 0.2);
    links.push({ id: `${r.item}>${r.agent}>${r.at}`, slot: slotOf(agents, r.agent), at: Math.max(r.at, from.item.created), a: [from.cx, from.cz], b: [tx, tz] });
  }
  if (box.isEmpty()) box.set(new Vector3(-MIN_SIDE / 2, -PLATE, -MIN_SIDE / 2), new Vector3(MIN_SIDE / 2, H_MAX, MIN_SIDE / 2));
  return { plates, base, links, box, corners: plates.flatMap((p) => p.corners), phi: best.phi, top };
}

export function at(base: Omit<Placed, 'h' | 'shown' | 'y0'>[], time: number, span: number, top = H_MAX): Placed[] {
  return base.map((b) => {
    const shown = b.item.created <= time;
    const age = Math.max(0, time - b.item.created);
    const body = heightAt(age, span, top);
    if (b.look === 'post') return { ...b, y0: 0, h: top * POST, shown };
    if (b.look === 'flat') return { ...b, y0: 0, h: FLAT, shown };
    if (b.look === 'cap') return { ...b, y0: body, h: CAP, shown };
    if (b.look === 'outline' && b.item.kind === 'rule') return { ...b, y0: 0, h: top * POST, shown };
    return { ...b, y0: 0, h: body, shown };
  });
}

export interface Pad {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function viewQuat(theta: number, phi: number): Quaternion {
  const eye = new Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
  return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, new Vector3(), new Vector3(0, 1, 0)));
}

export type Shape = Box3 | Vector3[];

function pointsOf(shape: Shape): Vector3[] {
  if (Array.isArray(shape)) return shape;
  const out: Vector3[] = [];
  for (const x of [shape.min.x, shape.max.x]) for (const y of [shape.min.y, shape.max.y]) for (const z of [shape.min.z, shape.max.z]) out.push(new Vector3(x, y, z));
  return out;
}

export function fit(camera: OrthographicCamera, shape: Shape, theta: number, phi: number, pad: Pad): { target: Vector3; zoom: number } {
  const q = viewQuat(theta, phi);
  const inv = q.clone().invert();
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z = 0;
  const pts = pointsOf(shape);
  for (const p of pts) {
    const v = p.clone().applyQuaternion(inv);
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y);
    y1 = Math.max(y1, v.y);
    z += v.z / pts.length;
  }
  const mx = Math.max(1e-3, (x1 - x0) / 2);
  const my = Math.max(1e-3, (y1 - y0) / 2);
  const center = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, z).applyQuaternion(q);
  const w = camera.right - camera.left;
  const h = camera.top - camera.bottom;
  const zoom = Math.max(1, Math.min((w - pad.left - pad.right) / (2 * mx), (h - pad.top - pad.bottom) / (2 * my)));
  const right = new Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar((pad.right - pad.left) / 2 / zoom);
  const up = new Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar((pad.top - pad.bottom) / 2 / zoom);
  return { target: center.add(right).add(up), zoom };
}

export function frameTo(controls: CameraControlsImpl, camera: OrthographicCamera, shape: Shape, theta: number, phi: number, pad: Pad, smooth: boolean) {
  const { target, zoom } = fit(camera, shape, theta, phi, pad);
  void controls.rotateTo(theta, phi, smooth);
  void controls.moveTo(target.x, target.y, target.z, smooth);
  void controls.zoomTo(zoom, smooth);
}

export function boxOf(list: Placed[]): Box3 {
  const box = new Box3();
  for (const p of list) {
    box.expandByPoint(new Vector3(p.cx - p.w / 2, 0, p.cz - p.d / 2));
    box.expandByPoint(new Vector3(p.cx + p.w / 2, p.y0 + p.h, p.cz + p.d / 2));
  }
  return box;
}

export function homePad(width: number): Pad {
  const narrow = width < 520;
  return { left: narrow ? 12 : 20, right: narrow ? 12 : 20, top: narrow ? 14 : 16, bottom: narrow ? 34 : 38 };
}
