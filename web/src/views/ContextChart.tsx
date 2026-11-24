import { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import type { Compaction, Point } from '@/lib/api';
import { tokens } from '@/lib/format';

export interface Layer {
  key: string;
  label: string;
  cats: string[];
}

export const MAX_POINTS = 700;

export function sample(points: Point[], keep: Set<number>): Point[] {
  if (points.length <= MAX_POINTS) return points;
  const b = Math.ceil(points.length / MAX_POINTS);
  const idx = new Set<number>([...keep].filter((i) => i >= 0 && i < points.length));
  for (let i = 0; i < points.length; i += b) {
    let best = i;
    for (let j = i; j < Math.min(points.length, i + b); j++) if (points[j].total > points[best].total) best = j;
    idx.add(best);
  }
  return [...idx].sort((x, y) => x - y).map((i) => points[i]);
}

export function scaled(p: Point, layers: Layer[]): Record<string, number> {
  const k = p.raw > 0 ? p.total / p.raw : 0;
  const row: Record<string, number> = {};
  for (const l of layers) {
    let v = 0;
    for (const c of l.cats) v += p.est[c] ?? 0;
    row[l.key] = Math.round(v * k);
  }
  return row;
}

interface Props {
  points: Point[];
  layers: Layer[];
  compactions: Compaction[];
  selected: number | null;
  onSelect: (n: number) => void;
}

function TipBody({ point, layers }: { point: Point; layers: Layer[] }) {
  const row = scaled(point, layers);
  const items = layers.map((l, i) => ({ l, i, v: row[l.key] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  return (
    <div className="min-w-[15rem] rounded-md border bg-popover px-3 py-2.5 text-popover-foreground shadow-[0_6px_24px_-8px_oklch(0.2_0.04_220/0.35)]">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-semibold">Call {point.n + 1}</span>
        <span className="num text-sm font-semibold">{tokens(point.total)}</span>
      </div>
      <div className="num mt-0.5 text-[0.7rem] text-muted-foreground">
        {tokens(point.read)} cached, {tokens(point.write)} written, {tokens(point.input)} new
      </div>
      <div className="mt-2 grid gap-1 border-t pt-2">
        {items.map(({ l, i, v }) => (
          <div key={l.key} className="flex items-center gap-2 text-[0.78rem]">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: `var(--kind-${['tools', 'system', 'memory', 'prompts', 'replies', 'summary'][i % 6]})` }} />
            <span className="truncate">{l.label}</span>
            <span className="num ml-auto text-muted-foreground">{tokens(v)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[0.7rem] text-muted-foreground">Split is an estimate</div>
    </div>
  );
}

export function ContextChart({ points, layers, compactions, selected, onSelect }: Props) {
  const keep = useMemo(() => {
    const s = new Set<number>();
    for (const c of compactions) {
      if (c.n > 0) s.add(c.n - 1);
      s.add(c.n);
    }
    if (points.length) s.add(points.length - 1);
    return s;
  }, [compactions, points.length]);

  const data = useMemo(() => sample(points, keep).map((p) => ({ x: p.n + 1, total: p.total, ...scaled(p, layers) })), [points, layers, keep]);
  const config = useMemo(() => {
    const c: ChartConfig = { total: { label: 'Exact total', color: 'var(--foreground)' } };
    layers.forEach((l, i) => (c[l.key] = { label: l.label, color: `var(--kind-${['tools', 'system', 'memory', 'prompts', 'replies', 'summary'][i % 6]})` }));
    return c;
  }, [layers]);
  const byN = useMemo(() => new Map(points.map((p) => [p.n + 1, p])), [points]);

  return (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-full md:h-[360px]">
      <ComposedChart
        data={data}
        margin={{ top: 28, right: 12, bottom: 4, left: 0 }}
        onClick={(s) => {
          const label = Number(s?.activeLabel);
          if (Number.isFinite(label) && label > 0) onSelect(label - 1);
        }}
      >
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} className="num" fontSize={11} />
        <YAxis tickFormatter={(v: number) => tokens(v)} tickLine={false} axisLine={false} width={44} className="num" fontSize={11} />
        <Tooltip
          cursor={{ stroke: 'var(--foreground)', strokeOpacity: 0.25 }}
          isAnimationActive={false}
          content={({ active, label }) => {
            const p = active ? byN.get(Number(label)) : undefined;
            return p ? <TipBody point={p} layers={layers} /> : null;
          }}
        />
        {layers.map((l) => (
          <Area key={l.key} dataKey={l.key} stackId="ctx" type="linear" stroke="none" fill={`var(--color-${l.key})`} fillOpacity={1} isAnimationActive={false} />
        ))}
        <Line dataKey="total" type="linear" stroke="var(--color-total)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        {compactions.map((c, i) => (
          <ReferenceLine
            key={`${c.n}-${i}`}
            x={c.n + 0.5}
            stroke="var(--live)"
            strokeWidth={2}
            label={{ value: `${tokens(c.pre)} to ${tokens(c.post)}`, position: 'top', fill: 'var(--foreground)', fontSize: 11, className: 'num' }}
          />
        ))}
        {selected != null && <ReferenceLine x={selected + 1} stroke="var(--foreground)" strokeOpacity={0.55} strokeDasharray="3 3" />}
      </ComposedChart>
    </ChartContainer>
  );
}
