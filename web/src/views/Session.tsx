import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { events, peek, send, session, type Item, type Peek, type SessionData, type TimelineData } from '@/lib/api';
import { treeOf, windowOf } from '@/lib/context';
import { AGE_CAP, piecesAt, piecesBefore } from '@/lib/model';
import { ago, exact, tokens } from '@/lib/format';
import { ContextStrip, cutNumbers } from './ContextStrip';
import { DroppedList } from './Dropped';
import { Breakdown, Icicle, type PinState } from './Icicle';
import { rowTitle } from './Sessions';

function merge(prev: SessionData | null, next: SessionData): SessionData {
  if (!prev || next.from === 0) return next;
  const a = prev.timeline;
  const b = next.timeline;
  const timeline = {
    ...b,
    labelsFrom: 0,
    labels: [...a.labels.slice(0, b.labelsFrom), ...b.labels],
    closedFrom: 0,
    closed: [...a.closed.slice(0, b.closedFrom), ...b.closed],
  };
  return { ...next, points: [...prev.points.slice(0, next.from), ...next.points], timeline };
}

function useNarrow(): boolean {
  const q = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

const loadScene = () => import('./scene/Scene');
type SceneView = Awaited<ReturnType<typeof loadScene>>['default'];

export function preloadScene(): void {
  const go = () => void loadScene().catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 });
  else setTimeout(go, 400);
}

const SCENE_HEIGHT = 'h-[16rem] sm:h-[27rem]';
const EMPTY: TimelineData = { cats: [], labelsFrom: 0, labels: [], closedFrom: 0, closed: [], live: [] };
const LATE_MS = 300;
const NONE: Item[] = [];

const mb = (bytes: number) => Math.max(1, Math.round(bytes / 1e6)).toLocaleString('en-US');

