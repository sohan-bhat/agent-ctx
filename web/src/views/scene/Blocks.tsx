import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
const same = (a: Shape, b: Shape) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6 && Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.d - b.d) < 1e-6 && Math.abs(a.h - b.h) < 1e-6;

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
    const table = new Color(palette.table);
    const white = new Color('#ffffff');
    const kinds = new Map(Object.entries(palette.kinds).map(([k, v]) => [k, new Color(v)]));
    const cache = new Map<string, Color>();
    const tone = (p: Placed, look: 'base' | 'lit' | 'dim') => {
      const key = `${p.piece.block.kind}|${p.tone}|${p.piece.state}|${look}`;
      let c = cache.get(key);
      if (c) return c;
      const k = kinds.get(p.piece.block.kind) ?? white;
      if (p.piece.state === 'gone') c = table.clone().lerp(k, look === 'lit' ? 0.45 : 0.2);
      else c = k.clone().lerp(table, p.tone);
      if (look === 'lit' && p.piece.state !== 'gone') c.lerp(white, 0.14);
      if (look === 'dim') c.lerp(table, palette.dark ? 0.55 : 0.5);
      cache.set(key, c);
      return c;
    };
    const byId = new Map(placed.map((p) => [p.id, p]));
    const h = hover ? byId.get(hover) : undefined;
    const key = h ? siblingKey(h.piece.block) : null;
    const out = new Map<string, Color>();
    for (const p of placed) {
      if (!h) out.set(p.id, tone(p, 'base'));
      else if (p.id === h.id || (key !== null && siblingKey(p.piece.block) === key)) out.set(p.id, tone(p, 'lit'));
      else out.set(p.id, tone(p, 'dim'));
    }
    return out;
  }, [placed, palette, hover]);
}

const Item = memo(function Item({ color, data, attach }: { id: string; color: Color; data: { id: string }; attach: (o: Object3D | null) => void }) {
  return <Instance userData={data} color={color} ref={attach} matrixAutoUpdate={false} />;
});

export function Blocks({ placed, palette, pointing, reduced }: { placed: Placed[]; palette: Palette; pointing: Pointing; reduced: boolean }) {
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 1, 0.1), []);
  const mats = useMemo(() => blockMaterials(EDGE, 0.3), []);
  mats.rim.value = palette.dark ? 0.32 : 0.42;
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const regress = useThree((s) => s.performance.regress);
  const standing = useMemo(() => placed.filter((p) => p.piece.state === 'stand'), [placed]);
  const [leaving, setLeaving] = useState<Placed[]>([]);
  const refs = useRef(new Map<string, Object3D>());
  const latest = useRef(new Map<string, Placed>());
  const colors = useRef(new Map<string, Color>());
  const datas = useRef(new Map<string, { id: string }>());
  const attaches = useRef(new Map<string, (o: Object3D | null) => void>());
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
    let changed = 0;
    for (const p of standing) {
      const to = shapeOf(p);
      const cur = now.current.get(p.id);
      if (cur && same(cur, to) && !moves.current.has(p.id)) continue;
      const from = cur ? { ...cur } : { ...to, h: 0 };
      moves.current.set(p.id, { from, to, t0: t, dur });
      changed++;
    }
    const gone = prev.current.filter((p) => !next.has(p.id));
    for (const p of gone) {
      const from = now.current.get(p.id) ?? shapeOf(p);
      moves.current.set(p.id, { from: { ...from }, to: { ...from, h: 0 }, t0: t, dur });
    }
    prev.current = standing;
    if (changed + gone.length > 200 && dur > 0) regress();
    setLeaving(dur > 0 ? gone : []);
    if (!dur) for (const p of gone) now.current.delete(p.id);
    invalidate();
    if (!dur || !gone.length) return;
    const timer = setTimeout(() => {
      setLeaving([]);
      for (const p of gone) now.current.delete(p.id);
    }, dur + 40);
    return () => clearTimeout(timer);
  }, [standing, reduced, invalidate, regress]);

  useFrame(() => {
    if (!moves.current.size) return;
    const t = performance.now();
    let moving = false;
    for (const [id, m] of moves.current) {
      const k = m.dur > 0 ? Math.min(1, (t - m.t0) / m.dur) : 1;
      const e = ease(k);
      let s = now.current.get(id);
      if (!s) now.current.set(id, (s = { ...m.to }));
      s.x = lerp(m.from.x, m.to.x, e);
      s.z = lerp(m.from.z, m.to.z, e);
      s.w = lerp(m.from.w, m.to.w, e);
      s.d = lerp(m.from.d, m.to.d, e);
      s.h = lerp(m.from.h, m.to.h, e);
      const o = refs.current.get(id);
      if (o) {
        o.position.set(s.x, s.h / 2, s.z);
        o.scale.set(s.w, Math.max(s.h, 1e-4), s.d);
        o.updateMatrix();
        o.updateMatrixWorld();
      }
      if (k >= 1) moves.current.delete(id);
      else moving = true;
    }
    gl.shadowMap.needsUpdate = true;
    if (moving) invalidate();
  }, -1);

  latest.current = new Map(standing.map((p) => [p.id, p]));
  for (const p of leaving) if (!latest.current.has(p.id)) latest.current.set(p.id, p);
  const stable = (id: string, c: Color) => {
    const prev = colors.current.get(id);
    if (prev && prev.equals(c)) return prev;
    colors.current.set(id, c);
    return c;
  };
  const dataOf = (id: string) => {
    let d = datas.current.get(id);
    if (!d) datas.current.set(id, (d = { id }));
    return d;
  };
  const attachOf = (id: string) => {
    let f = attaches.current.get(id);
    if (!f) {
      f = (o: Object3D | null) => {
        if (!o) {
          refs.current.delete(id);
          return;
        }
        refs.current.set(id, o);
        const p = latest.current.get(id);
        const s = now.current.get(id) ?? (p ? { ...shapeOf(p), h: 0 } : { x: 0, z: 0, w: 1e-4, d: 1e-4, h: 0 });
        o.position.set(s.x, s.h / 2, s.z);
        o.scale.set(s.w, Math.max(s.h, 1e-4), s.d);
        o.updateMatrix();
        o.updateMatrixWorld();
      };
      attaches.current.set(id, f);
    }
    return f;
  };
  const all = leaving.length ? [...standing, ...leaving.filter((p) => !standing.some((s) => s.id === p.id))] : standing;
  const live = useMemo(() => new Set(standing.map((p) => p.id)), [standing]);
  const limit = 2 ** Math.ceil(Math.log2(Math.max(256, all.length)));
  return (
    <group {...handlers(pointing, (id) => live.has(id))}>
      <Instances key={limit} limit={limit} range={all.length} geometry={geometry} material={mats.surface} customDepthMaterial={mats.depth} castShadow receiveShadow frustumCulled={false}>
        {all.map((p) => (
          <Item key={p.id} id={p.id} color={stable(p.id, tint.get(p.id) ?? new Color(palette.kinds[p.piece.block.kind]))} data={dataOf(p.id)} attach={attachOf(p.id)} />
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
