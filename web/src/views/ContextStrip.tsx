import { useMemo, type PointerEvent } from 'react';
import { Group } from '@visx/group';
import { useParentSize } from '@visx/responsive';
import { scaleLinear } from '@visx/scale';
import { Line, LinePath } from '@visx/shape';
import { Slider } from '@/components/ui/slider';
import type { Compaction, Point } from '@/lib/api';
import { exact, tokens } from '@/lib/format';

const LANE = 18;
const PLOT = 72;
const SNAP = 6;

interface Props {
  points: Point[];
  compactions: Compaction[];
  window: number | null;
  call: number;
  hover: number | null;
  chosen: number | null;
  hoverCut: number | null;
  onHover: (call: number | null, cut: number | null) => void;
  onPick: (call: number) => void;
  onPickCut: (cut: number) => void;
}

export function cutNumbers(c: Compaction, points: Point[]): [number, number] {
  const pre = c.pre || points[c.n - 1]?.total || 0;
  const post = c.post || points[c.n]?.total || 0;
  return [pre, post];
}

export function ContextStrip({ points, compactions, window, call, hover, chosen, hoverCut, onHover, onPick, onPickCut }: Props) {
  const { parentRef, width } = useParentSize({ debounceTime: 30 });
  const n = points.length;
  const peak = useMemo(() => points.reduce((m, p) => Math.max(m, p.total), 0), [points]);
  const top = window && window <= peak * 2.5 ? window : Math.max(1, peak * 1.1);
  const x = useMemo(() => scaleLinear<number>({ domain: [0, Math.max(1, n - 1)], range: [0, Math.max(1, width)] }), [n, width]);
  const y = useMemo(() => scaleLinear<number>({ domain: [0, top], range: [PLOT, 0] }), [top]);
  const cutX = (c: Compaction) => x(Math.max(0, c.n - 0.5));

  const near = (px: number): number | null => {
    let best: number | null = null;
    let d = SNAP + 1;
    compactions.forEach((c, i) => {
      if (c.n <= 0 || c.n >= n) return;
      const dist = Math.abs(cutX(c) - px);
      if (dist <= SNAP && dist < d) {
        d = dist;
        best = i;
      }
    });
    return best;
  };
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    return { px, i: Math.max(0, Math.min(n - 1, Math.round(x.invert(px)))) };
  };

  const labelCut = hoverCut ?? chosen;
  const lc = labelCut != null ? compactions[labelCut] : undefined;
  const p = points[call];
  const shown = hover != null ? points[hover] : undefined;

  return (
    <div className="relative select-none">
      <div className="num pointer-events-none relative h-[18px] text-[0.6875rem] text-muted-foreground" aria-hidden>
        {lc && width > 0 && (
          <span
            className="absolute top-0 whitespace-nowrap font-semibold text-foreground"
            style={cutX(lc) < width / 2 ? { left: Math.max(0, cutX(lc) - 4) } : { right: Math.max(0, width - cutX(lc) - 4) }}
          >
            {cutNumbers(lc, points).map(tokens).join(' to ')}
          </span>
        )}
      </div>
      <div
        ref={parentRef}
        className="relative rounded-[2px] has-[[data-slot=slider-thumb]:focus-visible]:outline-2 has-[[data-slot=slider-thumb]:focus-visible]:outline-offset-4 has-[[data-slot=slider-thumb]:focus-visible]:outline-ring"
        style={{ height: PLOT }}
        onPointerMove={(e) => {
          const { px, i } = at(e);
          onHover(i, near(px));
        }}
        onPointerLeave={() => onHover(null, null)}
        onPointerDownCapture={(e) => {
          const cut = near(at(e).px);
          if (cut != null) {
            e.stopPropagation();
            e.preventDefault();
            onPickCut(cut);
          }
        }}
      >
        {width > 0 && (
          <svg width={width} height={PLOT} className="absolute inset-0 overflow-visible" aria-hidden>
            <Group>
              {window && window === top && <Line from={{ x: 0, y: y(window) }} to={{ x: width, y: y(window) }} stroke="var(--muted-foreground)" strokeOpacity={0.45} strokeDasharray="2 4" />}
              <Line from={{ x: 0, y: PLOT - 0.5 }} to={{ x: width, y: PLOT - 0.5 }} stroke="var(--border)" />
              {hover != null && hover !== call && <Line from={{ x: x(hover), y: 0 }} to={{ x: x(hover), y: PLOT }} stroke="var(--muted-foreground)" strokeOpacity={0.5} />}
              {lc && <Line from={{ x: cutX(lc), y: 0 }} to={{ x: cutX(lc), y: PLOT }} stroke="var(--foreground)" strokeOpacity={0.35} />}
              <LinePath data={points} x={(_, i) => x(i)} y={(d) => y(d.total)} stroke="var(--foreground)" strokeWidth={1.5} strokeLinejoin="round" />
              {chosen != null && compactions[chosen] && compactions[chosen].n > 0 && compactions[chosen].n < n && (
                <LinePath
                  data={[points[compactions[chosen].n - 1], points[compactions[chosen].n]]}
                  x={(_, i) => x(compactions[chosen].n - 1 + i)}
                  y={(d) => y(d.total)}
                  stroke="var(--foreground)"
                  strokeWidth={3}
                />
              )}
              {p && chosen == null && (
                <>
                  <Line from={{ x: x(call), y: 0 }} to={{ x: x(call), y: PLOT }} stroke="var(--foreground)" strokeOpacity={0.5} />
                  <circle cx={x(call)} cy={y(p.total)} r={3.5} fill="var(--foreground)" stroke="var(--background)" strokeWidth={2} />
                </>
              )}
            </Group>
          </svg>
        )}
        <Slider
          className="absolute inset-0 h-full cursor-crosshair [&_[data-slot=slider-range]]:hidden [&_[data-slot=slider-thumb]]:h-full [&_[data-slot=slider-thumb]]:w-px [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-transparent [&_[data-slot=slider-thumb]]:outline-none [&_[data-slot=slider-thumb]]:ring-0 [&_[data-slot=slider-thumb]]:after:hidden [&_[data-slot=slider-track]]:h-full [&_[data-slot=slider-track]]:bg-transparent"
          min={0}
          max={Math.max(0, n - 1)}
          step={1}
          value={[call]}
          onValueChange={([v]) => onPick(v)}
          thumbLabel="Call"
          valueText={p ? `Call ${call + 1} of ${n}, ${exact(p.total)} tokens` : undefined}
        />
      </div>
      <div className="num pointer-events-none flex h-[18px] items-end justify-between text-[0.6875rem] text-muted-foreground" aria-hidden>
        <span>1</span>
        <span>{shown ? `call ${(hover ?? 0) + 1}, ${exact(shown.total)}` : window && window === top ? `${tokens(window)} window` : ''}</span>
        <span>{n}</span>
      </div>
    </div>
  );
}
