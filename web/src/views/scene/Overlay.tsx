import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { Html, type CameraControlsImpl } from '@react-three/drei';
import { Vector3 } from 'three';
import { PLATE, type Plate } from './layout';

interface Tag {
  id: string;
  text: string;
  at: [number, number, number];
  dir: [number, number, number];
  out: [number, number, number];
  plate: boolean;
}

interface Spot {
  angle: number;
  x: number;
  y: number;
}

const CHAR = { plate: 7.6, district: 6.8 };
const GAP = 13;

export function Overlay({ plates, controls, portal }: { plates: Plate[]; controls: RefObject<CameraControlsImpl | null>; portal: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const [spots, setSpots] = useState<Map<string, Spot>>(new Map());
  const tags: Tag[] = [];
  for (const p of plates) {
    const h = p.side / 2;
    if (p.name) tags.push({ id: `p:${p.key}`, text: p.name, at: [p.cx + h, -PLATE, p.cz], dir: [0, 0, 1], out: [1, 0, 0], plate: true });
    for (const d of [...p.districts].sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0)))
      tags.push({ id: `d:${p.key}:${d.agent}`, text: d.agent, at: [(d.x0 + d.x1) / 2, -PLATE, p.cz + h], dir: [1, 0, 0], out: [0, 0, 1], plate: false });
  }
  const key = tags.map((t) => t.id + t.at.join()).join('|');
  const pick = useCallback(() => {
    camera.updateMatrixWorld();
    const v = new Vector3();
    const screen = (x: number, y: number, z: number) => {
      v.set(x, y, z).project(camera);
      return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
    };
    const boxes: [number, number, number, number][] = [];
    const next = new Map<string, Spot>();
    for (const t of tags) {
      const [x0, y0] = screen(...t.at);
      const [x1, y1] = screen(t.at[0] + t.dir[0], t.at[1] + t.dir[1], t.at[2] + t.dir[2]);
      const [ox, oy] = screen(t.at[0] + t.out[0], t.at[1] + t.out[1], t.at[2] + t.out[2]);
      let ex = x1 - x0;
      let ey = y1 - y0;
      const el = Math.hypot(ex, ey) || 1;
      ex /= el;
      ey /= el;
      let nx = ox - x0;
      let ny = oy - y0;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      let angle = (Math.atan2(ey, ex) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle <= -90) angle += 180;
      const w = t.text.length * (t.plate ? CHAR.plate : CHAR.district) + 6;
      const hgt = t.plate ? 16 : 13;
      const rad = (angle * Math.PI) / 180;
      const bw = Math.abs(w * Math.cos(rad)) + Math.abs(hgt * Math.sin(rad));
      const bh = Math.abs(w * Math.sin(rad)) + Math.abs(hgt * Math.cos(rad));
      for (const shift of [0, 0.55, -0.55]) {
        const cx = x0 + nx * GAP + ex * shift * w;
        const cy = y0 + ny * GAP + ey * shift * w;
        const b: [number, number, number, number] = [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2];
        if (b[0] < 0 || b[2] > size.width || b[1] < 0 || b[3] > size.height) continue;
        if (boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue;
        boxes.push(b);
        next.set(t.id, { angle, x: cx - x0, y: cy - y0 });
        break;
      }
    }
    setSpots((prev) => {
      if (prev.size === next.size && [...next].every(([k, s]) => {
        const p = prev.get(k);
        return p && Math.abs(p.angle - s.angle) < 0.05 && Math.abs(p.x - s.x) < 0.05 && Math.abs(p.y - s.y) < 0.05;
      }))
        return prev;
      return next;
    });
  }, [camera, size, key]);
  useEffect(() => {
    const id = requestAnimationFrame(pick);
    const c = controls.current;
    c?.addEventListener('update', pick);
    c?.addEventListener('rest', pick);
    return () => {
      cancelAnimationFrame(id);
      c?.removeEventListener('update', pick);
      c?.removeEventListener('rest', pick);
    };
  }, [pick, controls]);
  const portalRef = portal as RefObject<HTMLDivElement>;
  return (
    <>
      {tags.map((t) => {
        const s = spots.get(t.id);
        return (
          <Html key={t.id} portal={portalRef} position={t.at} zIndexRange={[20, 0]} pointerEvents="none" style={{ visibility: s ? 'visible' : 'hidden' }}>
            <span
              data-label={t.plate ? 'plate' : 'district'}
              className={`ctx-label absolute left-0 top-0 block whitespace-nowrap leading-none ${t.plate ? 'text-[0.8125rem] font-bold' : 'num text-[0.6875rem]'}`}
              style={{ transform: `translate(-50%, -50%) translate(${s?.x ?? 0}px, ${s?.y ?? 0}px) rotate(${s?.angle ?? 0}deg)` }}
            >
              {t.text}
            </span>
          </Html>
        );
      })}
    </>
  );
}
