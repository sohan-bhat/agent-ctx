import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Instance, Instances, Segment, Segments } from '@react-three/drei';
import { Color, type Group, type Object3D } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { blockMaterials } from './rounded';
import { EDGE, FLAT, type Link, type Placed } from './layout';
import { agentColor, type Palette } from './palette';

export interface Pointing {
  hover: string | null;
  selected: string | null;
  onHover: (id: string | null, x: number, y: number) => void;
  onPress: (id: string) => void;
}

interface Shape {
  x: number;
  z: number;
  w: number;
  d: number;
  y: number;
  h: number;
}

interface Move {
  from: Shape;
  to: Shape;
  t0: number;
  dur: number;
}

export const RISE = 400;
const shapeOf = (p: Placed): Shape => ({ x: p.cx, z: p.cz, w: p.w, d: p.d, y: p.y0, h: p.h });
const ease = (t: number) => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const same = (a: Shape, b: Shape) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z) + Math.abs(a.w - b.w) + Math.abs(a.d - b.d) + Math.abs(a.y - b.y) + Math.abs(a.h - b.h) < 1e-5;
export const itemId = (id: string) => (id.endsWith('^') ? id.slice(0, -1) : id);

export function mix(a: string, b: string, t: number): Color {
  return new Color(a).lerp(new Color(b), t);
}

function idOf(e: ThreeEvent<PointerEvent | MouseEvent>): string | null {
  const id = e.object?.userData?.id;
  return typeof id === 'string' ? id : null;
}

export function handlers(pointing: Pointing, live: (id: string) => boolean) {
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
      if (!id || !live(id) || e.delta > 6) return;
      e.stopPropagation();
      pointing.onPress(id);
    },
  };
}

function tone(p: Placed, palette: Palette, lit: boolean): Color {
  const base = p.look === 'post' ? new Color(palette.foreground) : new Color(agentColor(palette, p.slot));
  if (p.look === 'cap') base.lerp(new Color('#ffffff'), palette.dark ? 0.45 : 0.55);
  if (lit) base.lerp(new Color('#ffffff'), 0.18);
  return base;
}

const Item = memo(function Item({ color, data, attach }: { id: string; color: Color; data: { id: string }; attach: (o: Object3D | null) => void }) {
  return <Instance userData={data} color={color} ref={attach} matrixAutoUpdate={false} />;
});

const SOLID = new Set(['solid', 'cap', 'post']);

