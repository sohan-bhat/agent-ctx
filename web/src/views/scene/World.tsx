import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type RefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { AdaptiveDpr, CameraControls, CameraControlsImpl, ContactShadows, Grid, Html, RoundedBox } from '@react-three/drei';
import { Box3, Object3D, Vector3, type OrthographicCamera } from 'three';
import { Blocks, Foundations, Links, Marks, mix, Outlines, type Pointing } from './Blocks';
import { boxOf, fit, frameTo, HOME, homePad, PLATE, type Layout, type Palette, type Placed, type Plate } from './layout';

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

function Overlay({ plates, controls, portal }: { plates: Plate[]; controls: RefObject<CameraControlsImpl | null>; portal: RefObject<HTMLDivElement | null> }) {
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
              translate="no"
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

function Lights({ dark, box }: { dark: boolean; box: Box3 }) {
  const c = box.getCenter(new Vector3());
  const r = Math.max(6, box.getSize(new Vector3()).length() / 2 + 2);
  const target = useMemo(() => new Object3D(), []);
  target.position.set(c.x, 0, c.z);
  return (
    <>
      <primitive object={target} />
      <hemisphereLight args={['#ffffff', dark ? '#383838' : '#b0b0b0', 1.1]} />
      <directionalLight
        target={target}
        position={[c.x - 9, 11, c.z + 5.5]}
        intensity={2.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-r}
        shadow-camera-right={r}
        shadow-camera-top={r}
        shadow-camera-bottom={-r}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={5}
        shadow-intensity={dark ? 0.85 : 0.6}
      />
    </>
  );
}

function PlateMesh({ p, palette, onPlate }: { p: Plate; palette: Palette; onPlate: (key: string) => void }) {
  const press = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    onPlate(p.key);
  };
  return (
    <group>
      <RoundedBox args={[p.side, PLATE, p.side]} radius={0.05} smoothness={3} position={[p.cx, -PLATE / 2, p.cz]} receiveShadow onClick={press}>
        <meshStandardMaterial color={palette.table} roughness={1} metalness={0} />
      </RoundedBox>
      <Grid
        args={[p.side, p.side]}
        position={[p.cx, 0.003, p.cz]}
        cellSize={0.5}
        cellThickness={0.7}
        cellColor={mix(palette.table, palette.foreground, palette.dark ? 0.1 : 0.15)}
        sectionSize={2.5}
        sectionThickness={1.1}
        sectionColor={mix(palette.table, palette.foreground, palette.dark ? 0.18 : 0.28)}
        fadeDistance={400}
        fadeStrength={0}
        renderOrder={2}
        layers={1}
      />
    </group>
  );
}

export interface WorldApi {
  home: (smooth: boolean) => void;
  focus: (p: Placed) => Promise<void>;
  back: () => boolean;
  project: (p: Placed) => [number, number];
  extent: () => { x0: number; y0: number; x1: number; y1: number; w: number; h: number };
  turn: (azimuth: number, polar: number) => void;
  zoom: (factor: number) => void;
}

export interface WorldProps {
  layout: Layout;
  time: number;
  palette: Palette;
  portal: RefObject<HTMLDivElement | null>;
  pointing: Pointing;
  reduced: boolean;
  api: Ref<WorldApi>;
  focusKey: string | null;
  onPlate: (key: string) => void;
  onMove: () => void;
  onHold: (holding: boolean) => void;
  onReady: () => void;
}

