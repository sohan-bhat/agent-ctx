import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Instance, Instances, Segment, Segments } from '@react-three/drei';
import { Color, type Group, type Object3D } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { siblingKey } from '@/lib/model';
import { blockMaterials } from './rounded';
import { EDGE, FLAT, type Placed } from './layout';
import type { Palette } from './palette';

export interface Pointing {
  hover: string | null;
  selected: string | null;
  onHover: (id: string | null, x: number, y: number) => void;
  onPress: (id: string, x: number, y: number) => void;
  onFrame: (id: string) => void;
}

interface Shape {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

interface Move {
  from: Shape;
  to: Shape;
  t0: number;
  dur: number;
}

const shapeOf = (p: Placed): Shape => ({ x: p.cx, z: p.cz, w: p.w, d: p.d, h: p.h });
const ease = (t: number) => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function mix(a: string, b: string, t: number): Color {
  return new Color(a).lerp(new Color(b), t);
}

function idOf(e: ThreeEvent<PointerEvent | MouseEvent>): string | null {
  const id = e.object?.userData?.id;
  return typeof id === 'string' ? id : null;
}

function handlers(pointing: Pointing, live: (id: string) => boolean) {
  return {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const id = idOf(e);
      if (!id || !live(id)) return;
      e.stopPropagation();
      pointing.onHover(id, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => {
      if (e.intersections.length === 0) pointing.onHover(null, 0, 0);
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      const id = idOf(e);
      if (!id || !live(id) || e.delta > 4) return;
      e.stopPropagation();
      pointing.onPress(id, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    },
    onDoubleClick: (e: ThreeEvent<MouseEvent>) => {
      const id = idOf(e);
      if (!id || !live(id) || e.delta > 4) return;
      e.stopPropagation();
      pointing.onFrame(id);
    },
  };
}

function useTint(placed: Placed[], palette: Palette, hover: string | null) {
  return useMemo(() => {
    const byId = new Map(placed.map((p) => [p.id, p]));
    const h = hover ? byId.get(hover) : undefined;
    const key = h ? siblingKey(h.piece.block) : null;
    const lit = (p: Placed) => !h || p.id === h.id || (key !== null && siblingKey(p.piece.block) === key);
    const out = new Map<string, Color>();
    for (const p of placed) {
      const base = p.piece.state === 'gone' ? mix(palette.table, palette.kinds[p.piece.block.kind], 0.2) : mix(palette.kinds[p.piece.block.kind], palette.table, p.tone);
      if (!h) out.set(p.id, base);
      else if (lit(p)) out.set(p.id, p.piece.state === 'gone' ? mix(palette.table, palette.kinds[p.piece.block.kind], 0.45) : base.clone().lerp(new Color('#ffffff'), 0.14));
      else out.set(p.id, base.clone().lerp(new Color(palette.table), palette.dark ? 0.55 : 0.5));
    }
    return out;
  }, [placed, palette, hover]);
}

export function Blocks({ placed, palette, pointing, reduced }: { placed: Placed[]; palette: Palette; pointing: Pointing; reduced: boolean }) {
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 3, 0.1), []);
  const mats = useMemo(() => blockMaterials(EDGE, 0.3), []);
  mats.rim.value = palette.dark ? 0.32 : 0.42;
  const invalidate = useThree((s) => s.invalidate);
  const standing = useMemo(() => placed.filter((p) => p.piece.state === 'stand'), [placed]);
  const [leaving, setLeaving] = useState<Placed[]>([]);
  const refs = useRef(new Map<string, Object3D>());
  const now = useRef(new Map<string, Shape>());
  const moves = useRef(new Map<string, Move>());
  const prev = useRef<Placed[]>([]);
  const lastChange = useRef(0);
  const tint = useTint(placed, palette, pointing.hover);

  useLayoutEffect(() => {
    const t = performance.now();
    const dur = reduced || prev.current.length === 0 ? 0 : Math.min(300, t - lastChange.current);
    lastChange.current = t;
    const next = new Set(standing.map((p) => p.id));
    for (const p of standing) {
      const to = shapeOf(p);
      const from = now.current.get(p.id) ?? { ...to, h: 0 };
      moves.current.set(p.id, { from, to, t0: t, dur });
    }
    const gone = prev.current.filter((p) => !next.has(p.id));
    for (const p of gone) {
      const from = now.current.get(p.id) ?? shapeOf(p);
      moves.current.set(p.id, { from, to: { ...from, h: 0 }, t0: t, dur });
    }
    prev.current = standing;
    setLeaving(dur > 0 ? gone : []);
    if (!dur) for (const p of gone) now.current.delete(p.id);
    invalidate();
    if (!dur || !gone.length) return;
    const timer = setTimeout(() => {
      setLeaving([]);
      for (const p of gone) now.current.delete(p.id);
    }, dur + 40);
    return () => clearTimeout(timer);
  }, [standing, reduced, invalidate]);

  useFrame(() => {
    if (!moves.current.size) return;
    const t = performance.now();
    let moving = false;
    for (const [id, m] of moves.current) {
      const k = m.dur > 0 ? Math.min(1, (t - m.t0) / m.dur) : 1;
      const e = ease(k);
      const s = { x: lerp(m.from.x, m.to.x, e), z: lerp(m.from.z, m.to.z, e), w: lerp(m.from.w, m.to.w, e), d: lerp(m.from.d, m.to.d, e), h: lerp(m.from.h, m.to.h, e) };
      now.current.set(id, s);
      const o = refs.current.get(id);
      if (o) {
        o.position.set(s.x, s.h / 2, s.z);
        o.scale.set(s.w, Math.max(s.h, 1e-4), s.d);
        o.updateMatrixWorld();
      }
      if (k >= 1) moves.current.delete(id);
      else moving = true;
    }
    if (moving) invalidate();
  }, -1);

  const all = leaving.length ? [...standing, ...leaving.filter((p) => !standing.some((s) => s.id === p.id))] : standing;
  const live = useMemo(() => new Set(standing.map((p) => p.id)), [standing]);
  const limit = 2 ** Math.ceil(Math.log2(Math.max(256, all.length)));
  return (
    <group {...handlers(pointing, (id) => live.has(id))}>
      <Instances key={limit} limit={limit} range={all.length} geometry={geometry} material={mats.surface} customDepthMaterial={mats.depth} castShadow receiveShadow frustumCulled={false}>
        {all.map((p) => (
          <Instance
            key={p.id}
            userData={{ id: p.id }}
            color={tint.get(p.id) ?? palette.kinds[p.piece.block.kind]}
            ref={(o: Object3D | null) => {
              if (!o) {
                refs.current.delete(p.id);
                return;
              }
              refs.current.set(p.id, o);
              const s = now.current.get(p.id) ?? { ...shapeOf(p), h: 0 };
              o.position.set(s.x, s.h / 2, s.z);
              o.scale.set(s.w, Math.max(s.h, 1e-4), s.d);
              o.updateMatrixWorld();
            }}
          />
        ))}
      </Instances>
    </group>
  );
}

export function Foundations({ placed, palette, pointing }: { placed: Placed[]; palette: Palette; pointing: Pointing }) {
  const gone = useMemo(() => placed.filter((p) => p.piece.state === 'gone'), [placed]);
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 1, 0.02), []);
  const group = useRef<Group>(null);
  const tint = useTint(placed, palette, pointing.hover);
  useLayoutEffect(() => {
    group.current?.traverse((o) => o.layers.set(1));
  });
  const live = useMemo(() => new Set(gone.map((p) => p.id)), [gone]);
  if (!gone.length) return null;
  const limit = 2 ** Math.ceil(Math.log2(Math.max(64, gone.length)));
  const y = FLAT + 0.002;
  return (
    <group ref={group} {...handlers(pointing, (id) => live.has(id))}>
      <Instances key={limit} limit={limit} range={gone.length} geometry={geometry} receiveShadow frustumCulled={false}>
        <meshStandardMaterial roughness={1} metalness={0} />
        {gone.map((p) => (
          <Instance key={p.id} userData={{ id: p.id }} position={[p.cx, FLAT / 2, p.cz]} scale={[p.w, FLAT, p.d]} color={tint.get(p.id)} />
        ))}
      </Instances>
      <Segments limit={gone.length * 4} lineWidth={1.25}>
        {gone.flatMap((p) => {
          const x0 = p.cx - p.w / 2;
          const x1 = p.cx + p.w / 2;
          const z0 = p.cz - p.d / 2;
          const z1 = p.cz + p.d / 2;
          const c = mix(palette.table, palette.kinds[p.piece.block.kind], 0.85);
          return [
            <Segment key={`${p.id}a`} start={[x0, y, z0]} end={[x1, y, z0]} color={c} />,
            <Segment key={`${p.id}b`} start={[x1, y, z0]} end={[x1, y, z1]} color={c} />,
            <Segment key={`${p.id}c`} start={[x1, y, z1]} end={[x0, y, z1]} color={c} />,
            <Segment key={`${p.id}d`} start={[x0, y, z1]} end={[x0, y, z0]} color={c} />,
          ];
        })}
      </Segments>
    </group>
  );
}

