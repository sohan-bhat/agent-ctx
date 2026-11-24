import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { events, send, session, type SessionData, type Top } from '@/lib/api';
import { survival, tree, windowOf } from '@/lib/context';
import { ago, exact, tokens } from '@/lib/format';
import { ContextStrip, cutNumbers } from './ContextStrip';
import { DroppedList } from './Dropped';
import { Breakdown, Icicle, type PinState } from './Icicle';
import { rowTitle } from './Sessions';

function merge(prev: SessionData | null, next: SessionData): SessionData {
  if (!prev || next.from === 0) return next;
  return { ...next, points: [...prev.points.slice(0, next.from), ...next.points] };
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
  const count = useRef(0);
  const narrow = useNarrow();
  const top = useRef<HTMLElement>(null);

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
    setPinned(null);
    setCut(null);
    setFocus('used');
    setLive(false);
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

  const points = data?.points ?? [];
  const last = points.length - 1;
  const peak = useMemo(() => points.reduce((m, p) => Math.max(m, p.total), 0), [points]);
  const win = windowOf(data?.model, peak);
  const compactions = data?.compactions ?? [];
  const chosen = cut != null && compactions[cut] ? compactions[cut] : null;
  const call = Math.min(last, Math.max(0, hover ?? pinned ?? last));
  const point = points[call];

  const items = useMemo((): Top[] => {
    if (!data) return [];
    if (call === last) return data.largest;
    return data.compactions.find((c) => c.n - 1 === call)?.before ?? [];
  }, [data, call, last]);
  const root = useMemo(() => (point ? tree(point, items) : null), [point, items]);

  const before = chosen ? points[chosen.n - 1] : undefined;
  const after = chosen ? points[chosen.n] : undefined;
  const pair = useMemo(() => {
    if (!before) return null;
    return { before: tree(before, [], survival(before, after)), after: after ? tree(after) : null };
  }, [before, after]);

  const pins: PinState = {
    pinned: (label) => !!data?.pins.some((p) => p.kind === 'file' && p.label === label),
    pin: async (label) => {
      await send('pin', { session: id, kind: 'file', label, text: '' });
      await load(count.current);
    },
  };

  if (error && !data)
    return (
      <div>
        <Back />
        <p className="mt-8 text-destructive">{error}</p>
      </div>
    );

  if (!data) return <div aria-busy="true" aria-label="Reading the transcript" className="min-h-60" />;

  const choose = (i: number) => {
    setCut(i);
    setHover(null);
    setHoverCut(null);
    top.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  };

  return (
    <div>
      <Back />
      <h1 className="mt-5 text-[1.0625rem] font-bold leading-snug text-balance">{rowTitle({ title: data.title, prompt: data.prompt, placeLabel: data.cwd })}</h1>
      <p className="num mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        {data.cwd && <span>{data.cwd}</span>}
        {data.model && <span>{data.model}</span>}
        <span>{points.length === 1 ? '1 call' : `${points.length} calls`}</span>
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
                  <span className="num font-semibold">{exact(point.total)}</span>
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

        {points.length === 0 || !point || !root ? (
          <p className="mt-4">No model calls in this transcript yet.</p>
        ) : (
          <div className="mt-3 grid gap-6">
            {points.length > 1 && <ContextStrip
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
            />}

            {chosen && pair ? (
              <div className="grid gap-5">
                <div className="grid gap-1.5">
                  <p className="flex items-baseline gap-3 text-[0.8125rem]">
                    <span className="font-semibold">Before, call {chosen.n}</span>
                    <span className="num text-muted-foreground">{exact(before!.total)}</span>
                  </p>
                  <Icicle root={pair.before} total={before!.total} scaleMax={Math.max(before!.total, after?.total ?? 0)} depth={narrow ? 1 : 2} label="Context before the compaction" />
                </div>
                {after && pair.after && (
                  <div className="grid gap-1.5">
                    <p className="flex items-baseline gap-3 text-[0.8125rem]">
                      <span className="font-semibold">After, call {chosen.n + 1}</span>
                      <span className="num text-muted-foreground">{exact(after.total)}</span>
                    </p>
                    <Icicle root={pair.after} total={after.total} scaleMax={Math.max(before!.total, after.total)} depth={narrow ? 1 : 2} label="Context after the compaction" />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">The split is an estimate scaled to the exact total.</p>
                <DroppedList session={id} root={data.root} c={chosen} queued={data.queued} pins={data.pins} onDone={() => void load(count.current)} />
              </div>
            ) : (
              <div className="grid gap-5">
                <Icicle
                  root={root}
                  total={point.total}
                  window={win}
                  depth={narrow ? Math.max(1, focusDepth(focus)) : 3}
                  cwdRoot={data.root}
                  focusId={focus}
                  onFocus={setFocus}
                  pins={pins}
                  label={`Context at call ${call + 1}`}
                />
                <Breakdown root={root} total={point.total} window={win} cwdRoot={data.root} focusId={focus} onFocus={setFocus} pins={pins} />
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