export function World({ layout, time, palette, portal, pointing, reduced, api, focusKey, onPlate, onMove, onHold, onReady }: WorldProps) {
  const controls = useRef<CameraControlsImpl | null>(null);
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const raycaster = useThree((s) => s.raycaster);
  const invalidate = useThree((s) => s.invalidate);
  const saved = useRef<string | null>(null);
  const homeZoom = useRef(1);
  const free = useRef(false);
  const view = layout.corners;
  const viewKey = `${view.map((v) => v.toArray().map((n) => n.toFixed(2)).join()).join('|')}`;
  useLayoutEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
  });
  useLayoutEffect(() => {
    camera.layers.enable(1);
    raycaster.layers.enable(1);
  }, [camera, raycaster]);
  const placeHome = (smooth: boolean) => {
    const c = controls.current;
    if (!c) return;
    const pad = homePad(size.width);
    const all = fit(camera, layout.corners, HOME.theta, HOME.phi, pad).zoom;
    homeZoom.current = all;
    c.minZoom = all * 0.5;
    c.maxZoom = all * 14;
    frameTo(c, camera, view, HOME.theta, HOME.phi, pad, smooth && !reduced);
  };
  const first = useRef(true);
  const lastFocus = useRef(focusKey);
  useLayoutEffect(() => {
    if (lastFocus.current !== focusKey) free.current = false;
    lastFocus.current = focusKey;
    if (free.current && !first.current) return;
    placeHome(!first.current);
    first.current = false;
  }, [camera, size.width, size.height, viewKey, focusKey]);
  useEffect(() => {
    gl.domElement.style.touchAction = 'none';
  }, [gl]);
  const warm = useRef(0);
  useFrame(() => {
    if (warm.current > 3) return;
    warm.current++;
    if (warm.current > 3) onReady();
    else invalidate();
  });
  const version = useMemo(() => layout.placed.filter((p) => p.shown).length, [layout]);
  const [settled, setSettled] = useState(version);
  useEffect(() => {
    const t = setTimeout(() => setSettled(version), reduced ? 0 : 450);
    return () => clearTimeout(t);
  }, [version, reduced]);
  useEffect(() => invalidate(), [settled, invalidate]);
  const centre = layout.box.getCenter(new Vector3());
  const span = layout.box.getSize(new Vector3());
  const shadows = useMemo(
    () => <ContactShadows frames={reduced ? 2 : 12} position={[centre.x, 0.001, centre.z]} scale={Math.max(span.x, span.z) + 2} resolution={512} blur={1.4} far={0.7} opacity={palette.dark ? 0.7 : 0.42} color="#000000" renderOrder={1} />,
    [settled, reduced, palette.dark, centre.x, centre.z, span.x, span.z],
  );
  useImperativeHandle(
    api,
    () => ({
      home: (smooth) => {
        free.current = false;
        saved.current = null;
        placeHome(smooth);
      },
      focus: async (p) => {
        const c = controls.current;
        if (!c) return;
        if (!saved.current) saved.current = c.toJSON();
        free.current = true;
        const box = boxOf([p]);
        const grow = Math.max(1.2, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 1.4);
        box.min.x -= grow;
        box.max.x += grow;
        box.min.z -= grow;
        box.max.z += grow;
        const pad = Math.min(size.width, size.height) * 0.08;
        const { target, zoom } = fit(camera, box, c.azimuthAngle, c.polarAngle, { left: pad, right: pad, top: pad, bottom: pad });
        const to = Math.max(c.camera.zoom, Math.min(zoom, homeZoom.current * 3.2));
        await Promise.all([c.moveTo(target.x, target.y, target.z, !reduced), c.zoomTo(to, !reduced)]);
      },
      back: () => {
        const c = controls.current;
        if (!c || !saved.current) return false;
        c.fromJSON(saved.current, !reduced);
        saved.current = null;
        return true;
      },
      project: (p) => {
        camera.updateMatrixWorld();
        const v = new Vector3(p.cx, p.y0 + p.h, p.cz).project(camera);
        return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
      },
      extent: () => {
        camera.updateMatrixWorld();
        const v = new Vector3();
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const p of layout.plates)
          for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
            for (const y of [0, -PLATE]) {
              v.set(p.cx + (dx * p.side) / 2, y, p.cz + (dz * p.side) / 2).project(camera);
              const sx = ((v.x + 1) / 2) * size.width;
              const sy = ((1 - v.y) / 2) * size.height;
              x0 = Math.min(x0, sx);
              x1 = Math.max(x1, sx);
              y0 = Math.min(y0, sy);
              y1 = Math.max(y1, sy);
            }
        return { x0, y0, x1, y1, w: size.width, h: size.height };
      },
      turn: (azimuth, polar) => {
        const c = controls.current;
        if (!c) return;
        free.current = true;
        void c.rotate(azimuth, polar, !reduced);
      },
      zoom: (factor) => {
        const c = controls.current;
        if (!c) return;
        free.current = true;
        void c.zoomTo(c.camera.zoom * factor, !reduced);
      },
    }),
    [camera, size, layout, reduced, view],
  );
  return (
    <>
      <Lights dark={palette.dark} box={layout.box} />
      {layout.plates.map((p) => (
        <PlateMesh key={p.key || 'empty'} p={p} palette={palette} onPlate={onPlate} />
      ))}
      {shadows}
      <Blocks placed={layout.placed} palette={palette} pointing={pointing} reduced={reduced} />
      <Foundations placed={layout.placed} palette={palette} pointing={pointing} />
      <Outlines placed={layout.placed} palette={palette} pointing={pointing} />
      <Links links={layout.links} time={time} palette={palette} />
      <Marks placed={layout.placed} palette={palette} selected={pointing.selected} />
      <Overlay plates={layout.plates} controls={controls} portal={portal} />
      <AdaptiveDpr />
      <CameraControls
        ref={controls}
        makeDefault
        regress
        minPolarAngle={0.2}
        maxPolarAngle={1.35}
        smoothTime={reduced ? 0 : 0.22}
        draggingSmoothTime={0}
        restThreshold={0.04}
        dollyToCursor
        onControlStart={() => {
          free.current = true;
          onHold(true);
          onMove();
        }}
        onControlEnd={() => onHold(false)}
      />
    </>
  );
}
