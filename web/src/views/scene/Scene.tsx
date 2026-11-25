import { useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import type { Dropped, Item } from '@/lib/api';
import { tokens } from '@/lib/format';
import { plan, piecesAround, piecesAt, type Line } from '@/lib/model';
import { usePalette } from './palette';
import { framing, place, SIDE } from './layout';
import { World, type WorldApi } from './World';

export interface Payload {
  kind: string;
  label: string;
  text: string;
}

export interface SceneProps {
  line: Line;
  call: number;
  total: number;
  cut: { n: number; index: number; before: number; after: number } | null;
  plate: number;
  peak: number;
  last: number;
  label: string;
  root?: string;
  pins: Item[];
  queued: Item[];
  dropped: Dropped[];
  onSend: (kind: 'pin' | 'putback', payload: Payload) => Promise<void>;
}

const still = { hover: null, selected: null, onHover: () => {}, onPress: () => {}, onFrame: () => {} };

export default function Scene({ line, call, total, cut, plate, peak, last, label }: SceneProps) {
  const palette = usePalette();
  const overlay = useRef<HTMLDivElement>(null);
  const api = useRef<WorldApi>(null);
  const none = useMemo(() => new Set<string>(), []);
  const pieces = useMemo(() => (cut ? piecesAround(line, cut.n, cut.before, cut.after) : piecesAt(line, call, total)), [line, call, total, cut]);
  const placed = useMemo(() => place(plan(pieces, plate, SIDE)), [pieces, plate]);
  const f = useMemo(() => framing(peak, plate, last), [peak, plate, last]);
  const version = useRef({ placed, n: 0 });
  if (version.current.placed !== placed) version.current = { placed, n: version.current.n + 1 };
  return (
    <div className="relative h-[16rem] sm:h-[27rem]" role="img" aria-label={label}>
      <Canvas orthographic frameloop="demand" shadows="percentage" flat dpr={[1, 2]} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }} camera={{ position: [20, 20, 20], zoom: 40, near: 0.1, far: 200 }}>
        <World placed={placed} palette={palette} portal={overlay} framing={f} plateLabel={`${tokens(plate)} window`} version={version.current.n} pointing={still} reduced={false} queued={none} pinned={none} outline={() => 0} api={api} onMove={() => {}} />
      </Canvas>
      <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