function readingLine(size: number, at: number | null): string {
  return at == null ? `reading ${mb(size)} MB` : `reading ${mb(Math.min(at, size))} of ${mb(size)} MB`;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

function niceWindow(peak: number): number {
  const steps = [50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000];
  return steps.find((s) => s >= peak * 1.1) ?? Math.ceil((peak * 1.1) / 1_000_000) * 1_000_000;
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const LINK = 'font-semibold underline decoration-foreground/35 underline-offset-4 transition-colors duration-150 hover:decoration-foreground';

export function Session({ id }: { id: string }) {
  const [data, setData] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverCut, setHoverCut] = useState<number | null>(null);
  const [cut, setCut] = useState<number | null>(null);
  const [focus, setFocus] = useState('used');
  const [live, setLive] = useState(false);
  const [head, setHead] = useState<Peek | null>(null);
  const [late, setLate] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const count = useRef({ points: 0, closed: 0, labels: 0 });
  const narrow = useNarrow();
  const webgl = useMemo(hasWebGL, []);
  const [Scene, setScene] = useState<SceneView | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!webgl) return;
    let live = true;
    loadScene()
      .then((m) => live && setScene(() => m.default))
      .catch(() => live && setBroken(true));
    return () => {
      live = false;
    };
  }, [webgl]);
  const top = useRef<HTMLElement>(null);

  const load = useCallback(
    (since: boolean) =>
      session(id, since ? count.current.points : 0, since ? count.current.closed : 0, since ? count.current.labels : 0)
        .then((d) => {
          setData((prev) => merge(since ? prev : null, d));
          setError(null);
        })
        .catch((e: Error) => setError(e.message === '404' ? 'The transcript for this session is no longer on disk.' : 'The claude-ctx server stopped, so run claude-ctx again to reopen this page.')),
    [id],
  );

  useEffect(() => {
    setData(null);
    setPinned(null);
    setCut(null);
    setFocus('used');
    setLive(false);
    setHead(null);
    setAt(null);
    setLate(false);
    let done = false;
    peek(id)
      .then((p) => !done && !p.ready && setHead(p))
      .catch(() => {});
    const timer = setTimeout(() => setLate(true), LATE_MS);
    void load(false).finally(() => {
      done = true;
    });
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [id, load]);

  useEffect(() => {
    count.current = { points: data?.points.length ?? 0, closed: data?.timeline.closed.length ?? 0, labels: data?.timeline.labels.length ?? 0 };
  }, [data]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    const stop = events(id, (e, d) => {
      if (e === 'reading') {
        const r = d as { at?: number } | null;
        if (typeof r?.at === 'number') setAt(r.at);
      }
      if (e === 'change') {
        setLive(true);
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(() => setLive(false), 120000);
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          void load(true);
        }, 400);
      }
      if (e === 'items') void load(true);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
      if (quiet) clearTimeout(quiet);
    };
  }, [id, load]);

  const points = data?.points ?? [];
  const last = points.length - 1;
  const reading = !data && head ? head : null;
  const peak = useMemo(() => points.reduce((m, p) => Math.max(m, p.total), 0), [points]);
  const win = windowOf(data?.model ?? reading?.model, data ? peak : (reading?.peak ?? 0));
  const compactions = data?.compactions ?? [];
  const chosen = cut != null && compactions[cut] ? compactions[cut] : null;
  const call = Math.min(last, Math.max(0, hover ?? pinned ?? last));
  const point = points[call];

  const line = data?.timeline;
  const pieces = useMemo(() => (line && point ? piecesAt(line, call, point.total) : []), [line, call, point]);
  const root = useMemo(() => (point ? treeOf(pieces) : null), [point, pieces]);
  const plate = win ?? niceWindow(data ? peak : (reading?.peak ?? 0));

  const before = chosen ? points[chosen.n - 1] : undefined;
  const after = chosen ? points[chosen.n] : undefined;
  const pair = useMemo(() => {
    if (!chosen || !before || !line) return null;
    return { before: treeOf(piecesBefore(line, chosen.n, before.total), true), after: after ? treeOf(piecesAt(line, chosen.n, after.total)) : null };
  }, [chosen, before, after, line]);

  const pins: PinState = {
    pinned: (label) => !!data?.pins.some((p) => p.kind === 'file' && p.label === label),
    pin: async (label) => {
      await send('pin', { session: id, kind: 'file', label, text: '' });
      await load(true);
    },
  };

  if (error && !data)
    return (
      <div>
        <Back />
        <p className="mt-8 text-destructive">{error}</p>
      </div>
    );

  if (!data && !reading) return <div aria-busy="true" aria-label="Reading the transcript" className="min-h-60" />;
  const shown = (data ?? reading)!;
  const status = reading ? readingLine(reading.size, at) : '';
  const hide = !!reading && !late;

  const choose = (i: number) => {
    setCut(i);
    setHover(null);
    setHoverCut(null);
    top.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  };

  return (
    <div className={hide ? 'invisible' : undefined} aria-busy={hide || undefined}>
      <Back />
      <h1 className="mt-5 text-[1.0625rem] font-bold leading-snug text-balance">{rowTitle({ title: shown.title, prompt: shown.prompt, placeLabel: shown.cwd })}</h1>
      <p className="num mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        {shown.cwd && <span>{shown.cwd}</span>}
        {shown.model && <span>{shown.model}</span>}
        {data && <span>{points.length === 1 ? '1 call' : `${points.length} calls`}</span>}
        {live && <span className="font-sans font-semibold text-live">running</span>}
      </p>

      <section ref={top} className="mt-9 scroll-mt-6" aria-labelledby="ctx-title">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="ctx-title" className="text-[0.9375rem] font-bold">
            Context
          </h2>
          {point && (
            <p className="flex flex-wrap items-baseline gap-x-3 text-[0.8125rem]">
              {chosen ? (
                <>
                  <span className="text-muted-foreground">
                    Compaction {cut! + 1} at call {chosen.n}
                  </span>
                  <span className="num font-semibold">{cutNumbers(chosen, points).map(exact).join(' to ')}</span>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">
                    Call {call + 1} of {points.length}
                  </span>
                  <span className="num font-semibold">
                    {exact(point.total)}
                    {win ? <span className="font-normal text-muted-foreground"> of {tokens(win)}</span> : null}
                  </span>
                </>
              )}
              {(chosen || (pinned != null && pinned !== last)) && (
                <button
                  type="button"
                  className={LINK}
                  onClick={() => {
                    setCut(null);
                    setPinned(null);
                  }}
                >
                  Latest call
                </button>
              )}
            </p>
          )}
        </div>

        {data && (points.length === 0 || !point || !root || !line) ? (
          <p className="mt-4">No model calls in this transcript yet.</p>
        ) : (
          <div className="mt-3 grid gap-5">
            {(() => {
              const icicles = !point || !root ? (
                <p className="num text-xs text-muted-foreground">{status}</p>
              ) : chosen && pair ? (
                  <div className="grid gap-5">
                    <div className="grid gap-1.5">
                      <p className="flex items-baseline gap-3 text-[0.8125rem]">
                        <span className="font-semibold">Before, call {chosen.n}</span>
                        <span className="num text-muted-foreground">{exact(before!.total)}</span>
                      </p>
                      <Icicle root={pair.before} total={before!.total} scaleMax={Math.max(before!.total, after?.total ?? 0)} from={1} depth={narrow ? 1 : 2} label="Context before the compaction" />
                    </div>
                    {after && pair.after && (
                      <div className="grid gap-1.5">
                        <p className="flex items-baseline gap-3 text-[0.8125rem]">
                          <span className="font-semibold">After, call {chosen.n + 1}</span>
                          <span className="num text-muted-foreground">{exact(after.total)}</span>
                        </p>
                        <Icicle root={pair.after} total={after.total} scaleMax={Math.max(before!.total, after.total)} from={1} depth={narrow ? 1 : 2} label="Context after the compaction" />
                      </div>
                    )}
                  </div>
                ) : (
                  <Icicle root={root} total={point.total} depth={narrow ? Math.max(1, focusDepth(focus)) : 3} cwdRoot={shown.root} focusId={focus} onFocus={setFocus} pins={pins} label={`Context at call ${call + 1}`} />
                );
              if (!webgl || broken) return icicles;
              if (!Scene) return <div className={SCENE_HEIGHT} />;
              const cutAt = chosen && before ? { n: chosen.n, index: cut!, before: before.total, after: after?.total ?? chosen.post } : null;
              return (
                <Fallback fallback={icicles}>
                    <Scene
                      line={line ?? EMPTY}
                      call={point ? call : 0}
                      total={point?.total ?? 0}
                      cut={cutAt}
                      plate={plate}
                      peak={point ? peak : plate}
                      last={point ? last : AGE_CAP}
                      label={reading ? `Context window, ${status}` : chosen ? `Context at compaction ${cut! + 1}` : `Context at call ${call + 1}`}
                      root={shown.root}
                      pins={data?.pins ?? NONE}
                      queued={data?.queued ?? NONE}
                      dropped={chosen?.dropped ?? []}
                      reading={reading ? status : undefined}
                      hidden={hide}
                      onSend={async (kind, payload) => {
                        await send(kind, { session: id, ...payload });
                        await load(true);
                      }}
                    />
                </Fallback>
              );
            })()}

            {data && points.length > 1 && (
              <ContextStrip
                points={points}
                compactions={compactions}
                window={win}
                call={pinned ?? last}
                hover={hover}
                chosen={cut}
                hoverCut={hoverCut}
                onHover={(c, h) => {
                  setHover(chosen ? null : c);
                  setHoverCut(h);
                }}
                onPick={(c) => {
                  setCut(null);
                  setPinned(c === last ? null : c);
                }}
                onPickCut={choose}
              />
            )}

            {!data || !point || !root ? null : chosen ? (
              <div className="grid gap-5">
                <p className="text-xs text-muted-foreground">The split is an estimate scaled to the exact total.</p>
                <DroppedList session={id} root={data.root} c={chosen} queued={data.queued} pins={data.pins} onDone={() => void load(true)} />
              </div>
            ) : (
              <div className="grid gap-5">
                <Breakdown root={root} total={point.total} cwdRoot={data.root} focusId={focus} onFocus={setFocus} pins={pins} />
                <p className="text-xs text-muted-foreground">The split is an estimate scaled to the exact total.</p>
              </div>
            )}
          </div>
        )}
      </section>

      {compactions.length > 0 && (
        <section className="mt-12" aria-labelledby="cmp-title">
          <h2 id="cmp-title" className="text-[0.9375rem] font-bold">
            Compactions
          </h2>
          <ul className="mt-2 grid">
            {compactions.map((c, i) => (
              <li key={`${c.n}-${i}`}>
                <button
                  type="button"
                  data-compaction={i}
                  aria-pressed={cut === i}
                  onClick={() => choose(i)}
                  className="group -mx-2 flex w-[calc(100%+1rem)] flex-wrap items-baseline gap-x-4 gap-y-0.5 rounded-sm px-2 py-1.5 text-left transition-colors duration-150 hover:bg-accent"
                >
                  <span className={`font-medium ${cut === i ? 'underline decoration-foreground/40 underline-offset-4' : ''}`}>Compaction {i + 1}</span>
                  <span className="num text-xs text-muted-foreground">
                    call {c.n}, {cutNumbers(c, points).map(tokens).join(' to ')}, {c.trigger}, {ago(c.t)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function focusDepth(id: string): number {
  if (id === 'used') return 1;
  if (id.startsWith('tool:')) return 3;
  return 2;
}

function Back() {
  return (
    <a href="#/" className="inline-flex items-center gap-1.5 text-sm font-semibold no-underline transition-colors duration-150 hover:underline hover:decoration-foreground/40 hover:underline-offset-4">
      <ArrowLeft aria-hidden className="size-4" />
      All sessions
    </a>
  );
}
