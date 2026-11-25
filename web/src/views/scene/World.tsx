import { useEffect, useImperativeHandle, useMemo, useRef, type Ref, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { CameraControls, CameraControlsImpl, ContactShadows, Grid, RoundedBox } from '@react-three/drei';
import { Object3D, Vector3, type OrthographicCamera } from 'three';
import { AGE_TICKS } from '@/lib/model';
import { fadeMaterial } from './rounded';
import { Blocks, Foundations, Marks, mix, type Pointing } from './Blocks';
import { Overlay } from './Overlay';
import { boxOf, fit, frameTo, H_MAX, heightAt, HOME, homeBox, homePad, PLATE, rulerAt, SIDE, type Framing, type Placed } from './layout';
import type { Palette } from './palette';

function Lights({ dark }: { dark: boolean }) {
  const target = useMemo(() => {
    const o = new Object3D();
    o.position.set(-SIDE / 2, 0, -SIDE / 2);
    return o;
  }, []);
  return (
    <>
      <primitive object={target} />
      <hemisphereLight args={['#ffffff', dark ? '#383838' : '#b0b0b0', 1.1]} />
      <directionalLight
        target={target}
        position={[-SIDE / 2 - 9, 11, -SIDE / 2 + 5.5]}
        intensity={2.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={45}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={5}
        shadow-intensity={dark ? 0.85 : 0.6}
      />
    </>
  );
}

function Plate({ palette, f }: { palette: Palette; f: Framing }) {
  const { material, fade } = useMemo(() => fadeMaterial(palette.table), [palette.table]);
  const from = f.side < SIDE ? f.side * 1.2 : 100;
  const to = f.side < SIDE ? from + Math.max(1.2, f.side * 0.35) : 101;
  fade.from.value = from;
  fade.to.value = to;
  return (
    <>
      <RoundedBox args={[SIDE, PLATE, SIDE]} radius={0.05} smoothness={3} position={[-SIDE / 2, -PLATE / 2, -SIDE / 2]} receiveShadow material={material} renderOrder={0} />
      <Grid
        args={[SIDE, SIDE]}
        position={[-SIDE / 2, 0.003, -SIDE / 2]}
        cellSize={1}
        cellThickness={0.7}
        cellColor={mix(palette.table, palette.foreground, palette.dark ? 0.09 : 0.11)}
        sectionSize={2.5}
        sectionThickness={1.1}
        sectionColor={mix(palette.table, palette.foreground, palette.dark ? 0.2 : 0.22)}
        fadeFrom={0}
        fadeDistance={f.side < SIDE ? to : 40}
        fadeStrength={1}
        renderOrder={2}
        layers={1}
      />
    </>
  );
}

function Ruler({ palette, f }: { palette: Palette; f: Framing }) {
  const [x, z] = rulerAt(f);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, H_MAX / 2, 0]} castShadow>
        <boxGeometry args={[0.022, H_MAX, 0.022]} />
        <meshStandardMaterial color={palette.muted} roughness={1} />
      </mesh>
      {AGE_TICKS.map((a) => (
        <mesh key={a} position={[0, heightAt(a), 0]} rotation={[0, Math.PI / 4, 0]}>
          <boxGeometry args={[0.18, 0.016, 0.016]} />
          <meshStandardMaterial color={palette.muted} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

export interface WorldApi {
  home: (smooth: boolean) => void;
  frame: (list: Placed[]) => void;
  project: (p: Placed) => [number, number];
  turn: (azimuth: number, polar: number) => void;
  zoom: (factor: number) => void;
}

export interface WorldProps {
  placed: Placed[];
  palette: Palette;
  portal: RefObject<HTMLDivElement | null>;
  framing: Framing;
  plateLabel: string;
  version: number;
  pointing: Pointing;
  reduced: boolean;
  queued: Set<string>;
  pinned: Set<string>;
  outline: (p: Placed) => number;
  api: Ref<WorldApi>;
  onMove: () => void;
}

export function World({ placed, palette, portal, framing: f, plateLabel, version, pointing, reduced, queued, pinned, outline, api, onMove }: WorldProps) {
  const controls = useRef<CameraControlsImpl | null>(null);
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const raycaster = useThree((s) => s.raycaster);
  const home = useRef(true);
  const homeZoom = useRef(1);
  useEffect(() => {
    camera.layers.enable(1);
    raycaster.layers.enable(1);
  }, [camera, raycaster]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    gl.domElement.style.touchAction = 'pan-y';
    const pad = homePad(size.width, size.height, f);
    homeZoom.current = fit(camera, homeBox(f), HOME.theta, HOME.phi, pad).zoom;
    if (home.current) frameTo(c, camera, homeBox(f), HOME.theta, HOME.phi, pad, false);
  }, [camera, size.width, size.height, gl, f]);
  useImperativeHandle(
    api,
    () => ({
      home: (smooth) => {
        const c = controls.current;
        if (!c) return;
        home.current = true;
        frameTo(c, camera, homeBox(f), HOME.theta, HOME.phi, homePad(size.width, size.height, f), smooth && !reduced);
      },
      frame: (list) => {
        const c = controls.current;
        if (!c || !list.length) return;
        home.current = false;
        const box = boxOf(list);
        const pad = Math.min(size.width, size.height) * 0.12;
        frameTo(c, camera, box, c.azimuthAngle, c.polarAngle, { left: pad, right: pad, top: pad, bottom: pad }, !reduced);
      },
      project: (p) => {
        camera.updateMatrixWorld();
        const v = new Vector3(p.cx, p.h, p.cz).project(camera);
        return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
      },
      turn: (azimuth, polar) => {
        const c = controls.current;
        if (!c) return;
        home.current = false;
        void c.rotate(azimuth, polar, !reduced);
      },
      zoom: (factor) => {
        const c = controls.current;
        if (!c) return;
        home.current = false;
        void c.zoomTo(c.camera.zoom * factor, !reduced);
      },
    }),
    [camera, size, f, reduced],
  );
  return (
    <>
      <Lights dark={palette.dark} />
      <Plate palette={palette} f={f} />
      <ContactShadows key={version} frames={reduced ? 2 : 40} position={[-SIDE / 2, 0.001, -SIDE / 2]} scale={SIDE} resolution={1024} blur={1.4} far={0.7} opacity={palette.dark ? 0.75 : 0.45} color="#000000" renderOrder={1} />
      <Blocks placed={placed} palette={palette} pointing={pointing} reduced={reduced} />
      <Foundations placed={placed} palette={palette} pointing={pointing} />
      <Marks placed={placed} palette={palette} selected={pointing.selected} queued={queued} pinned={pinned} outline={outline} />
      <Ruler palette={palette} f={f} />
      <Overlay placed={placed} f={f} plateLabel={plateLabel} controls={controls} portal={portal} homeZoom={homeZoom} />
      <CameraControls
        ref={controls}
        makeDefault
        minPolarAngle={0.2}
        maxPolarAngle={1.35}
        smoothTime={reduced ? 0 : 0.18}
        draggingSmoothTime={reduced ? 0 : 0.08}
        onControlStart={() => {
          home.current = false;
          onMove();
        }}
      />
    </>
  );
}