function edges(p: { cx: number; cz: number; w: number; d: number }, h: number, y0 = 0): [number, number, number][][] {
  const x0 = p.cx - p.w / 2;
  const x1 = p.cx + p.w / 2;
  const z0 = p.cz - p.d / 2;
  const z1 = p.cz + p.d / 2;
  const c = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const out: [number, number, number][][] = [];
  for (let i = 0; i < 4; i++) {
    const [a, b] = [c[i], c[(i + 1) % 4]];
    out.push([[a[0], y0 + h, a[1]], [b[0], y0 + h, b[1]]]);
    out.push([[a[0], y0, a[1]], [b[0], y0, b[1]]]);
    out.push([[a[0], y0, a[1]], [a[0], y0 + h, a[1]]]);
  }
  return out;
}

export function Marks({ placed, palette, selected, queued, pinned, outline }: { placed: Placed[]; palette: Palette; selected: string | null; queued: Set<string>; pinned: Set<string>; outline: (p: Placed) => number }) {
  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const group = useRef<Group>(null);
  useEffect(() => {
    group.current?.traverse((o) => o.layers.set(1));
  });
  const sel = selected ? byId.get(selected) : undefined;
  const lines: { key: string; a: [number, number, number]; b: [number, number, number]; color: Color }[] = [];
  for (const id of queued) {
    const p = byId.get(id);
    if (!p) continue;
    const c = mix(palette.table, palette.kinds[p.piece.block.kind], 0.95);
    edges(p, outline(p)).forEach(([a, b], i) => lines.push({ key: `q${id}${i}`, a, b, color: c }));
  }
  if (sel) {
    const pad = 0.03;
    const ring = new Color(palette.ring);
    edges({ cx: sel.cx, cz: sel.cz, w: sel.w + pad * 2, d: sel.d + pad * 2 }, (sel.piece.state === 'gone' && !queued.has(sel.id) ? FLAT : queued.has(sel.id) ? outline(sel) : sel.h) + pad).forEach(([a, b], i) => lines.push({ key: `s${i}`, a, b, color: ring }));
  }
  const pins = [...pinned].map((id) => byId.get(id)).filter((p): p is Placed => !!p);
  return (
    <group ref={group}>
      {lines.length > 0 && (
        <Segments key={lines.length} limit={lines.length} lineWidth={1.5}>
          {lines.map((l) => (
            <Segment key={l.key} start={l.a} end={l.b} color={l.color} />
          ))}
        </Segments>
      )}
      {pins.map((p) => {
        const top = p.piece.state === 'gone' ? (queued.has(p.id) ? outline(p) : FLAT) : p.h;
        const r = Math.min(0.09, Math.min(p.w, p.d) * 0.3);
        return (
          <mesh key={p.id} position={[p.cx, top + 0.02, p.cz]} castShadow>
            <cylinderGeometry args={[r, r, 0.04, 24]} />
            <meshStandardMaterial color={palette.foreground} roughness={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}
