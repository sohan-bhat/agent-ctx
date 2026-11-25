import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { Html, type CameraControlsImpl } from '@react-three/drei';
import { Vector3, type OrthographicCamera } from 'three';
import { AGE_TICKS } from '@/lib/model';
import { shortOf } from '@/lib/context';
import { heightAt, PLATE, rulerAt, type Framing, type Placed } from './layout';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Tag {
  p: Placed;
  text: string;
  dx: number;
  dy: number;
}

const OFFSETS: [number, number][] = [
  [0, 0],
  [0, -18],
  [0, -36],
  [-30, -24],
  [30, -24],
  [0, -54],
  [-56, -40],
  [56, -40],
];

const CHAR = 6.7;

const hit = (a: Box, b: Box) => a.x0 < b.x1 + 4 && a.x1 > b.x0 - 4 && a.y0 < b.y1 + 2 && a.y1 > b.y0 - 2;

export interface OverlayProps {
  placed: Placed[];
  f: Framing;
  plateLabel: string;
  controls: RefObject<CameraControlsImpl | null>;
  portal: RefObject<HTMLDivElement | null>;
  homeZoom: RefObject<number>;
  force?: Set<string>;
}

const NONE = new Set<string>();

export function Overlay({ placed, f, plateLabel, controls, portal, homeZoom, force = NONE }: OverlayProps) {
  const camera = useThree((st) => st.camera) as OrthographicCamera;
  const size = useThree((st) => st.size);
  const narrow = size.width < 520;
  const [rx, rz] = rulerAt(f);
  const [ticks, setTicks] = useState<number[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const pick = useCallback(() => {
    camera.updateMatrixWorld();
    const v = new Vector3();
    const screen = (x: number, y: number, z: number) => {
      v.set(x, y, z).project(camera);
      return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height] as const;
    };
    const boxes: Box[] = [];
    const [wx, wy] = screen(0, -PLATE, 0);
    const ww = plateLabel.length * CHAR;
    boxes.push({ x0: wx - ww / 2, x1: wx + ww / 2, y0: wy + 6, y1: wy + 20 });
    const shownTicks: number[] = [];
    let last = Infinity;
    for (const a of [...AGE_TICKS].reverse()) {
      const [sx, sy] = screen(rx, heightAt(a), rz);
      if (Math.abs(sy - last) < 14) continue;
      const tw = (a === 1000 ? 11 : String(a).length) * CHAR;
      boxes.push(narrow ? { x0: sx - 46, x1: sx - 8, y0: sy - 14, y1: sy + 14 } : { x0: sx - 10 - tw, x1: sx - 10, y0: sy - 7, y1: sy + 7 });
      shownTicks.push(a);
      last = sy;
      if (narrow) break;
    }
    const share = camera.zoom / Math.max(1, homeZoom.current ?? 1);
    const cap = Math.round(Math.min(22, Math.max(narrow ? 3 : 6, (narrow ? 3 : 6) * share * share)));
    const seen = placed
      .filter((p) => p.piece.state === 'stand')
      .map((p) => ({ p, a: screen(p.cx, p.h, p.cz) }))
      .filter(({ a }) => a[0] >= 0 && a[0] <= size.width && a[1] >= 0 && a[1] <= size.height)
      .sort((x, y) => Number(force.has(y.p.id)) - Number(force.has(x.p.id)) || y.p.w * y.p.d - x.p.w * x.p.d);
    const texts = new Set<string>();
    const next: Tag[] = [];
    for (const { p, a } of seen.slice(0, 140)) {
      const forced = force.has(p.id);
      if (next.length >= cap && !forced) break;
      const text = shortOf(p.piece.block);
      if (texts.has(text)) continue;
      const [ax, ay] = a;
      const [ex] = screen(p.cx - p.w / 2, p.h, p.cz + p.d / 2);
      const [fx] = screen(p.cx + p.w / 2, p.h, p.cz - p.d / 2);
      if (Math.abs(fx - ex) < 22 && !forced) continue;
      const tw = text.length * CHAR + 8;
      for (const [dx, dy] of OFFSETS) {
        const box = { x0: ax + dx - tw / 2, x1: ax + dx + tw / 2, y0: ay + dy - 19, y1: ay + dy - 4 };
        if (box.x0 < 2 || box.x1 > size.width - 2 || box.y0 < 2) continue;
        if (boxes.some((o) => hit(box, o))) continue;
        boxes.push(box);
        texts.add(text);
        next.push({ p, text, dx, dy });
        break;
      }
    }
    setTicks((prev) => (prev.join() === shownTicks.join() ? prev : shownTicks));
    setTags((prev) => (prev.length === next.length && prev.every((t, i) => t.p === next[i].p && t.dx === next[i].dx && t.dy === next[i].dy) ? prev : next));
  }, [camera, size, placed, narrow, rx, rz, plateLabel, homeZoom, force]);
  useEffect(() => {
    pick();
    const c = controls.current;
    if (!c) return;
    c.addEventListener('update', pick);
    c.addEventListener('rest', pick);
    return () => {
      c.removeEventListener('update', pick);
      c.removeEventListener('rest', pick);
    };
  }, [pick, controls]);
  const at = portal as RefObject<HTMLDivElement>;
  return (
    <>
      <Html portal={at} position={[0, -PLATE, 0]} zIndexRange={[20, 0]} pointerEvents="none" style={{ transform: 'translate(-50%, 6px)' }}>
        <span className="ctx-tick num block whitespace-nowrap text-[0.6875rem] leading-none">{plateLabel}</span>
      </Html>
      {ticks.map((a) => (
        <Html key={a} portal={at} position={[rx, heightAt(a), rz]} zIndexRange={[20, 0]} pointerEvents="none" style={{ transform: narrow ? 'translate(calc(-100% - 8px), -50%)' : 'translate(calc(-100% - 10px), -50%)' }}>
          {narrow && a === 1000 ? (
            <span className="ctx-tick num block text-right text-[0.6875rem] leading-tight">
              1,000
              <br />
              calls
            </span>
          ) : (
            <span className="ctx-tick num block whitespace-nowrap text-[0.6875rem] leading-none">{a === 1000 ? '1,000 calls' : a}</span>
          )}
        </Html>
      ))}
      {tags.map((t) => (
        <Html key={t.p.id} portal={at} position={[t.p.cx, t.p.h, t.p.cz]} zIndexRange={[20, 0]} pointerEvents="none">
          {(t.dx !== 0 || t.dy !== 0) && (
            <svg className="ctx-leader absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
              <line x1="0" y1="0" x2={t.dx} y2={t.dy - 4} />
            </svg>
          )}
          <span className={`ctx-label absolute block whitespace-nowrap text-[0.6875rem] font-semibold leading-none ${t.p.piece.block.label.startsWith('/') ? 'num' : ''}`} style={{ left: t.dx, top: t.dy, transform: 'translate(-50%, calc(-100% - 5px))' }}>
            {t.text}
          </span>
        </Html>
      ))}
    </>
  );
}
