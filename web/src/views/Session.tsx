import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { events, session, type Dropped, type SessionData } from '@/lib/api';
import { rel, tokens } from '@/lib/format';
import { ContextChart, scaled, type Layer } from './ContextChart';
import { ActionBar, CompactionBlock } from './Dropped';

const ORDER = ['system', 'memory', 'skills', 'summary', 'prompts', 'replies'];
const MAX_TOOL_LAYERS = 4;

function buildLayers(d: SessionData): Layer[] {
  const label = new Map(d.categories.map((c) => [c.key, c.label]));
  const totals = new Map<string, number>();
  for (const p of d.points) for (const [k, v] of Object.entries(p.est)) totals.set(k, (totals.get(k) ?? 0) + v);
  const layers: Layer[] = [];
  for (const k of ORDER) if (totals.get(k)) layers.push({ key: `c${layers.length}`, label: label.get(k) ?? k, cats: [k] });
  const tools = [...totals.entries()].filter(([k]) => k.startsWith('tool:')).sort((a, b) => b[1] - a[1]);
  for (const [k] of tools.slice(0, MAX_TOOL_LAYERS)) layers.push({ key: `c${layers.length}`, label: label.get(k) ?? k, cats: [k] });
  const rest = tools.slice(MAX_TOOL_LAYERS).map(([k]) => k);
  if (rest.length) layers.push({ key: `c${layers.length}`, label: `Tool results, ${rest.length} other tools`, cats: rest });
  return layers;
}

function merge(prev: SessionData | null, next: SessionData): SessionData {
  if (!prev || next.from === 0) return next;
  return { ...next, points: [...prev.points.slice(0, next.from), ...next.points] };
}

