import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { events, sessions, type SessionList, type SessionRow } from '@/lib/api';
import { ago, base, count, mb } from '@/lib/format';

const ALL = '__all__';
const PAGE = 50;
const INLINE_FOLDERS = 5;

function readHash(): { q: string; f: string } {
  const i = location.hash.indexOf('?');
  const p = new URLSearchParams(i >= 0 ? location.hash.slice(i + 1) : '');
  return { q: p.get('q') ?? '', f: p.get('f') ?? ALL };
}

function writeHash(q: string, f: string) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (f !== ALL) p.set('f', f);
  const s = p.toString();
  history.replaceState(null, '', `#/${s ? `?${s}` : ''}`);
}

export function rowTitle(r: { title?: string; prompt?: string; placeLabel?: string; place?: string }): string {
  return r.title || r.prompt || base(r.placeLabel || r.place || '') || 'Session';
}

function folderNames(labels: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of labels) {
    const short = base(l);
    out.set(l, labels.filter((x) => base(x) === short).length > 1 ? l : short);
  }
  return out;
}

export function Sessions() {
  const [list, setList] = useState<SessionList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(() => readHash().q);
  const [folder, setFolder] = useState(() => readHash().f);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    writeHash(query.trim(), folder);
    setLimit(PAGE);
  }, [query, folder]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      sessions()
        .then((r) => {
          if (!alive) return;
          setList(r);
          setError(null);
        })
        .catch(() => alive && setError('The claude-ctx server stopped, so run claude-ctx again to reopen this page.'));
    load();
    const stop = events(null, (e) => e === 'sessions' && load());
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const rows = list?.sessions ?? null;

  const folders = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) if (r.placeLabel) m.set(r.placeLabel, (m.get(r.placeLabel) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);
  const names = useMemo(() => folderNames(folders.map(([f]) => f)), [folders]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (folder !== ALL && r.placeLabel !== folder) return false;
      if (!q) return true;
      return [r.title, r.prompt, r.placeLabel, r.project, r.session].some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, query, folder]);

  return (
    <section aria-labelledby="sessions-title">
      <h1 id="sessions-title" className="sr-only">
        Sessions
      </h1>
      {error ? (
        <p className="text-destructive">{error}</p>
      ) : rows === null ? (
        <div aria-busy="true" aria-label="Loading sessions" className="min-h-40" />
      ) : !rows.length ? (
        <div className="grid gap-1">
          <p className="font-semibold">{list?.indexing ? 'Reading past sessions' : 'No sessions yet'}</p>
          {!list?.indexing && (
            <p>
              Run <code className="num text-[0.8125rem]">claude-ctx index</code> in a terminal
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="num text-[0.8125rem] text-muted-foreground">
            {count(rows.length, 'session', 'sessions')} in {count(folders.length, 'folder', 'folders')}
            {list?.store ? `, ${mb(list.store.bytes)} of ${mb(list.store.cap)}` : ''}
          </p>

          <div className="mt-6 flex flex-col gap-x-8 gap-y-3 sm:flex-row sm:items-end">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search sessions"
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-full rounded-none border-0 border-b border-input bg-transparent px-0 text-sm outline-none transition-colors duration-150 placeholder:text-muted-foreground hover:border-muted-foreground focus-visible:border-foreground focus-visible:outline-none md:text-sm sm:w-64 dark:bg-transparent"
            />
            {folders.length > 1 && folders.length <= INLINE_FOLDERS ? (
              <div role="group" aria-label="Folder" className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {[[ALL, 'All'] as const, ...folders.map(([f]) => [f, names.get(f) ?? f] as const)].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={folder === value}
                    title={value === ALL ? undefined : value}
                    onClick={() => setFolder(value)}
                    className={`h-8 text-sm transition-colors duration-150 ${folder === value ? 'font-semibold text-foreground underline decoration-foreground/40 underline-offset-[6px]' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : folders.length > INLINE_FOLDERS ? (
              <Select value={folder} onValueChange={setFolder}>
                <SelectTrigger aria-label="Folder" className="h-8 w-auto max-w-full gap-2 border-0 bg-transparent px-0 text-sm font-semibold hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value={ALL}>All folders</SelectItem>
                  {folders.map(([f, n]) => (
                    <SelectItem key={f} value={f}>
                      <span className="num text-[0.8125rem]">{names.get(f) ?? f}</span>
                      <span className="num ml-2 text-xs text-muted-foreground">{n}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>

          {!shown.length ? (
            <div className="mt-8 flex items-baseline gap-4">
              <p className="font-semibold">Nothing matches</p>
              <button
                type="button"
                className="text-sm font-semibold underline decoration-foreground/35 underline-offset-4 transition-colors duration-150 hover:decoration-foreground"
                onClick={() => {
                  setQuery('');
                  setFolder(ALL);
                }}
              >
                Clear the search
              </button>
            </div>
          ) : (
            <ul className="mt-5">
              {shown.slice(0, limit).map((r) => (
                <Line key={r.session} r={r} />
              ))}
            </ul>
          )}

          {shown.length > limit && (
            <div className="mt-4 flex items-baseline gap-4">
              <button
                type="button"
                className="text-sm font-semibold underline decoration-foreground/35 underline-offset-4 transition-colors duration-150 hover:decoration-foreground"
                onClick={() => setLimit(limit + PAGE)}
              >
                Show {Math.min(PAGE, shown.length - limit)} more
              </button>
              <span className="num text-xs text-muted-foreground">
                {limit} of {shown.length}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Line({ r }: { r: SessionRow }) {
  return (
    <li>
      <a
        href={`#/s/${encodeURIComponent(r.session)}`}
        className="group -mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 rounded-sm px-2 py-[0.3125rem] no-underline transition-colors duration-150 hover:bg-accent sm:flex"
      >
        <span className="col-span-2 min-w-0 truncate font-medium group-hover:underline group-hover:decoration-foreground/40 group-hover:underline-offset-4 sm:max-w-[60%] sm:flex-initial">
          {rowTitle(r)}
        </span>
        <span className="num col-start-1 row-start-2 min-w-0 truncate text-xs text-muted-foreground sm:flex-1" title={r.placeLabel}>
          {r.placeLabel}
          {r.places.length > 1 ? ` +${r.places.length - 1}` : ''}
        </span>
        <span className="col-start-2 row-start-2 whitespace-nowrap text-right text-xs sm:ml-auto">
          {r.live ? <span className="font-semibold text-live">running</span> : <span className="num text-muted-foreground">{ago(r.last)}</span>}
        </span>
      </a>
    </li>
  );
}
