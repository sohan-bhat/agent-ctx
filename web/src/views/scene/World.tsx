import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { CameraControls, CameraControlsImpl, Html, Instance, Instances, RoundedBox, Segment, Segments } from '@react-three/drei';
import { Box3, Color, Matrix4, Quaternion, Vector3, type OrthographicCamera } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { AGE_TICKS, heightShare, type Plan, type Piece } from '@/lib/model';
import { shortOf } from '@/lib/context';
import { blockMaterials } from './rounded';
import type { Palette } from './palette';

export const SIDE = 10;
const HALF = SIDE / 2;
const GAP = 0.04;
const H_MIN = 0.05;
const H_MAX = 1.5;
const FLAT = 0.012;
const PLATE = 0.18;
const EDGE = 0.035;
const HOME = { theta: Math.PI / 4, phi: 0.98 };

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

export function heightOf(p: Piece): number {
  if (p.state === 'gone') return FLAT;
  if (p.block.members) return H_MIN;
  return H_MIN + heightShare(p.age) * (H_MAX - H_MIN);
}

const TONES = [0, 0.3, 0.45, 0.55, 0.62];

export function place(plan: Plan): Placed[] {
  const sizes = new Map<string, number>();
  for (const l of plan.lots) if (l.piece.block.kind === 'tools' && !l.piece.block.members) sizes.set(l.piece.block.cat, (sizes.get(l.piece.block.cat) ?? 0) + l.piece.size);
  const rank = new Map([...sizes].sort((a, b) => b[1] - a[1]).map(([cat], i) => [cat, i]));
  return plan.lots.map((l) => {
    const w = l.x1 - l.x0;
    const d = l.z1 - l.z0;
    return {
      id: l.piece.block.id,
      piece: l.piece,
      tone: l.piece.block.members ? TONES[TONES.length - 1] : TONES[Math.min(TONES.length - 1, rank.get(l.piece.block.cat) ?? 0)],
      cx: -HALF + (l.x0 + l.x1) / 2,
      cz: -HALF + (l.z0 + l.z1) / 2,
      w: Math.max(w - GAP, w * 0.5),
      d: Math.max(d - GAP, d * 0.5),
      h: heightOf(l.piece),
    };
  });
}

function viewQuat(theta: number, phi: number): Quaternion {
  const eye = new Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
  return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, new Vector3(), new Vector3(0, 1, 0)));
}

export interface Pad {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function frame(controls: CameraControlsImpl, camera: OrthographicCamera, box: Box3, theta: number, phi: number, pad: Pad, smooth: boolean) {
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
  const target = center.add(right).add(up);
  void controls.rotateTo(theta, phi, smooth);
  void controls.moveTo(target.x, target.y, target.z, smooth);
  void controls.zoomTo(zoom, smooth);
}

export const plateBox = () => new Box3(new Vector3(-HALF - 0.4, -PLATE, -HALF), new Vector3(HALF, H_MAX * 0.7, HALF + 0.4));

export const homePad = (width: number): Pad => (width < 520 ? { left: 18, right: 6, top: 26, bottom: 8 } : { left: 92, right: 12, top: 14, bottom: 12 });

function Lights({ dark }: { dark: boolean }) {
  return (
    <>
      <hemisphereLight args={['#ffffff', dark ? '#3c3c3c' : '#b4b4b4', 1.15]} />
      <directionalLight
        position={[-7, 8, 4]}
        intensity={2.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={6}
        shadow-intensity={dark ? 0.75 : 0.55}
      />
    </>
  );
}

function Plate({ color }: { color: string }) {
  return (
    <RoundedBox args={[SIDE, PLATE, SIDE]} radius={0.05} smoothness={3} position={[0, -PLATE / 2, 0]} receiveShadow>
      <meshStandardMaterial color={color} roughness={1} metalness={0} />
    </RoundedBox>
  );
}

function mix(a: string, b: string, t: number): Color {
  return new Color(a).lerp(new Color(b), t);
}

function Blocks({ placed, palette }: { placed: Placed[]; palette: Palette }) {
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 3, 0.1), []);
  const mats = useMemo(() => blockMaterials(EDGE), []);
  const standing = placed.filter((p) => p.piece.state === 'stand');
  const limit = 2 ** Math.ceil(Math.log2(Math.max(256, standing.length)));
  return (
    <Instances key={limit} limit={limit} range={standing.length} geometry={geometry} material={mats.surface} customDepthMaterial={mats.depth} castShadow receiveShadow>
      {standing.map((p) => (
        <Instance key={p.id} position={[p.cx, p.h / 2, p.cz]} scale={[p.w, p.h, p.d]} color={mix(palette.kinds[p.piece.block.kind], palette.table, p.tone)} />
      ))}
    </Instances>
  );
}

