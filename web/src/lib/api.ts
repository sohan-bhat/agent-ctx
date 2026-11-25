export interface SessionRow {
  session: string;
  title?: string;
  prompt?: string;
  place: string;
  placeLabel: string;
  project: string;
  places: string[];
  first: string;
  last: string;
  turns: number;
  files: number;
  summaries: number;
  live: boolean;
  transcript: string | null;
  size: number;
}

export interface Point {
  total: number;
}

export interface Top {
  label: string;
  cat: string;
  tok: number;
  kind: string;
  count?: number;
}

export interface Dropped {
  id: string;
  kind: 'decision' | 'edit' | 'file' | 'command';
  label: string;
  text: string;
  tok: number;
  runs?: number;
  error?: boolean;
}

export interface Compaction {
  n: number;
  t: string;
  trigger: string;
  pre: number;
  post: number;
  preserved: number;
  summary: string;
  dropped: Dropped[];
  commands: number;
  smallReads: number;
  named: number;
}

export interface Span {
  b: number;
  e?: number;
  c: number;
  t: number;
  l?: number;
  i?: number;
  u?: number;
  n?: number;
  s?: number[];
}

export interface TimelineData {
  cats: string[];
  labelsFrom: number;
  labels: string[];
  closedFrom: number;
  closed: Span[];
  live: Span[];
}

export interface Item {
  id: string;
  session: string;
  kind: string;
  label: string;
  text: string;
  at: string;
}

export interface SessionHead {
  session: string;
  title?: string;
  prompt?: string;
  cwd?: string;
  root?: string;
  model?: string;
}

interface SessionWire extends SessionHead {
  offset: number;
  system: { tok: number; measured: boolean };
  ratio: number;
  from: number;
  count: number;
  totals: number[];
  compactions: Compaction[];
  timeline: TimelineData;
  queued: Item[];
  pins: Item[];
}

export interface SessionData extends Omit<SessionWire, 'totals'> {
  points: Point[];
}

export interface Peek extends SessionHead {
  peak: number;
  size: number;
  ready: boolean;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()) as T;
}

export interface SessionList {
  sessions: SessionRow[];
  indexing: boolean;
  home: string;
  store?: { bytes: number; cap: number };
}

export function sessions(): Promise<SessionList> {
  return get('api/sessions');
}

export async function session(id: string, since = 0, closed = 0, labels = 0): Promise<SessionData> {
  const { totals, ...rest } = await get<SessionWire>(`api/session/${encodeURIComponent(id)}?since=${since}&closed=${closed}&labels=${labels}`);
  return { ...rest, points: totals.map((total) => ({ total })) };
}

export function peek(id: string): Promise<Peek> {
  return get(`api/session/${encodeURIComponent(id)}?peek=1`);
}

export async function send(kind: 'putback' | 'pin', body: { session: string; kind: string; label: string; text: string }): Promise<Item> {
  const r = await fetch(`api/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status}`);
  return ((await r.json()) as { item: Item }).item;
}

export function events(watch: string | null, on: (event: string, data: unknown) => void): () => void {
  const es = new EventSource(watch ? `api/events?watch=${encodeURIComponent(watch)}` : 'api/events');
  for (const name of ['change', 'sessions', 'items', 'reading']) {
    es.addEventListener(name, (e) => {
      try {
        on(name, JSON.parse((e as MessageEvent).data));
      } catch {
        on(name, null);
      }
    });
  }
  return () => es.close();
}
