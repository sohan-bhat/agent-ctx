import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { events, sessions, type SessionRow } from '@/lib/api';
import { ago } from '@/lib/format';

const ALL = '__all__';
const PAGE = 50;

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

export function Sessions() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [indexing, setIndexing] = useState(false);
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
          setRows(r.sessions);
          setIndexing(r.indexing);
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

  const folders = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) if (r.placeLabel) m.set(r.placeLabel, (m.get(r.placeLabel) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (folder !== ALL && r.placeLabel !== folder) return false;
      if (!q) return true;
      return [r.title, r.placeLabel, r.project, r.session].some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, query, folder]);

  return (
    <section aria-labelledby="sessions-title">
      <h1 id="sessions-title" className="font-heading text-[2rem] font-bold leading-tight tracking-[-0.025em] text-balance md:text-[2.4rem]">
        Sessions
      </h1>

      <div className="mt-7 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <div className="grid gap-1.5">
          <label htmlFor="q" className="text-sm font-medium">
            Search
          </label>
          <div className="relative">
            <MagnifyingGlass aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 pl-8 text-[0.95rem]" autoComplete="off" spellCheck={false} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <label id="folder-label" className="text-sm font-medium">
            Folder
          </label>
          <Select value={folder} onValueChange={setFolder}>
            <SelectTrigger aria-labelledby="folder-label" className="w-full text-[0.95rem] data-[size=default]:h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All folders</SelectItem>
              {folders.map(([f, n]) => (
                <SelectItem key={f} value={f}>
                  <span className="num text-[0.82rem]">{f}</span>
                  <span className="num ml-2 text-xs text-muted-foreground">{n}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border bg-card">
        {error ? (
          <p className="px-5 py-10 text-[0.95rem] text-destructive">{error}</p>
        ) : rows === null ? (
          <div className="grid gap-px" aria-busy="true" aria-label="Loading sessions">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex items-center gap-6 px-5 py-4">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
            ))}
          </div>
        ) : !rows.length ? (
          <div className="px-5 py-12">
            <p className="font-medium">{indexing ? 'Reading past sessions' : 'No sessions yet'}</p>
            <p className="mt-1 text-[0.95rem] text-muted-foreground">
              {indexing ? 'Cards appear here as each transcript is read.' : 'Run claude-ctx index in a terminal to fill this list.'}
            </p>
          </div>
        ) : !shown.length ? (
          <div className="px-5 py-12">
            <p className="font-medium">Nothing matches</p>
            <p className="mt-1 text-[0.95rem] text-muted-foreground">Try fewer words or pick All folders.</p>
          </div>
        ) : (
          <Table className="text-[0.95rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-10 pl-5 md:w-[46%]">Session</TableHead>
                <TableHead className="hidden h-10 md:table-cell">Folder</TableHead>
                <TableHead className="hidden h-10 text-right sm:table-cell">Prompts</TableHead>
                <TableHead className="h-10 pr-5 text-right">Last active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.slice(0, limit).map((r) => (
                <TableRow key={r.session} className="group cursor-pointer" onClick={() => (location.hash = `#/s/${encodeURIComponent(r.session)}`)}>
                  <TableCell className="max-w-0 py-3.5 pl-5 whitespace-normal">
                    <a href={`#/s/${encodeURIComponent(r.session)}`} className="line-clamp-2 font-medium no-underline group-hover:underline" onClick={(e) => e.stopPropagation()}>
                      {r.title || <span className="text-muted-foreground">Untitled session</span>}
                    </a>
                    <span className="num mt-0.5 block truncate text-xs text-muted-foreground md:hidden">{r.project || r.placeLabel}</span>
                  </TableCell>
                  <TableCell className="hidden max-w-[22rem] truncate py-3.5 md:table-cell">
                    <span className="num text-[0.8rem] text-muted-foreground">{r.placeLabel}</span>
                    {r.places.length > 1 && <span className="num ml-1.5 text-xs text-muted-foreground">+{r.places.length - 1}</span>}
                  </TableCell>
                  <TableCell className="num hidden py-3.5 text-right text-[0.85rem] sm:table-cell">{r.turns || ''}</TableCell>
                  <TableCell className="py-3.5 pr-5 text-right text-[0.88rem] whitespace-nowrap">
                    {r.live ? <span className="font-semibold">running</span> : <span className="text-muted-foreground">{ago(r.last)}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {rows && rows.length > 0 && (
        <div className="mt-3 flex items-center gap-4">
          <p className="num text-xs text-muted-foreground">
            {Math.min(limit, shown.length)} of {shown.length}
          </p>
          {shown.length > limit && (
            <button type="button" className="text-sm font-medium underline underline-offset-4" onClick={() => setLimit(limit + PAGE)}>
              Show {Math.min(PAGE, shown.length - limit)} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