function Foundations({ placed, palette }: { placed: Placed[]; palette: Palette }) {
  const gone = placed.filter((p) => p.piece.state === 'gone');
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 1, 0.02), []);
  if (!gone.length) return null;
  const limit = 2 ** Math.ceil(Math.log2(Math.max(64, gone.length)));
  const y = FLAT + 0.002;
  return (
    <>
      <Instances key={limit} limit={limit} range={gone.length} geometry={geometry} receiveShadow>
        <meshStandardMaterial roughness={1} metalness={0} />
        {gone.map((p) => (
          <Instance key={p.id} position={[p.cx, FLAT / 2, p.cz]} scale={[p.w, FLAT, p.d]} color={mix(palette.table, palette.kinds[p.piece.block.kind], 0.22)} />
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
    </>
  );
}

function Ruler({ palette, portal, controls }: { palette: Palette; portal: RefObject<HTMLDivElement | null>; controls: RefObject<CameraControlsImpl | null> }) {
  const camera = useThree((st) => st.camera);
  const size = useThree((st) => st.size);
  const x = -HALF - 0.32;
  const z = HALF + 0.32;
  const narrow = size.width < 520;
  const ticks = useMemo(() => AGE_TICKS.map((a) => ({ a, y: H_MIN + heightShare(a) * (H_MAX - H_MIN) })), []);
  const [shown, setShown] = useState<number[]>([]);
  const pick = useCallback(() => {
    camera.updateMatrixWorld();
    const out: number[] = [];
    let last = Infinity;
    for (const t of [...ticks].reverse()) {
      const y = ((1 - new Vector3(x, t.y, z).project(camera).y) / 2) * size.height;
      if (Math.abs(y - last) < 14) continue;
      out.push(t.a);
      last = y;
      if (narrow) break;
    }
    setShown((prev) => (prev.join() === out.join() ? prev : out));
  }, [camera, size, ticks, narrow, x, z]);
  useEffect(() => {
    pick();
    const c = controls.current;
    if (!c) return;
    c.addEventListener('rest', pick);
    c.addEventListener('update', pick);
    return () => {
      c.removeEventListener('rest', pick);
      c.removeEventListener('update', pick);
    };
  }, [pick, controls]);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, H_MAX / 2, 0]}>
        <boxGeometry args={[0.018, H_MAX, 0.018]} />
        <meshBasicMaterial color={palette.muted} />
      </mesh>
      {ticks.map((t) => (
        <group key={t.a} position={[0, t.y, 0]}>
          <mesh rotation={[0, Math.PI / 4, 0]}>
            <boxGeometry args={[0.16, 0.014, 0.014]} />
            <meshBasicMaterial color={palette.muted} />
          </mesh>
          {shown.includes(t.a) && (
            <Html portal={portal as RefObject<HTMLDivElement>} zIndexRange={[20, 0]} pointerEvents="none" style={{ transform: narrow ? 'translate(-3px, calc(-100% - 6px))' : 'translate(calc(-100% - 10px), -50%)' }}>
              <span className="ctx-tick num block whitespace-nowrap text-[0.6875rem] leading-none">{t.a === 1000 ? '1,000 calls' : t.a}</span>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}

interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function Labels({ placed, controls, portal }: { placed: Placed[]; controls: RefObject<CameraControlsImpl | null>; portal: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const [shown, setShown] = useState<Placed[]>([]);
  const pick = useCallback(() => {
    const v = new Vector3();
    const boxes: LabelBox[] = [];
    const next: Placed[] = [];
    const order = placed.filter((p) => p.piece.state === 'stand').sort((a, b) => b.w * b.d - a.w * a.d);
    camera.updateMatrixWorld();
    const texts = new Set<string>();
    for (const p of order.slice(0, 80)) {
      const text = shortOf(p.piece.block);
      if (texts.has(text)) continue;
      v.set(p.cx, p.h, p.cz).project(camera);
      const sx = ((v.x + 1) / 2) * size.width;
      const sy = ((1 - v.y) / 2) * size.height;
      const a = new Vector3(p.cx - p.w / 2, p.h, p.cz - p.d / 2).project(camera);
      const b = new Vector3(p.cx + p.w / 2, p.h, p.cz + p.d / 2).project(camera);
      const c = new Vector3(p.cx + p.w / 2, p.h, p.cz - p.d / 2).project(camera);
      const e = new Vector3(p.cx - p.w / 2, p.h, p.cz + p.d / 2).project(camera);
      const spanX = (Math.max(a.x, b.x, c.x, e.x) - Math.min(a.x, b.x, c.x, e.x)) * size.width * 0.5;
      const wpx = text.length * 6.7 + 10;
      if (spanX < Math.min(wpx * 0.7, 90)) continue;
      const box = { x0: sx - wpx / 2, x1: sx + wpx / 2, y0: sy - 22, y1: sy };
      if (box.x0 < 0 || box.x1 > size.width || box.y0 < 0 || box.y1 > size.height) continue;
      if (boxes.some((o) => box.x0 < o.x1 + 4 && box.x1 > o.x0 - 4 && box.y0 < o.y1 + 2 && box.y1 > o.y0 - 2)) continue;
      boxes.push(box);
      texts.add(text);
      next.push(p);
      if (next.length >= 12) break;
    }
    setShown((prev) => (prev.length === next.length && prev.every((p, i) => p === next[i]) ? prev : next));
  }, [placed, camera, size]);
  useEffect(() => {
    pick();
    const c = controls.current;
    if (!c) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        pick();
      }, 160);
    };
    c.addEventListener('update', soon);
    c.addEventListener('rest', pick);
    return () => {
      c.removeEventListener('update', soon);
      c.removeEventListener('rest', pick);
      if (t) clearTimeout(t);
    };
  }, [pick, controls]);
  return (
    <>
      {shown.map((p) => (
        <Html key={p.id} portal={portal as RefObject<HTMLDivElement>} position={[p.cx, p.h, p.cz]} zIndexRange={[20, 0]} pointerEvents="none" style={{ transform: 'translate(-50%, calc(-100% - 5px))' }}>
          <span className={`ctx-label block whitespace-nowrap text-[0.6875rem] font-semibold leading-none ${p.piece.block.label.startsWith('/') ? 'num' : ''}`}>{shortOf(p.piece.block)}</span>
        </Html>
      ))}
    </>
  );
}

export interface WorldProps {
  placed: Placed[];
  palette: Palette;
  portal: RefObject<HTMLDivElement | null>;
}

export function World({ placed, palette, portal }: WorldProps) {
  const controls = useRef<CameraControlsImpl | null>(null);
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const home = useRef(true);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    gl.domElement.style.touchAction = 'pan-y';
    if (home.current) frame(c, camera, plateBox(), HOME.theta, HOME.phi, homePad(size.width), false);
  }, [camera, size.width, size.height, gl]);
  return (
    <>
      <Lights dark={palette.dark} />
      <Plate color={palette.table} />
      <Blocks placed={placed} palette={palette} />
      <Foundations placed={placed} palette={palette} />
      <Ruler palette={palette} portal={portal} controls={controls} />
      <Labels placed={placed} controls={controls} portal={portal} />
      <CameraControls
        ref={controls}
        makeDefault
        minPolarAngle={0.2}
        maxPolarAngle={1.35}
        smoothTime={0.18}
        draggingSmoothTime={0.08}
        onControlStart={() => {
          home.current = false;
        }}
      />
    </>
  );
}
