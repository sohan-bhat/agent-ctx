import { itemBytes, readRule, type Item, type Kind } from '../../core/src/index.ts';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, project TEXT, kind TEXT, body TEXT, origin TEXT, flags TEXT, held INTEGER, pinned INTEGER, folded INTEGER, created INTEGER, bytes INTEGER, updated INTEGER, taken INTEGER) WITHOUT ROWID',
  'CREATE INDEX IF NOT EXISTS items_project_created ON items(project, created)',
  "CREATE INDEX IF NOT EXISTS items_rules ON items(kind) WHERE kind = 'rule'",
  'CREATE TABLE IF NOT EXISTS events(session TEXT, key TEXT, t TEXT, at INTEGER, text TEXT, path TEXT, ok INTEGER, flags TEXT, PRIMARY KEY(session, key)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, agent TEXT, model TEXT, project TEXT, start INTEGER, last INTEGER, primed INTEGER, grant_id TEXT, n INTEGER) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS projects(key TEXT PRIMARY KEY, name TEXT, created INTEGER) WITHOUT ROWID',
  'CREATE INDEX IF NOT EXISTS projects_name ON projects(name)',
  'CREATE TABLE IF NOT EXISTS paths(path TEXT PRIMARY KEY, key TEXT) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS aliases(alias TEXT PRIMARY KEY, key TEXT) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY, label TEXT, first INTEGER, last INTEGER) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS delivered(reader TEXT PRIMARY KEY, items TEXT) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS queue(item TEXT PRIMARY KEY, at INTEGER) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS hidden(id TEXT PRIMARY KEY, item TEXT, at INTEGER) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS removed(id TEXT PRIMARY KEY, at INTEGER) WITHOUT ROWID',
];

const ADDED = ['updated', 'taken'];
const PUT_COLUMNS = ['project', 'kind', 'body', 'origin', 'flags', 'held', 'pinned', 'folded', 'created', 'bytes', 'taken'];
const STAMP = 'COALESCE(updated, created)';
const PUT = `INSERT INTO items(id, ${PUT_COLUMNS.join(', ')}, updated) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ${PUT_COLUMNS.map((c) => `${c} = excluded.${c}`).join(', ')}, updated = CASE WHEN excluded.taken = 1 THEN excluded.updated ELSE MAX(excluded.updated, COALESCE(items.updated, items.created) + 1) END`;

export const TABLES = ['items', 'events', 'sessions', 'projects', 'paths', 'aliases', 'agents', 'delivered', 'queue', 'meta', 'hidden', 'removed'];

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
export interface Gone { id: string; at: number }
export type Timed = Item & { updated: number };

export function toItem(r: ItemRow): Item {
  return {
    id: r.id,
    project: r.project,
    kind: r.kind as Kind,
    body: r.kind === 'rule' ? readRule(JSON.parse(r.body)) : JSON.parse(r.body),
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

export interface Sql {
  exec(query: string, ...args: Value[]): { toArray(): unknown[]; rowsRead: number; rowsWritten: number };
  transactionSync(fn: () => void): void;
  sync(): Promise<void>;
  deleteAll(): Promise<void>;
}

export class Store {
  rowsRead = 0;
  rowsWritten = 0;
  private sql: Sql;

  constructor(sql: Sql) {
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
    const have = new Set(this.q<{ name: string }>('PRAGMA table_info(items)').map((c) => c.name));
    for (const column of ADDED) if (!have.has(column)) this.q(`ALTER TABLE items ADD COLUMN ${column} INTEGER`);
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

  put(item: Item, at: number | null = null, taken = false): number {
    const n = itemBytes(item);
    this.q(
      PUT,
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
      taken ? 1 : 0,
      at,
    );
    return n;
  }

  changed(since: number): Timed[] {
    return this.q<ItemRow & { at: number }>(`SELECT *, ${STAMP} AS at FROM items WHERE ${STAMP} > ? AND COALESCE(taken, 0) = 0 ORDER BY at, id`, since).map((r) => ({ ...toItem(r), updated: r.at }));
  }

  timed(id: string): Timed | null {
    const row = this.q<ItemRow & { at: number }>(`SELECT *, ${STAMP} AS at FROM items WHERE id = ?`, id)[0];
    return row ? { ...toItem(row), updated: row.at } : null;
  }

  hide(id: string, item: Item | null, at: number): void {
    this.q('INSERT INTO hidden(id, item, at) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET item = COALESCE(excluded.item, hidden.item), at = MAX(excluded.at, hidden.at)', id, item ? JSON.stringify(item) : null, at);
  }

  hiddenItem(id: string): Item | null {
    const row = this.q<{ item: string | null }>('SELECT item FROM hidden WHERE id = ?', id)[0];
    return row?.item ? (JSON.parse(row.item) as Item) : null;
  }

  hiddenItems(): Item[] {
    return this.q<{ item: string }>('SELECT item FROM hidden WHERE item IS NOT NULL ORDER BY at DESC, id').map((r) => JSON.parse(r.item) as Item);
  }

  gone(table: 'hidden' | 'removed', since: number): Gone[] {
    return this.q<Gone>(`SELECT id, at FROM ${table} WHERE at > ? ORDER BY at, id`, since);
  }

  goneAt(table: 'hidden' | 'removed', id: string): number | null {
    return this.q<{ at: number }>(`SELECT at FROM ${table} WHERE id = ?`, id)[0]?.at ?? null;
  }

  setRemoved(id: string, at: number): void {
    this.q('INSERT INTO removed(id, at) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at', id, at);
  }

  unmark(id: string): void {
    this.q('DELETE FROM hidden WHERE id = ?', id);
    this.q('DELETE FROM removed WHERE id = ?', id);
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