export function Session({ id }: { id: string }) {
  const [data, setData] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const count = useRef(0);
  const [picked, setPicked] = useState<Map<string, Dropped>>(new Map());
  const toggle = useCallback((key: string, d: Dropped, on: boolean) => {
    setPicked((m) => {
      const n = new Map(m);
      if (on) n.set(key, d);
      else n.delete(key);
      return n;
    });
  }, []);

  const load = useCallback(
    (since: number) =>
      session(id, since)
        .then((d) => {
          setData((prev) => merge(since ? prev : null, d));
          setError(null);
        })
        .catch((e: Error) => setError(e.message === '404' ? 'The transcript for this session is no longer on disk.' : 'The claude-ctx server stopped, so run claude-ctx again to reopen this page.')),
    [id],
  );

  useEffect(() => {
    setData(null);
    setSelected(null);
    setLive(false);
    setPicked(new Map());
    void load(0);
  }, [id, load]);

  useEffect(() => {
    count.current = data?.points.length ?? 0;
  }, [data]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    const stop = events(id, (e) => {
      if (e === 'change') {
        setLive(true);
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(() => setLive(false), 120000);
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          void load(count.current);
        }, 400);
      }
      if (e === 'items') void load(count.current);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
      if (quiet) clearTimeout(quiet);
    };
  }, [id, load]);

  const layers = useMemo(() => (data ? buildLayers(data) : []), [data]);
  const points = data?.points ?? [];
  const at = selected != null && selected < points.length ? selected : points.length - 1;
  const point = points[at];
  const split = point ? scaled(point, layers) : {};
  const compactions = useMemo(() => [...(data?.compactions ?? [])].reverse(), [data]);
  const peak = points.reduce((m, p) => Math.max(m, p.total), 0);

  if (error && !data)
    return (
      <div>
        <Back />
        <p className="mt-8 text-destructive">{error}</p>
      </div>
    );

  if (!data)
    return (
      <div aria-busy="true" aria-label="Reading the transcript">
        <Back />
        <Skeleton className="mt-6 h-9 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/3" />
        <Skeleton className="mt-8 h-[300px] w-full md:h-[360px]" />
      </div>
    );

  return (
    <div>
      <Back />
      <h1 className="mt-5 font-heading text-[1.9rem] font-bold leading-[1.15] tracking-[-0.025em] text-balance md:text-[2.3rem]">{data.title || 'Untitled session'}</h1>
      <p className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-muted-foreground">
        {data.cwd && <span>{data.cwd}</span>}
        {data.model && <span>{data.model}</span>}
        <span>{points.length} calls</span>
        <span>peak {tokens(peak)}</span>
        {live && <span className="font-sans text-[0.85rem] font-semibold text-foreground">Following live</span>}
      </p>

      <section className="mt-9" aria-labelledby="ctx-title">
        <h2 id="ctx-title" className="font-heading text-[1.35rem] font-bold tracking-[-0.015em]">
          What fills the context
        </h2>
        {points.length === 0 ? (
          <p className="mt-6 text-[0.95rem]">No model calls in this transcript yet.</p>
        ) : (
          <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="rounded-lg border bg-card px-2 pb-2 pt-1">
              <ContextChart points={points} layers={layers} compactions={data.compactions} selected={selected} onSelect={setSelected} />
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <h3 className="text-[0.95rem] font-semibold">Call {at + 1}</h3>
                <span className="num text-[0.95rem] font-semibold">{tokens(point.total)}</span>
              </div>
              <ul className="mt-3 grid gap-1.5">
                {layers
                  .map((l, i) => ({ l, i, v: split[l.key] ?? 0 }))
                  .reverse()
                  .map(({ l, i, v }) => (
                    <li key={l.key} className="flex items-center gap-2.5 text-[0.86rem]">
                      <span aria-hidden className="size-3 shrink-0 rounded-[3px]" style={{ background: `var(--strata-${i})` }} />
                      <span className="truncate">{l.label}</span>
                      <span className="num ml-auto text-[0.8rem] text-muted-foreground">{v ? tokens(v) : ''}</span>
                      <span className="num w-10 text-right text-[0.8rem]">{point.total ? `${Math.round((v / point.total) * 100)}%` : ''}</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">The split is an estimate scaled to the exact total.</p>
            </div>
          </div>
        )}
      </section>

      {data.largest.length > 0 && (
        <section className="mt-12" aria-labelledby="big-title">
          <h2 id="big-title" className="font-heading text-[1.35rem] font-bold tracking-[-0.015em]">
            Largest items in context now
          </h2>
          <ol className="mt-4 grid grid-cols-1 gap-x-10 md:grid-cols-2">
            {data.largest.map((t, i) => (
              <li key={`${t.label}-${i}`} className="flex min-w-0 items-baseline gap-3 border-b py-2.5">
                <span className="num w-14 shrink-0 text-right text-[0.85rem] font-semibold">{tokens(t.tok)}</span>
                <span className="min-w-0 flex-1">
                  <span className="num block truncate text-[0.82rem]" title={t.label}>
                    {t.label.startsWith('/') ? rel(t.label, data.root) : t.label}
                    {t.count && t.count > 1 ? <span className="text-muted-foreground"> ×{t.count}</span> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{data.categories.find((c) => c.key === t.cat)?.label ?? (t.cat === 'system' ? 'System and tools' : t.cat)}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">Token counts here are estimates.</p>
        </section>
      )}

      <section className="mt-14" aria-labelledby="cmp-title">
        <h2 id="cmp-title" className="font-heading text-[1.35rem] font-bold tracking-[-0.015em]">
          Compactions
        </h2>
        {compactions.length === 0 ? (
          <p className="mt-2 text-[0.95rem] text-muted-foreground">No compactions in this session yet.</p>
        ) : (
          <div className="mt-6 grid gap-12">
            {compactions.map((c, i) => (
              <CompactionBlock key={`${c.n}-${i}`} root={data.root} index={i} total={compactions.length} c={c} queued={data.queued} pins={data.pins} picked={picked} onToggle={toggle} />
            ))}
          </div>
        )}
      </section>
      <ActionBar
        session={id}
        picked={picked}
        onDone={() => {
          setPicked(new Map());
          void load(count.current);
        }}
      />
    </div>
  );
}

function Back() {
  return (
    <a href="#/" className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline">
      <ArrowLeft aria-hidden className="size-4" />
      All sessions
    </a>
  );
}
