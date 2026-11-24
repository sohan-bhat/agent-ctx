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
  n: number;
  t: string;
  total: number;
  input: number;
  read: number;
  write: number;
  out: number;
  est: Record<string, number>;
  raw: number;
  prompt: number;
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
  before: Top[];
}

export interface Item {
  id: string;
  session: string;
  kind: string;
  label: string;
  text: string;
  at: string;
}

export interface SessionData {
  session: string;
  title?: string;
  prompt?: string;
  cwd?: string;
  root?: string;
  model?: string;
  offset: number;
  system: { tok: number; measured: boolean };
  ratio: number;
  from: number;
  count: number;
  points: Point[];
  compactions: Compaction[];
  largest: Top[];
  categories: { key: string; label: string }[];
  queued: Item[];
  pins: Item[];
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

export function session(id: string, since = 0): Promise<SessionData> {
  return get(`api/session/${encodeURIComponent(id)}?since=${since}`);
}

export async function send(kind: 'putback' | 'pin', body: { session: string; kind: string; label: string; text: string }): Promise<Item> {
  const r = await fetch(`api/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status}`);
  return ((await r.json()) as { item: Item }).item;
}

export function events(watch: string | null, on: (event: string, data: unknown) => void): () => void {
  const es = new EventSource(watch ? `api/events?watch=${encodeURIComponent(watch)}` : 'api/events');
  for (const name of ['change', 'sessions', 'items']) {
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