export function Blocks({ placed, palette, pointing, reduced }: { placed: Placed[]; palette: Palette; pointing: Pointing; reduced: boolean }) {
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 1, 0.1), []);
  const mats = useMemo(() => blockMaterials(EDGE, 0.3), []);
  mats.rim.value = palette.dark ? 0.26 : 0.36;
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const standing = useMemo(() => placed.filter((p) => p.shown && SOLID.has(p.look)), [placed]);
  const [leaving, setLeaving] = useState<Placed[]>([]);
  const exiting = useRef(new Set<string>());
  const refs = useRef(new Map<string, Object3D>());
  const latest = useRef(new Map<string, Placed>());
  const colors = useRef(new Map<string, Color>());
  const datas = useRef(new Map<string, { id: string }>());
  const attaches = useRef(new Map<string, (o: Object3D | null) => void>());
  const now = useRef(new Map<string, Shape>());
  const moves = useRef(new Map<string, Move>());
  const prev = useRef<Placed[]>([]);
  const lastChange = useRef(0);

  useLayoutEffect(() => {
    const t = performance.now();
    const quick = Math.min(RISE, t - lastChange.current);
    lastChange.current = t;
    const next = new Set(standing.map((p) => p.id));
    for (const p of standing) {
      const to = shapeOf(p);
      const cur = now.current.get(p.id);
      if (cur && same(cur, to) && !moves.current.has(p.id)) continue;
      const from = cur ? { ...cur } : { ...to, h: 0 };
      moves.current.set(p.id, { from, to, t0: t, dur: reduced ? 0 : cur ? quick : RISE });
    }
    const gone = prev.current.filter((p) => !next.has(p.id));
    for (const p of gone) {
      const from = now.current.get(p.id) ?? shapeOf(p);
      moves.current.set(p.id, { from: { ...from }, to: { ...from, h: 0 }, t0: t, dur: reduced ? 0 : Math.max(120, quick) });
    }
    prev.current = standing;
    exiting.current = new Set(reduced ? [] : gone.map((p) => p.id));
    setLeaving(reduced ? [] : gone);
    if (reduced) for (const p of gone) now.current.delete(p.id);
    invalidate();
  }, [standing, reduced, invalidate]);

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
      s.y = lerp(m.from.y, m.to.y, e);
      s.h = lerp(m.from.h, m.to.h, e);
      const o = refs.current.get(id);
      if (o) {
        o.position.set(s.x, s.y + s.h / 2, s.z);
        o.scale.set(s.w, Math.max(s.h, 1e-4), s.d);
        o.updateMatrix();
        o.updateMatrixWorld();
      }
      if (k < 1) moving = true;
      else {
        moves.current.delete(id);
        if (exiting.current.delete(id)) {
          now.current.delete(id);
          if (!exiting.current.size) setLeaving([]);
        }
      }
    }
    gl.shadowMap.needsUpdate = true;
    if (moving) invalidate();
  }, -1);

  useLayoutEffect(() => {
    if (import.meta.env.MODE !== 'mock') return;
    const w = window as unknown as { __heights?: () => Record<string, number> };
    w.__heights = () => Object.fromEntries([...now.current].map(([id, s]) => [id, s.h]));
  }, []);

  latest.current = new Map(standing.map((p) => [p.id, p]));
  for (const p of leaving) if (!latest.current.has(p.id)) latest.current.set(p.id, p);
  const stable = (id: string, c: Color) => {
    const was = colors.current.get(id);
    if (was && was.equals(c)) return was;
    colors.current.set(id, c);
    return c;
  };
  const dataOf = (id: string) => {
    let d = datas.current.get(id);
    if (!d) datas.current.set(id, (d = { id: itemId(id) }));
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
        const s = now.current.get(id) ?? (p ? { ...shapeOf(p), h: 0 } : { x: 0, z: 0, w: 1e-4, d: 1e-4, y: 0, h: 0 });
        o.position.set(s.x, s.y + s.h / 2, s.z);
        o.scale.set(s.w, Math.max(s.h, 1e-4), s.d);
        o.updateMatrix();
        o.updateMatrixWorld();
      };
      attaches.current.set(id, f);
    }
    return f;
  };
  const all = leaving.length ? [...standing, ...leaving.filter((p) => !standing.some((s) => s.id === p.id))] : standing;
  const live = useMemo(() => new Set(standing.map((p) => itemId(p.id))), [standing]);
  const limit = 2 ** Math.ceil(Math.log2(Math.max(256, all.length)));
  return (
    <group {...handlers(pointing, (id) => live.has(id))}>
      <Instances key={limit} limit={limit} range={all.length} geometry={geometry} material={mats.surface} customDepthMaterial={mats.depth} castShadow receiveShadow frustumCulled={false}>
        {all.map((p) => (
          <Item key={p.id} id={p.id} color={stable(p.id, tone(p, palette, pointing.hover === itemId(p.id)))} data={dataOf(p.id)} attach={attachOf(p.id)} />
        ))}
      </Instances>
    </group>
  );
}

export function Foundations({ placed, palette, pointing }: { placed: Placed[]; palette: Palette; pointing: Pointing }) {
  const flat = useMemo(() => placed.filter((p) => p.shown && p.look === 'flat'), [placed]);
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 1, 0.02), []);
  const group = useRef<Group>(null);
  useLayoutEffect(() => {
    group.current?.traverse((o) => o.layers.set(1));
  });
  const live = useMemo(() => new Set(flat.map((p) => p.id)), [flat]);
  if (!flat.length) return null;
  const limit = 2 ** Math.ceil(Math.log2(Math.max(64, flat.length)));
  const y = FLAT + 0.002;
  return (
    <group ref={group} {...handlers(pointing, (id) => live.has(id))}>
      <Instances key={limit} limit={limit} range={flat.length} geometry={geometry} receiveShadow frustumCulled={false}>
        <meshStandardMaterial roughness={1} metalness={0} />
        {flat.map((p) => (
          <Instance key={p.id} userData={{ id: p.id }} position={[p.cx, FLAT / 2, p.cz]} scale={[p.w, FLAT, p.d]} color={mix(palette.table, agentColor(palette, p.slot), pointing.hover === p.id ? 0.42 : 0.2)} />
        ))}
      </Instances>
      <Segments limit={flat.length * 4} lineWidth={1.25}>
        {flat.flatMap((p) => {
          const c = mix(palette.table, agentColor(palette, p.slot), 0.9);
          return edges(p, 0, y)
            .filter((_, i) => i % 3 === 0)
            .map(([a, b], i) => <Segment key={`${p.id}${i}`} start={a} end={b} color={c} />);
        })}
      </Segments>
    </group>
  );
}

