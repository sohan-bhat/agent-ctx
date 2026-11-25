import { Box3, Matrix4, Quaternion, Vector3, type OrthographicCamera } from 'three';
import type { CameraControlsImpl } from '@react-three/drei';
import { heightShare, toolGroup, TOOL_GROUPS, type Plan, type Piece } from '@/lib/model';

export const SIDE = 10;
export const H_MIN = 0.05;
export const H_MAX = 1.5;
export const FLAT = 0.012;
export const PLATE = 0.18;
export const EDGE = 0.045;
export const HOME = { theta: Math.PI / 4, phi: 0.98 };
const GAP = 0.035;
const TOOL_STREET = 0.11;
const KIND_STREET = 0.2;
const RULER_IN = 0.32;
const TONES = [0, 0.16, 0.28, 0.38];

export interface Placed {
  id: string;
  piece: Piece;
  tone: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  h: number;
}

export function heightAt(age: number): number {
  return H_MIN + heightShare(age) * (H_MAX - H_MIN);
}

export function heightOf(p: Piece): number {
  if (p.state === 'gone') return FLAT;
  if (p.block.members) return H_MIN;
  return heightAt(p.age);
}

function span(a0: number, a1: number, inset0: number, inset1: number): [number, number] {
  const full = a1 - a0;
  const avail = full - inset0 - inset1;
  if (avail < full * 0.35) return [(a0 + a1) / 2, full * 0.35];
  return [(a0 + inset0 + a1 - inset1) / 2, avail];
}

export function place(plan: Plan): Placed[] {
  const sizes = new Map<string, number>();
  for (const l of plan.lots) if (l.piece.block.kind === 'tools' && !l.piece.block.members) sizes.set(l.piece.block.cat, (sizes.get(l.piece.block.cat) ?? 0) + l.piece.size);
  const top = [...sizes].sort((a, b) => b[1] - a[1]).slice(0, TOOL_GROUPS).map(([c]) => c);
  const e = 1e-6;
  const inset = (v: number, outer: boolean, kind: number, group: number) => (outer ? GAP / 2 : Math.abs(v - kind) < e ? KIND_STREET / 2 : Math.abs(v - group) < e ? TOOL_STREET / 2 : GAP / 2);
  return plan.lots.map((l) => {
    const b = l.piece.block;
    const g = b.kind === 'tools' ? (b.members ? 'tool:~' : toolGroup(b.cat, top)) : '';
    const rank = g === '' ? 0 : g === 'tool:~' ? TONES.length - 1 : Math.min(TONES.length - 1, top.indexOf(g));
    const [x, w] = span(l.x0, l.x1, inset(l.x0, l.x0 < e, l.district.x0, l.group.x0), inset(l.x1, l.x1 > plan.region - e, l.district.x1, l.group.x1));
    const [z, d] = span(l.z0, l.z1, inset(l.z0, l.z0 < e, l.district.z0, l.group.z0), inset(l.z1, l.z1 > plan.region - e, l.district.z1, l.group.z1));
    return { id: b.id, piece: l.piece, tone: TONES[rank], cx: -x, cz: -z, w, d, h: heightOf(l.piece) };
  });
}

export interface Framing {
  side: number;
  top: number;
}

export function framing(peak: number, plate: number, lastAge: number): Framing {
  const side = Math.min(SIDE, Math.max(3, SIDE * Math.sqrt(Math.min(1, peak / Math.max(1, plate))) * 1.3));
  return { side, top: Math.max(H_MIN * 4, heightAt(lastAge)) };
}

export function rulerAt(f: Framing): [number, number] {
  const d = f.side < SIDE ? RULER_IN : 0.06;
  return [-f.side + d, -d];
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

export function fit(camera: OrthographicCamera, box: Box3, theta: number, phi: number, pad: Pad): { target: Vector3; zoom: number } {
  const center = box.getCenter(new Vector3());
  const q = viewQuat(theta, phi);
  const inv = q.clone().invert();
  let mx = 1e-3;
  let my = 1e-3;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const v = new Vector3(x, y, z).sub(center).applyQuaternion(inv);
        mx = Math.max(mx, Math.abs(v.x));
        my = Math.max(my, Math.abs(v.y));
      }
  const w = camera.right - camera.left;
  const h = camera.top - camera.bottom;
  const zoom = Math.max(1, Math.min((w - pad.left - pad.right) / (2 * mx), (h - pad.top - pad.bottom) / (2 * my)));
  const right = new Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar((pad.right - pad.left) / 2 / zoom);
  const up = new Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar((pad.top - pad.bottom) / 2 / zoom);
  return { target: center.add(right).add(up), zoom };
}

export function frameTo(controls: CameraControlsImpl, camera: OrthographicCamera, box: Box3, theta: number, phi: number, pad: Pad, smooth: boolean) {
  const { target, zoom } = fit(camera, box, theta, phi, pad);
  void controls.rotateTo(theta, phi, smooth);
  void controls.moveTo(target.x, target.y, target.z, smooth);
  void controls.zoomTo(zoom, smooth);
}

export function homeBox(f: Framing): Box3 {
  return new Box3(new Vector3(-f.side, -PLATE, -f.side), new Vector3(0, f.top, 0));
}

export function homePad(width: number, height: number, f: Framing): Pad {
  const narrow = width < 520;
  return { left: narrow ? 52 : 96, right: narrow ? 8 : 12, top: f.side < SIDE ? height * 0.2 : 16, bottom: 30 };
}

export function boxOf(list: Placed[]): Box3 {
  const box = new Box3();
  for (const p of list) {
    box.expandByPoint(new Vector3(p.cx - p.w / 2, 0, p.cz - p.d / 2));
    box.expandByPoint(new Vector3(p.cx + p.w / 2, p.h, p.cz + p.d / 2));
  }
  return box;
}
