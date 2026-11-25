import { useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { plan, piecesAround, piecesAt, type Line } from '@/lib/model';
import { usePalette } from './palette';
import { place, SIDE, World } from './World';

export interface SceneProps {
  line: Line;
  call: number;
  total: number;
  cut: { n: number; before: number; after: number } | null;
  plate: number;
  label: string;
}

export default function Scene({ line, call, total, cut, plate, label }: SceneProps) {
  const palette = usePalette();
  const overlay = useRef<HTMLDivElement>(null);
  const pieces = useMemo(() => (cut ? piecesAround(line, cut.n, cut.before, cut.after) : piecesAt(line, call, total)), [line, call, total, cut]);
  const placed = useMemo(() => place(plan(pieces, plate, SIDE)), [pieces, plate]);
  return (
    <div className="relative h-[16rem] sm:h-[27rem]" role="img" aria-label={label}>
      <Canvas orthographic frameloop="demand" shadows="percentage" flat dpr={[1, 2]} gl={{ antialias: true, alpha: true }} camera={{ position: [20, 20, 20], zoom: 40, near: 0.1, far: 200 }}>
        <World placed={placed} palette={palette} portal={overlay} />
      </Canvas>
      <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