export function edges(p: { cx: number; cz: number; w: number; d: number }, h: number, y0 = 0): [number, number, number][][] {
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

export function Outlines({ placed, palette, pointing }: { placed: Placed[]; palette: Palette; pointing: Pointing }) {
  const list = useMemo(() => placed.filter((p) => p.shown && p.look === 'outline'), [placed]);
  const group = useRef<Group>(null);
  useLayoutEffect(() => {
    group.current?.traverse((o) => o.layers.set(1));
  });
  const live = useMemo(() => new Set(list.map((p) => p.id)), [list]);
  if (!list.length) return null;
  return (
    <group ref={group} {...handlers(pointing, (id) => live.has(id))}>
      {list.map((p) => (
        <mesh key={p.id} userData={{ id: p.id }} position={[p.cx, p.h / 2, p.cz]} scale={[Math.max(p.w, 0.2), p.h, Math.max(p.d, 0.2)]}>
          <boxGeometry />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
      <Segments key={list.length} limit={list.length * 12} lineWidth={pointing.hover && live.has(pointing.hover) ? 2 : 1.5}>
        {list.flatMap((p) => {
          const c = new Color(p.item.kind === 'rule' ? palette.foreground : agentColor(palette, p.slot));
          if (pointing.hover === p.id) c.lerp(new Color(palette.dark ? '#ffffff' : '#000000'), 0.25);
          return edges(p, p.h).map(([a, b], i) => <Segment key={`${p.id}${i}`} start={a} end={b} color={c} />);
        })}
      </Segments>
    </group>
  );
}

export function Links({ links, time, palette }: { links: Link[]; time: number; palette: Palette }) {
  const shown = links.filter((l) => l.at <= time);
  const group = useRef<Group>(null);
  useLayoutEffect(() => {
    group.current?.traverse((o) => o.layers.set(1));
  });
  if (!shown.length) return null;
  const y = 0.02;
  return (
    <group ref={group}>
      <Segments key={shown.length} limit={shown.length} lineWidth={1.5}>
        {shown.map((l) => (
          <Segment key={l.id} start={[l.a[0], y, l.a[1]]} end={[l.b[0], y, l.b[1]]} color={mix(palette.table, agentColor(palette, l.slot), 0.95)} />
        ))}
      </Segments>
    </group>
  );
}

export function Marks({ placed, palette, selected }: { placed: Placed[]; palette: Palette; selected: string | null }) {
  const group = useRef<Group>(null);
  useLayoutEffect(() => {
    group.current?.traverse((o) => o.layers.set(1));
  });
  const sel = selected ? placed.find((p) => p.id === selected && p.shown) : undefined;
  const pins = placed.filter((p) => p.shown && p.item.pinned && p.look !== 'cap');
  const ring = new Color(palette.ring);
  const ink = new Color(palette.foreground);
  const pad = 0.03;
  const top = (p: Placed) => p.y0 + p.h + (p.item.kind === 'handoff' && !p.item.held ? 0.07 : 0);
  return (
    <group ref={group}>
      {sel && (
        <Segments key={sel.id} limit={12} lineWidth={2}>
          {edges({ cx: sel.cx, cz: sel.cz, w: sel.w + pad * 2, d: sel.d + pad * 2 }, top(sel) + pad).map(([a, b], i) => (
            <Segment key={i} start={a} end={b} color={ring} />
          ))}
        </Segments>
      )}
      {pins.length > 0 && (
        <Segments key={`pins${pins.length}`} limit={pins.length * 4} lineWidth={1.75}>
          {pins.flatMap((p) => {
            const g = 0.025;
            return edges({ cx: p.cx, cz: p.cz, w: p.w + g * 2, d: p.d + g * 2 }, 0, top(p) + 0.004)
              .filter((_, i) => i % 3 === 0)
              .map(([a, b], i) => <Segment key={`${p.id}${i}`} start={a} end={b} color={ink} />);
          })}
        </Segments>
      )}
    </group>
  );
}
