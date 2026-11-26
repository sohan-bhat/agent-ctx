import { itemBytes, type Item, type Kind } from '../../core/src/index.ts';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, project TEXT, kind TEXT, body TEXT, origin TEXT, flags TEXT, held INTEGER, pinned INTEGER, folded INTEGER, created INTEGER, bytes INTEGER) WITHOUT ROWID',
  'CREATE INDEX IF NOT EXISTS items_project_created ON items(project, created)',
  "CREATE INDEX IF NOT EXISTS items_rules ON items(kind) WHERE kind = 'rule'",
  'CREATE TABLE IF NOT EXISTS events(session TEXT, key TEXT, t TEXT, at INTEGER, text TEXT, path TEXT, ok INTEGER, flags TEXT, PRIMARY KEY(session, key)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, agent TEXT, model TEXT, project TEXT, start INTEGER, last INTEGER, primed INTEGER, grant_id TEXT, n INTEGER) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS projects(key TEXT PRIMARY KEY, name TEXT, created INTEGER) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS paths(path TEXT PRIMARY KEY, key TEXT) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS aliases(alias TEXT PRIMARY KEY, key TEXT) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY, label TEXT, first INTEGER, last INTEGER) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS delivered(reader TEXT PRIMARY KEY, items TEXT) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS queue(item TEXT PRIMARY KEY, at INTEGER) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID',
];

export const TABLES = ['items', 'events', 'sessions', 'projects', 'paths', 'aliases', 'agents', 'delivered', 'queue', 'meta'];

export interface ItemRow {
  id: string;
  project: string;
  kind: string;
  body: string;
  origin: string;
  flags: string;
  held: number;
  pinned: number;
  folded: number;
  created: number;
  bytes: number;
}

export interface EventRow { session: string; key: string; t: string; at: number; text: string | null; path: string | null; ok: number | null; flags: string | null }
export interface SessionRow { id: string; agent: string; model: string | null; project: string; start: number; last: number; primed: number; grant_id: string; n: number }
export interface AgentRow { id: string; label: string; first: number; last: number }
export interface ReadRow { item: string; agent: string; at: number }

export function toItem(r: ItemRow): Item {
  return {
    id: r.id,
    project: r.project,
    kind: r.kind as Kind,
    body: JSON.parse(r.body),
    origin: JSON.parse(r.origin),
    flags: JSON.parse(r.flags),
    held: !!r.held,
    pinned: !!r.pinned,
    folded: !!r.folded,
    created: r.created,
  };
}

export function newer(a: Item, b: Item): number {
  return b.created - a.created || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);
}

type Value = string | number | null;

export class Store {
  rowsRead = 0;
  rowsWritten = 0;
  private sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
  }

  q<T>(query: string, ...args: Value[]): T[] {
    const cursor = this.sql.exec(query, ...args);
    const rows = cursor.toArray() as T[];
    this.rowsRead += cursor.rowsRead;
    this.rowsWritten += cursor.rowsWritten;
    return rows;
  }

  init(): void {
    for (const s of SCHEMA) this.q(s);
  }

  counts(): { read: number; written: number } {
    return { read: this.rowsRead, written: this.rowsWritten };
  }

  meta<T>(k: string, fallback: T): T {
    const row = this.q<{ v: string }>('SELECT v FROM meta WHERE k = ?', k)[0];
    return row ? (JSON.parse(row.v) as T) : fallback;
  }

  setMeta(k: string, v: unknown): void {
    this.q('INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v));
  }

  dropMeta(k: string): void {
    this.q('DELETE FROM meta WHERE k = ?', k);
  }

  item(id: string): Item | null {
    const row = this.q<ItemRow>('SELECT * FROM items WHERE id = ?', id)[0];
    return row ? toItem(row) : null;
  }

  items(ids: string[]): Item[] {
    const out: Item[] = [];
    for (const id of ids) {
      const i = this.item(id);
      if (i) out.push(i);
    }
    return out;
  }

  projectItems(project: string, limit: number): Item[] {
    return this.q<ItemRow>('SELECT * FROM items WHERE project = ? AND folded = 0 ORDER BY created DESC, id DESC LIMIT ?', project, limit).map(toItem);
  }

  walk(project: string, after: Item | null, limit: number): Item[] {
    if (!after) return this.projectItems(project, limit);
    return this.q<ItemRow>('SELECT * FROM items WHERE project = ? AND folded = 0 AND (created, id) < (?, ?) ORDER BY created DESC, id DESC LIMIT ?', project, after.created, after.id, limit).map(toItem);
  }

  rules(): Item[] {
    return this.q<ItemRow>("SELECT * FROM items WHERE kind = 'rule'").map(toItem);
  }

  all(): Item[] {
    return this.q<ItemRow>('SELECT * FROM items ORDER BY created').map(toItem);
  }

  newest(limit: number): Item[] {
    return this.q<ItemRow>('SELECT * FROM items ORDER BY created DESC LIMIT ?', limit).map(toItem);
  }

  bytesOf(id: string): number {
    return this.q<{ bytes: number }>('SELECT bytes FROM items WHERE id = ?', id)[0]?.bytes ?? 0;
  }

  put(item: Item): number {
    const n = itemBytes(item);
    this.q(
      'INSERT INTO items(id, project, kind, body, origin, flags, held, pinned, folded, created, bytes) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project = excluded.project, kind = excluded.kind, body = excluded.body, origin = excluded.origin, flags = excluded.flags, held = excluded.held, pinned = excluded.pinned, folded = excluded.folded, created = excluded.created, bytes = excluded.bytes',
      item.id,
      item.project,
      item.kind,
      JSON.stringify(item.body),
      JSON.stringify(item.origin),
      JSON.stringify(item.flags ?? []),
      item.held ? 1 : 0,
      item.pinned ? 1 : 0,
      item.folded ? 1 : 0,
      item.created,
      n,
    );
    return n;
  }

  remove(id: string): number {
    const n = this.bytesOf(id);
    this.q('DELETE FROM items WHERE id = ?', id);
    this.q('DELETE FROM queue WHERE item = ?', id);
    return n;
  }

  delivered(reader: string): string[] {
    const row = this.q<{ items: string }>('SELECT items FROM delivered WHERE reader = ?', reader)[0];
    return row ? (JSON.parse(row.items) as string[]) : [];
  }

  setDelivered(reader: string, ids: string[]): void {
    this.q('INSERT INTO delivered(reader, items) VALUES(?, ?) ON CONFLICT(reader) DO UPDATE SET items = excluded.items', reader, JSON.stringify(ids));
  }

  dropDelivered(reader: string): void {
    this.q('DELETE FROM delivered WHERE reader = ?', reader);
  }

  sessionEvents(session: string): EventRow[] {
    return this.q<EventRow>('SELECT * FROM events WHERE session = ? ORDER BY at, key', session);
  }

  sumBytes(): number {
    return this.q<{ n: number | null }>('SELECT SUM(bytes) AS n FROM items')[0]?.n ?? 0;
  }

  count(table: string): number {
    if (!TABLES.includes(table)) throw new Error('unknown table');
    return this.q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0]?.n ?? 0;
  }
}
