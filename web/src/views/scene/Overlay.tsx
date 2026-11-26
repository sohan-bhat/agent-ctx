import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { Html, type CameraControlsImpl } from '@react-three/drei';
import { Vector3 } from 'three';
import { PLATE, RIM, type Plate } from './layout';

interface Tag {
  id: string;
  text: string;
  at: [number, number, number];
  mono: boolean;
  plate: boolean;
}

const CHAR = 6.8;

export function Overlay({ plates, controls, portal }: { plates: Plate[]; controls: RefObject<CameraControlsImpl | null>; portal: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const tags: Tag[] = [];
  for (const p of plates) {
    if (p.name) tags.push({ id: `p:${p.key}`, text: p.name, at: [p.cx + p.side / 2, -PLATE, p.cz + p.side / 2], mono: false, plate: true });
    const front = p.cz + p.side / 2 - RIM;
    const right = p.cx + p.side / 2 - RIM;
    for (const d of p.districts) {
      const at: [number, number, number] = Math.abs(d.z1 - front) < 0.01 ? [(d.x0 + d.x1) / 2, 0.004, front + RIM / 2] : Math.abs(d.x1 - right) < 0.01 ? [right + RIM / 2, 0.004, (d.z0 + d.z1) / 2] : [(d.x0 + d.x1) / 2, 0.004, d.z1 + 0.1];
      tags.push({ id: `d:${p.key}:${d.agent}`, text: d.agent, at, mono: true, plate: false });
    }
  }
  const key = tags.map((t) => t.id + t.at.join()).join('|');
  const pick = useCallback(() => {
    camera.updateMatrixWorld();
    const v = new Vector3();
    const boxes: [number, number, number, number][] = [];
    const next = new Set<string>();
    const order = [...tags].sort((a, b) => Number(b.plate) - Number(a.plate));
    for (const t of order) {
      v.set(...t.at).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      const w = t.text.length * CHAR + 6;
      const b: [number, number, number, number] = t.plate ? [x - w / 2, y + 4, x + w / 2, y + 22] : [x - w / 2, y - 8, x + w / 2, y + 8];
      if (b[0] < 0 || b[2] > size.width || b[1] < 0 || b[3] > size.height) continue;
      if (boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue;
      boxes.push(b);
      next.add(t.id);
    }
    setShown((prev) => (prev.size === next.size && [...next].every((x) => prev.has(x)) ? prev : next));
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
  const at = portal as RefObject<HTMLDivElement>;
  return (
    <>
      {tags.map((t) => (
        <Html key={t.id} portal={at} position={t.at} zIndexRange={[20, 0]} pointerEvents="none" style={{ transform: t.plate ? 'translate(-50%, 6px)' : 'translate(-50%, -50%)', visibility: shown.has(t.id) ? 'visible' : 'hidden' }}>
          <span data-label={t.plate ? 'plate' : 'district'} className={`ctx-label block whitespace-nowrap leading-none ${t.mono ? 'num text-[0.6875rem]' : 'text-[0.8125rem] font-bold'}`}>
            {t.text}
          </span>
        </Html>
      ))}
    </>
  );
}
