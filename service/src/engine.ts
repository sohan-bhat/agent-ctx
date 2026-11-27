import {
  FOLD_AT,
  FOOTER,
  HEADER,
  autoCard,
  autoHandoff,
  bytes,
  isProtected,
  mergeCard,
  overlap,
  sameCard,
  clean,
  cut,
  decideRule,
  droppedAt,
  eventKey,
  fit,
  hookOutput,
  itemBytes,
  namedProjects,
  newItem,
  projectName,
  quietPrompt,
  rankItems,
  recall,
  redact,
  ruleLine,
  resolveProject,
  sanitize,
  sanitizeItem,
  stripOwn,
  stripPrivate,
  totalBytes,
  underCeiling,
  folderName,
  cleanRemote,
  type CardBody,
  type Ev,
  type EvType,
  type HandoffBody,
  type Item,
  type Known,
  type Origin,
  type RuleBody,
  type Source,
  type Via,
} from '../../core/src/index.ts';
import { Store, TABLES, newer, type AgentRow, type EventRow, type ReadRow, type SessionRow, type Sql } from './store.ts';
import { Limits, SAY, type Max } from './limits.ts';

export interface Caller { agent: string; grant: string; scopes: string[] }
export interface Result { ok: boolean; text: string; item?: Item; noProject?: boolean; merged?: 'same' | 'added' }
export interface Where { repo?: string; folder?: string }
export interface RecallArgs extends Where { query?: string; dropped?: boolean; ids?: string[] }
export interface CheckpointArgs extends Where { goal?: string; changed?: string[]; decisions?: string[]; commands?: string[]; dead_ends?: string[]; open?: string[]; key?: string }
export interface HandoffArgs extends Where { goal?: string; done?: string; next?: string; blockers?: string[]; files?: string[]; check?: string; question?: string; task?: string; key?: string }
export interface RuleArgs extends Where { text: string; words: string; scope: 'project' | 'all'; key?: string }
export interface EventArgs { host?: string; event?: string; session?: string; cwd?: string; prompt?: string; tool?: string; file?: string; command?: string; message?: string; summary?: string; reason?: string; source?: string; model?: string }
export type Part = 'store' | 'recall';
export type ItemView = Item & { line?: string };
export interface Space { projects: { key: string; name: string; items: number }[]; agents: AgentRow[]; items: ItemView[]; queue: string[]; reads: ReadRow[]; now: number }
export interface Me { bytes: number; max: number; callsToday: number; storedToday: number }
export interface Exported { items: Item[]; projects: { key: string; name: string }[]; agents: AgentRow[] }
export interface Page { send(text: string): void; close(): void; address(): string | null }

const MINUTE = 60000;
const DAY = 86400000;
const LIVE = 3 * MINUTE;
const AGENT_LIVE = 30 * DAY;
const SAME_GRANT_WAIT = 20 * MINUTE;
const KEEP_EVENTS = 14 * DAY;
const EVENTS_PER_SESSION = 400;
const POOL = 400;
const SPACE_ITEMS = 1500;
const READS_KEPT = 200;
const POOLS_KEPT = 4;
const SESSIONS_KEPT = 100;
const EVENT_SESSIONS_KEPT = 8;
const WALK_PAGE = 16;
const OWN_TOOL = /agent[-_]?ctx/i;
const PATH_MAX = 1024;
const ID_MAX = 200;
const MAX_PROJECTS = 200;
const ROW = 32;
const STOP_CHARS = 2000;
const SUMMARY_CHARS = 4000;
const PROMPT_KEPT = 300;
const PROMPT_LONG = 800;
const COMMAND_CHARS = 300;
const PLACEHOLDER = /^\$\{[^}]*\}$/;
const FAILED = 'Memory could not be loaded. Do not assume that nothing is stored.';
export const NOT_STATED = 'Not stated';
export const SAME_CARD = 'Nothing new to save. This checkpoint matches a saved card of the same work.';
export const ADDED_CARD = 'Checkpoint added to the saved card of the same work.';
export const NOTHING_NEW = 'Nothing new found. Every line came from agent-ctx memory, so nothing was saved.';
const KEPT_FLAGS = new Set(['role', 'override', 'shell']);

function val(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s || PLACEHOLDER.test(s)) return undefined;
  return v;
}

function cleanText(s: string, limit?: number): { text: string; flags: string[] } {
  const base = stripOwn(stripPrivate(s));
  const r = sanitize(limit === undefined ? redact(base) : clean(base, limit));
  return { text: r.text, flags: r.flags };
}

function compact<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out as T;
}

function strings(a: unknown): string[] | undefined {
  if (!Array.isArray(a)) return undefined;
  const out = a.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return out.length ? out : undefined;
}

function headerName(key: string): string {
  return (projectName(key) || 'this-project').replace(/[^\p{L}\p{N}._/-]+/gu, '-').slice(0, 60);
}

function withLine(text: string, line: string, project: string, cap: number): string {
  if (!text) return [HEADER.replace('NAME', headerName(project)), '', line, '', FOOTER].join('\n');
  const lines = text.split('\n');
  const out = [lines[0], '', line, ...lines.slice(1, -2)];
  const tail = lines.slice(-2);
  const size = () => out.join('\n').length + 1 + tail.join('\n').length;
  while (out.length > 3 && size() > cap) {
    out.pop();
    while (out.length > 3 && (out[out.length - 1] === '' || !out[out.length - 1].startsWith('>'))) out.pop();
  }
  return [...out, ...tail].join('\n');
}

export function view(i: Item): ItemView {
  return i.kind === 'rule' ? { ...i, line: ruleLine(i.body as RuleBody) } : i;
}

function rowBytes(...parts: (string | null | undefined)[]): number {
  let n = ROW;
  for (const p of parts) if (p) n += bytes(p);
  return n;
}

function hash(s: string): string {
  return eventKey('', { t: 'start', at: 0, text: s });
}


function keep<K, V>(m: Map<K, V>, k: K, v: V, cap: number): V {
  m.delete(k);
  m.set(k, v);
  while (m.size > cap) m.delete(m.keys().next().value as K);
  return v;
}

interface Live extends SessionRow { written: number; auto: Record<string, string | null> }

export class Engine {
  store: Store;
  limits: Limits;
  lastRows = { read: 0, written: 0 };
  bootRows = { read: 0, written: 0 };
  private sql: Sql;
  private now: () => number;
  private page: Page | null;
  private pools = new Map<string, Item[]>();
  private rulesCache: Item[] | null = null;
  private nameCache: { key: string; names: string[] }[] | null = null;
  private resolved = new Map<string, string | null>();
  private projectKeys = new Set<string>();
  private agentLast = new Map<string, number>();
  private sessionCache = new Map<string, Live>();
  private deliveredCache = new Map<string, Set<string>>();
  private eventCache = new Map<string, EventRow[]>();
  private readsCache: ReadRow[] | null = null;
  private refusal: string | null = null;

  constructor(sql: Sql, now: () => number, max: Max, page: Page | null = null) {
    this.sql = sql;
    this.now = now;
    this.page = page;
    this.store = new Store(sql);
    this.limits = new Limits(this.store);
    this.limits.max = { ...max };
  }

  boot(): void {
    this.store.init();
    this.bootRows = this.store.counts();
  }

  private async measure<T>(fn: () => T | Promise<T>): Promise<T> {
    const before = this.store.counts();
    try {
      return await fn();
    } finally {
      this.limits.flush(this.now());
      const after = this.store.counts();
      this.lastRows = { read: after.read - before.read, written: after.written - before.written };
    }
  }

  private forget(): void {
    this.pools.clear();
    this.rulesCache = null;
    this.nameCache = null;
    this.resolved.clear();
    this.projectKeys.clear();
    this.agentLast.clear();
    this.sessionCache.clear();
    this.deliveredCache.clear();
    this.eventCache.clear();
    this.readsCache = null;
  }

  private push(msg: { type: string; item?: Item; [k: string]: unknown }): void {
    this.page?.send(JSON.stringify(msg.item ? { ...msg, item: view(msg.item) } : msg));
  }

  private async gate(c: Caller, now: number, need: 'read' | 'write', input: unknown): Promise<Result | null> {
    if (!c.scopes.includes(need)) return { ok: false, text: need === 'write' ? SAY.scope : SAY.noread };
    const call = this.limits.call(now);
    if (call.stop) return { ok: false, text: call.stop };
    if (call.persist) await this.sql.sync();
    if (JSON.stringify(input ?? null).length > this.limits.max.inputBytes) return { ok: false, text: SAY.size };
    this.maintain(now);
    return this.touchAgent(c.agent, now);
  }

  private room(n: number): boolean {
    return this.limits.bytes() + this.limits.extra() + n <= this.limits.max.storeBytes;
  }

  private addExtra(n: number): void {
    this.limits.setExtra(this.limits.extra() + n);
  }

  private recountExtra(): void {
    const b = (col: string) => `COALESCE(LENGTH(CAST(${col} AS BLOB)), 0)`;
    const sum = (table: string, cols: string[]) => `(SELECT COALESCE(SUM(${cols.map(b).join(' + ')} + ${ROW}), 0) FROM ${table})`;
    const total = this.store.q<{ n: number }>(
      `SELECT ${[sum('events', ['session', 'key', 't', 'text', 'path', 'flags']), sum('sessions', ['id', 'agent', 'model', 'project', 'grant_id']), sum('projects', ['key', 'name']), sum('paths', ['path', 'key']), sum('aliases', ['alias', 'key'])].join(' + ')} AS n`,
    )[0]?.n;
    this.limits.setExtra(total ?? 0);
  }

  private freeEvents(keep: string): boolean {
    const old = this.store.q<{ id: string }>('SELECT id FROM sessions WHERE id != ? ORDER BY last LIMIT 1', keep)[0];
    if (!old) return false;
    this.dropSession(old.id);
    this.recountExtra();
    return true;
  }

  private dropSession(id: string): void {
    this.store.q('DELETE FROM events WHERE session = ?', id);
    this.store.q('DELETE FROM sessions WHERE id = ?', id);
    this.store.dropDelivered(`s-${id}`);
    for (const k of [`auto-card:${id}`, `auto-handoff:${id}`, `auto-card-merged:${id}`, `dropped:${id}`]) this.store.dropMeta(k);
    this.sessionCache.delete(id);
    this.eventCache.delete(id);
    this.deliveredCache.delete(`s-${id}`);
  }

  private touchAgent(label: string, now: number): Result | null {
    const last = this.agentLast.get(label);
    if (last !== undefined) {
      if (now - last > MINUTE) {
        this.store.q('UPDATE agents SET last = ? WHERE id = ?', now, label);
        this.agentLast.set(label, now);
      }
      return null;
    }
    const row = this.store.q<AgentRow>('SELECT * FROM agents WHERE id = ?', label)[0];
    if (row) {
      if (now - row.last > MINUTE) {
        this.store.q('UPDATE agents SET last = ? WHERE id = ?', now, label);
        row.last = now;
      }
      this.agentLast.set(label, row.last);
      return null;
    }
    const n = this.store.q<{ n: number }>('SELECT COUNT(*) AS n FROM agents WHERE last >= ?', now - AGENT_LIVE)[0]?.n ?? 0;
    if (n >= this.limits.max.agents) return { ok: false, text: SAY.agents };
    const agent: AgentRow = { id: label, label, first: now, last: now };
    this.store.q('INSERT INTO agents(id, label, first, last) VALUES(?, ?, ?, ?)', agent.id, agent.label, agent.first, agent.last);
    this.agentLast.set(label, now);
    this.push({ type: 'agent', agent });
    return null;
  }

  private project(w: Where, now: number): string | null {
    this.refusal = null;
    const rawFolder = typeof w.folder === 'string' ? w.folder.trim() : '';
    const repo = typeof w.repo === 'string' ? w.repo.trim() : '';
    if (rawFolder.length > PATH_MAX || repo.length > PATH_MAX) return null;
    const folder = redact(rawFolder);
    const memo = `${repo}\u0001${folder}`;
    const hit = this.resolved.get(memo);
    if (hit !== undefined) return hit;
    const name = folder ? folderName(folder) : '';
    const remote = repo ? cleanRemote(repo) : null;
    const known: Known = { paths: {}, aliases: {}, repos: [] };
    if (folder) {
      const p = this.store.q<{ key: string }>('SELECT key FROM paths WHERE path = ?', folder)[0];
      if (p) known.paths[folder] = p.key;
    }
    if (!remote && !name && !known.paths[folder]) {
      keep(this.resolved, memo, null, 200);
      return null;
    }
    if (name) {
      const a = this.store.q<{ key: string }>('SELECT key FROM aliases WHERE alias = ?', name)[0];
      if (a) known.aliases[name] = a.key;
      known.repos = this.store.q<{ key: string }>("SELECT key FROM projects WHERE name = ? AND key NOT LIKE 'folder:%'", name).map((r) => r.key);
    }
    const resolved = resolveProject({ repo: remote ?? undefined, folder }, known);
    const r = { ...resolved, key: redact(resolved.key) };
    if (!this.projectKeys.has(r.key) && !this.store.q('SELECT key FROM projects WHERE key = ?', r.key).length) {
      const name = projectName(r.key);
      const n = rowBytes(r.key, name);
      if (!this.makeRoomForProject() || !this.room(n)) {
        this.refusal = this.refusal ?? SAY.full;
        return null;
      }
      this.store.q('INSERT INTO projects(key, name, created) VALUES(?, ?, ?) ON CONFLICT(key) DO NOTHING', r.key, name, now);
      this.addExtra(n);
      this.resolved.clear();
      this.nameCache = null;
    }
    this.projectKeys.add(r.key);
    let changed = false;
    if (r.learn?.path && known.paths[r.learn.path] !== r.key && this.room(rowBytes(r.learn.path, r.key))) {
      this.store.q('INSERT INTO paths(path, key) VALUES(?, ?) ON CONFLICT(path) DO UPDATE SET key = excluded.key', r.learn.path, r.key);
      this.addExtra(rowBytes(r.learn.path, r.key));
      changed = true;
    }
    if (r.learn?.alias && known.aliases[r.learn.alias] !== r.key && this.room(rowBytes(r.learn.alias, r.key))) {
      this.store.q('INSERT INTO aliases(alias, key) VALUES(?, ?) ON CONFLICT(alias) DO UPDATE SET key = excluded.key', r.learn.alias, r.key);
      this.addExtra(rowBytes(r.learn.alias, r.key));
      changed = true;
    }
    if (changed) {
      this.resolved.clear();
      this.nameCache = null;
    }
    keep(this.resolved, memo, r.key, 200);
    return r.key;
  }

  private makeRoomForProject(): boolean {
    const count = () => this.store.q<{ n: number }>('SELECT COUNT(*) AS n FROM projects')[0]?.n ?? 0;
    if (count() < MAX_PROJECTS) return true;
    const unused = 'SELECT key FROM projects WHERE key NOT IN (SELECT project FROM items) AND key NOT IN (SELECT project FROM sessions)';
    this.sql.transactionSync(() => {
      this.store.q(`DELETE FROM paths WHERE key IN (${unused})`);
      this.store.q(`DELETE FROM aliases WHERE key IN (${unused})`);
      this.store.q(`DELETE FROM projects WHERE key IN (${unused})`);
    });
    this.projectKeys.clear();
    this.resolved.clear();
    this.nameCache = null;
    this.recountExtra();
    if (count() < MAX_PROJECTS) return true;
    this.refusal = SAY.projects;
    return false;
  }

  private origin(c: Caller, now: number, via: Via, source: Source, session?: string, model?: string): Origin {
    return compact({ agent: c.agent, model, session, via, source, at: now }) as Origin;
  }

  private putItem(item: Item): void {
    this.store.put(item);
    for (const [key, list] of [...this.pools]) {
      const at = list.findIndex((i) => i.id === item.id);
      if (key !== item.project || item.folded) {
        if (at >= 0) this.pools.delete(key);
        continue;
      }
      const full = list.length >= POOL;
      if (at >= 0) list.splice(at, 1);
      const pos = list.findIndex((i) => newer(item, i) < 0);
      if (pos >= 0) {
        list.splice(pos, 0, item);
        if (list.length > POOL) list.pop();
      } else if (!full) list.push(item);
      else if (at >= 0) this.pools.delete(key);
    }
    if (item.kind === 'rule' && this.rulesCache) this.rulesCache = [...this.rulesCache.filter((r) => r.id !== item.id), item];
  }

  private removeItem(item: Item): number {
    const n = this.store.remove(item.id);
    this.pools.delete(item.project);
    if (this.rulesCache) this.rulesCache = this.rulesCache.filter((r) => r.id !== item.id);
    return n;
  }

  private itemRoom(): number {
    return this.limits.max.storeBytes - this.limits.extra();
  }

  private mergeable(i: Item, incoming: Item, now: number): boolean {
    if (i.kind !== 'card' || incoming.kind !== 'card' || i.held || incoming.held || i.folded || incoming.pinned || isProtected(i, now)) return false;
    if ((i.flags ?? []).some((f) => KEPT_FLAGS.has(f))) return false;
    if ((i.origin?.source ?? '') !== (incoming.origin?.source ?? '')) return false;
    if (i.project !== incoming.project) return false;
    return !this.store.q('SELECT item FROM queue WHERE item = ?', i.id).length;
  }

  private mergeTarget(incoming: Item, now: number): Item | null {
    if (incoming.kind !== 'card') return null;
    let best: Item | null = null;
    let score = 0;
    for (const i of this.pool(incoming.project)) {
      if (i.kind !== 'card' || !sameCard(i, incoming) || !this.mergeable(i, incoming, now)) continue;
      const o = overlap(i, incoming).jaccard;
      if (o > score) {
        best = i;
        score = o;
      }
    }
    return best;
  }

  private forgetDelivered(id: string): void {
    for (const r of this.store.q<{ reader: string; items: string }>('SELECT reader, items FROM delivered WHERE items LIKE ?', `%"${id}"%`)) {
      this.store.setDelivered(r.reader, (JSON.parse(r.items) as string[]).filter((x) => x !== id));
      this.deliveredCache.get(r.reader)?.delete(id);
    }
  }

  private save(item: Item, now: number, counted: boolean, after?: (saved: Item) => void): Result {
    if (counted) {
      const r = this.limits.canStore(now);
      if (r) {
        this.limits.refuse(r, now);
        return { ok: false, text: r };
      }
    }
    let clean: Item;
    try {
      clean = fit(sanitizeItem(item));
    } catch {
      return { ok: false, text: SAY.clean };
    }
    let prev = this.store.bytesOf(clean.id);
    let merged: 'added' | undefined;
    if (clean.kind === 'card' && !prev) {
      const target = this.mergeTarget(clean, now);
      if (target) {
        const next = mergeCard(target, clean, now);
        if (next === target) return { ok: true, text: '', item: target, merged: 'same' };
        clean = next;
        merged = 'added';
        prev = this.store.bytesOf(clean.id);
      }
    }
    const limit = this.itemRoom();
    const size = itemBytes(clean);
    let total = this.limits.bytes();
    if (total - prev + size > FOLD_AT * limit && total > this.limits.folded() + 0.02 * limit) {
      total = this.fold(now);
      prev = this.store.bytesOf(clean.id);
    }
    if (total - prev + size > limit) {
      this.limits.refuse(SAY.full, now);
      return { ok: false, text: SAY.full };
    }
    this.putItem(clean);
    this.limits.setBytes(total - prev + size);
    if (counted) this.limits.stored(now);
    this.limits.clear();
    if (merged) this.forgetDelivered(clean.id);
    after?.(clean);
    this.limits.flush(now, true);
    this.push({ type: 'item', item: clean });
    return merged ? { ok: true, text: '', item: clean, merged } : { ok: true, text: '', item: clean };
  }

  private fold(now: number): number {
    const limit = this.itemRoom();
    let total = 0;
    this.sql.transactionSync(() => {
      const before = this.store.all();
      const { items } = underCeiling(before, limit, now);
      const kept = new Map(items.map((i) => [i.id, i]));
      const old = new Map(before.map((i) => [i.id, i]));
      for (const i of before) if (!kept.has(i.id)) this.store.remove(i.id);
      for (const i of items) {
        const o = old.get(i.id);
        if (!o || o.folded !== i.folded || JSON.stringify(o.body) !== JSON.stringify(i.body)) this.store.put(i);
      }
      total = totalBytes(items);
    });
    this.pools.clear();
    this.rulesCache = null;
    this.limits.setBytes(total);
    this.limits.setFolded(total);
    this.push({ type: 'reset' });
    return total;
  }

  private remembered(c: Caller, kind: string, project: string, body: unknown, key: string | undefined, now: number): { hit?: Result; marks: string[] } {
    const marks: string[] = [];
    if (typeof key === 'string' && key) marks.push(`key:${c.grant}:${hash(key)}`);
    marks.push(`body:${c.grant}:${hash(JSON.stringify([kind, project, body]))}`);
    for (const m of marks) {
      const seen = this.limits.mark(m);
      const ttl = m.startsWith('key:') ? DAY : 10 * MINUTE;
      if (seen && now - seen.at < ttl) {
        const item = this.store.item(seen.id);
        if (item) return { hit: { ok: true, text: seen.text, item }, marks };
      }
    }
    return { marks };
  }

  private offer(h: Item, reader: string, grant: string, now: number, liveOfGrant: Set<string>): boolean {
    const writer = h.origin?.session ?? '';
    const mine = `g-${grant}`;
    const aged = now - h.created >= SAME_GRANT_WAIT;
    if (writer === reader) return writer === mine && aged;
    if (writer === mine) return aged;
    if (reader === mine && liveOfGrant.has(writer)) return false;
    return true;
  }

  private pool(project: string): Item[] {
    const hit = this.pools.get(project);
    if (hit) return keep(this.pools, project, hit, POOLS_KEPT);
    return keep(this.pools, project, this.store.projectItems(project, POOL), POOLS_KEPT);
  }

  private rulesList(): Item[] {
    this.rulesCache ??= this.store.rules();
    return this.rulesCache;
  }

  private names(): { key: string; names: string[] }[] {
    if (this.nameCache) return this.nameCache;
    const names = new Map<string, string[]>();
    for (const p of this.store.q<{ key: string; name: string }>('SELECT key, name FROM projects')) names.set(p.key, [p.name]);
    for (const a of this.store.q<{ alias: string; key: string }>('SELECT alias, key FROM aliases')) names.get(a.key)?.push(a.alias);
    this.nameCache = [...names.entries()].map(([key, n]) => ({ key, names: [...new Set(n.filter(Boolean))] }));
    return this.nameCache;
  }

  private deliveredFor(reader: string): Set<string> {
    const hit = this.deliveredCache.get(reader);
    if (hit) return keep(this.deliveredCache, reader, hit, SESSIONS_KEPT);
    return keep(this.deliveredCache, reader, new Set(this.store.delivered(reader)), SESSIONS_KEPT);
  }

  private readsList(): ReadRow[] {
    this.readsCache ??= this.store.meta<ReadRow[]>('reads', []);
    return this.readsCache;
  }

  private walkFirst(project: string, f: { seen: Set<string>; once: boolean; reader: string; grant: string; now: number; liveOfGrant: Set<string>; putBack: Item[] }): Item[] {
    const out: Item[] = [];
    const shown = new Set(f.putBack.map((i) => i.id));
    let cards = 0;
    let handoff = false;
    let after: Item | null = null;
    while (out.length < POOL && (cards < 3 || !handoff)) {
      const page = this.store.walk(project, after, Math.min(WALK_PAGE, POOL - out.length));
      for (const i of page) {
        out.push(i);
        if (i.held) continue;
        if (i.kind === 'card' && !(f.once && f.seen.has(i.id)) && !shown.has(i.id)) cards++;
        if (i.kind === 'handoff' && !f.seen.has(i.id) && this.offer(i, f.reader, f.grant, f.now, f.liveOfGrant)) handoff = true;
      }
      if (page.length < WALK_PAGE) break;
      after = page[page.length - 1];
    }
    return out;
  }

  private memory(o: { project: string; reader: string; grant: string; agent: string; query?: string; first: boolean; once: boolean; putBack: Item[]; rulesOnly?: boolean; ids?: string[]; tool?: boolean; now: number }): { text: string; delivered: string[] } {
    const query = (o.query ?? '').trim();
    const rules = this.rulesList();
    const live = this.limits.live(o.now);
    const liveOfGrant = new Set(live.filter((s) => s.grant === o.grant).map((s) => `s-${s.sid}`));
    const seen = this.deliveredFor(o.reader);
    let items: Item[] = [];
    let projects: { key: string; names: string[] }[] = [];
    const ids = o.ids?.length ? o.ids : undefined;
    if (!o.rulesOnly) {
      if (query || ids) {
        items = this.pool(o.project);
        projects = this.names();
        for (const key of namedProjects(query, projects, o.project)) items = items.concat(this.pool(key));
      } else if (this.pools.has(o.project)) {
        items = this.pool(o.project);
      } else {
        items = this.walkFirst(o.project, { seen, once: o.once, reader: o.reader, grant: o.grant, now: o.now, liveOfGrant, putBack: o.putBack });
      }
    }
    const byId = new Map<string, Item>();
    for (const i of [...items, ...rules]) byId.set(i.id, i);
    const pool = [...byId.values()].filter((i) => i.kind !== 'handoff' || this.offer(i, o.reader, o.grant, o.now, liveOfGrant));
    const res = recall({
      project: o.project,
      items: pool,
      projects,
      query,
      first: o.first,
      seen: [...seen],
      putBack: o.putBack,
      now: o.now,
      live: live.map((s) => `s-${s.sid}`).filter((s) => s !== o.reader),
      once: o.once,
      ids,
      tool: o.tool === true,
    });
    const record = (o.once || ids ? res.delivered : res.delivered.filter((id) => byId.get(id)?.kind === 'handoff')).filter((id) => !seen.has(id));
    if (record.length) {
      for (const id of record) seen.add(id);
      this.store.setDelivered(o.reader, [...seen]);
    }
    const handoffs = res.delivered.filter((id) => byId.get(id)?.kind === 'handoff');
    if (handoffs.length) {
      const list = [...handoffs.map((item) => ({ item, agent: o.agent, at: o.now })), ...this.readsList()].slice(0, READS_KEPT);
      this.readsCache = list;
      this.store.setMeta('reads', list);
    }
    return res;
  }

  private queued(project: string): Item[] {
    const ids = this.store.q<{ item: string }>('SELECT item FROM queue ORDER BY at').map((r) => r.item);
    return this.store.items(ids).filter((i) => i.project === project);
  }

  private unqueue(ids: string[]): void {
    for (const id of ids) this.store.q('DELETE FROM queue WHERE item = ?', id);
  }

  async recall(c: Caller, a: RecallArgs, tool = false): Promise<Result> {
    return this.measure(async () => {
      const now = this.now();
      const stop = await this.gate(c, now, 'read', a);
      if (stop) return stop;
      try {
        const project = this.project(a, now);
        const query = (a.query ?? '').trim();
        if (!project && this.refusal) return { ok: false, text: this.refusal };
        if (!project) return this.placeless(!query, now);
        const queued = this.queued(project);
        let putBack = queued;
        if (a.dropped) {
          const dropped = this.pool(project).filter((i) => i.kind === 'dropped' && !i.held && !queued.some((q) => q.id === i.id));
          putBack = [...queued, ...(query ? rankItems(dropped, query, now).slice(0, 5).map((h) => h.item) : dropped.slice(0, 5))];
        }
        const ids = Array.isArray(a.ids) ? a.ids.filter((x): x is string => typeof x === 'string' && x.length >= 8 && x.length <= 36).slice(0, 6) : [];
        const res = this.memory({ project, reader: `g-${c.grant}`, grant: c.grant, agent: c.agent, query, first: !query && !ids.length, once: false, putBack: ids.length ? [] : putBack, ids, tool, now });
        this.unqueue(res.delivered.filter((id) => queued.some((q) => q.id === id)));
        return { ok: true, text: res.text };
      } catch {
        return { ok: false, text: FAILED };
      }
    });
  }

  private placeless(first: boolean, now: number): Result {
    const rules = first ? this.rulesList().filter((r) => (r.body as RuleBody).scope === 'all') : [];
    const res = rules.length ? recall({ project: '', items: rules, projects: [], first: true, seen: [], now }) : { text: '' };
    return { ok: true, text: res.text ? `${res.text}\n\n${SAY.placeRead}` : SAY.placeRead, noProject: true };
  }

  private lastGoal(project: string, agent: string): string | null {
    const hit = this.pool(project).find((i) => (i.kind === 'card' || i.kind === 'handoff') && i.origin?.agent === agent && !i.folded && typeof (i.body as CardBody).goal === 'string' && (i.body as CardBody).goal.trim());
    return hit ? (hit.body as CardBody).goal : null;
  }

  private promptGoal(grant: string, project: string, folder: string | undefined, now: number): string | null {
    const name = typeof folder === 'string' ? folderName(redact(folder.trim())) : '';
    const keys = new Set([project, ...(name ? [`folder:${name}`] : [])]);
    for (const l of this.limits.live(now).filter((x) => x.grant === grant).sort((x, y) => y.last - x.last)) {
      const where = this.sessionCache.get(l.sid)?.project ?? this.store.q<{ project: string }>('SELECT project FROM sessions WHERE id = ?', l.sid)[0]?.project;
      if (!where || !keys.has(where)) continue;
      const rows = this.eventCache.get(l.sid) ?? this.store.sessionEvents(l.sid);
      const prompt = [...rows].reverse().find((r) => r.t === 'prompt' && r.text && r.text.trim());
      if (prompt?.text) return cut(prompt.text.trim().split('\n')[0], 200);
    }
    return null;
  }

  private write(c: Caller, now: number, kind: 'card' | 'handoff' | 'rule', project: string, body: CardBody | HandoffBody | RuleBody, source: Source, marks: string[], text: string): Result {
    const said = (m?: 'same' | 'added') => (m === 'same' ? SAME_CARD : m === 'added' ? ADDED_CARD : text);
    const fresh = newItem(kind, project, body, this.origin(c, now, 'tool', source, `g-${c.grant}`));
    const r = this.save(fresh, now, true, (saved) => {
      for (const m of marks) this.limits.setMark(m, { id: saved.id, at: now, text: said(saved.id === fresh.id ? undefined : 'added') });
    });
    if (!r.ok) return r;
    const { merged, ...rest } = r;
    return { ...rest, text: said(merged) };
  }

  async checkpoint(c: Caller, a: CheckpointArgs): Promise<Result> {
    return this.measure(async () => {
      const now = this.now();
      const stop = await this.gate(c, now, 'write', a);
      if (stop) return stop;
      const project = this.project(a, now);
      if (!project) return { ok: false, text: this.refusal ?? SAY.place };
      const own = (v: unknown) => (typeof v === 'string' ? stripOwn(stripPrivate(v)).trim() : '');
      const list = (v: unknown) => strings(v)?.filter((x) => own(x));
      const given = [a.goal, a.changed, a.decisions, a.commands, a.dead_ends, a.open].some((v) => (Array.isArray(v) ? !!strings(v)?.length : typeof v === 'string' && v.trim() !== ''));
      const body: CardBody = compact({
        goal: 'x',
        changed: list(a.changed)?.map((path) => ({ path })),
        decisions: list(a.decisions)?.map((what) => ({ what })),
        commands: list(a.commands),
        dead_ends: list(a.dead_ends),
        open: list(a.open),
      });
      if (given && !own(a.goal) && !body.changed && !body.decisions && !body.commands && !body.dead_ends && !body.open) return { ok: true, text: NOTHING_NEW };
      body.goal = own(a.goal) ? (a.goal as string) : (this.promptGoal(c.grant, project, a.folder, now) ?? NOT_STATED);
      const memo = this.remembered(c, 'card', project, body, a.key, now);
      if (memo.hit) return memo.hit;
      return this.write(c, now, 'card', project, body, 'agent', memo.marks, 'Checkpoint saved. The open tasks are shown to the next agent when that agent\'s session starts.');
    });
  }

  async handoff(c: Caller, a: HandoffArgs): Promise<Result> {
    return this.measure(async () => {
      const now = this.now();
      const stop = await this.gate(c, now, 'write', a);
      if (stop) return stop;
      const project = this.project(a, now);
      if (!project) return { ok: false, text: this.refusal ?? SAY.place };
      const body: HandoffBody = compact({
        goal: 'x',
        done: a.done,
        next: 'x',
        blockers: strings(a.blockers),
        files: strings(a.files),
        check: a.check,
        question: a.question,
        task: a.task,
      });
      body.goal = typeof a.goal === 'string' && a.goal.trim() ? a.goal : (this.lastGoal(project, c.agent) ?? NOT_STATED);
      body.next = typeof a.next === 'string' && a.next.trim() ? a.next : NOT_STATED;
      const memo = this.remembered(c, 'handoff', project, body, a.key, now);
      if (memo.hit) return memo.hit;
      return this.write(c, now, 'handoff', project, body, 'agent', memo.marks, 'Handoff saved for the next agent.');
    });
  }

  private draftRule(c: Caller, a: RuleArgs, now: number): Result | { project: string; body: RuleBody; clean: Item } {
    const scope = a.scope === 'project' ? 'project' : 'all';
    const named = (v: unknown) => typeof v === 'string' && v.trim() !== '';
    if (scope === 'project' && !named(a.repo) && !named(a.folder)) return { ok: false, text: SAY.where };
    const project = scope === 'all' ? '' : this.project(a, now);
    if (project === null) return { ok: false, text: this.refusal ?? SAY.where };
    const body: RuleBody = { text: typeof a.text === 'string' ? a.text : '', words: typeof a.words === 'string' ? a.words : '', scope, status: 'pending' };
    try {
      return { project, body, clean: fit(sanitizeItem(newItem('rule', project, body, this.origin(c, now, 'tool', 'agent', `g-${c.grant}`)))) };
    } catch {
      return { ok: false, text: SAY.clean };
    }
  }

  async ruleDraft(c: Caller, a: RuleArgs): Promise<Result & { line?: string; held?: boolean }> {
    return this.measure(async () => {
      const now = this.now();
      const stop = await this.gate(c, now, 'write', a);
      if (stop) return stop;
      const d = this.draftRule(c, a, now);
      if ('ok' in d) return d;
      return { ok: true, text: '', line: ruleLine(d.clean.body as RuleBody), held: d.clean.held };
    });
  }

  async rule(c: Caller, a: RuleArgs, seen?: string): Promise<Result> {
    return this.measure(async () => {
      const now = this.now();
      const stop = await this.gate(c, now, 'write', a);
      if (stop) return stop;
      const d = this.draftRule(c, a, now);
      if ('ok' in d) return d;
      const accepted = typeof seen === 'string' && !d.clean.held && ruleLine(d.clean.body as RuleBody) === seen;
      const memo = this.remembered(c, 'rule', d.project, [a.text, a.words, d.body.scope, accepted], a.key, now);
      if (memo.hit) return memo.hit;
      const decision = decideRule({ via: 'tool', accepted });
      const body: RuleBody = { ...d.body, status: decision.status, ...(decision.proof ? { proof: decision.proof } : {}) };
      const text = decision.status === 'active' ? decision.reason : `Rule saved as pending. The person turns the rule on with Accept at ${this.page?.address() ?? 'the agent-ctx page'}.`;
      return this.write(c, now, 'rule', d.project, body, accepted ? 'person' : 'agent', memo.marks, text);
    });
  }

  async event(c: Caller, a: EventArgs, part?: Part): Promise<Result> {
    return this.measure(async () => {
      const now = this.now();
      const stop = await this.gate(c, now, 'write', a);
      if (stop) return { ok: true, text: '' };
      const name = val(a.event) ?? '';
      const host = val(a.host) ?? '';
      const asks = name === 'UserPromptSubmit' || name === 'SessionStart';
      try {
        return { ok: true, text: this.onEvent(c, a, name, host, now, part) };
      } catch {
        return { ok: true, text: asks ? hookOutput(host, name, FAILED) : '' };
      }
    });
  }

  private writeSession(s: Live, now: number): void {
    this.store.q('UPDATE sessions SET last = ?, model = ?, n = ?, primed = ? WHERE id = ?', s.last, s.model, s.n, s.primed, s.id);
    s.written = now;
  }

  private session(c: Caller, sid: string, a: EventArgs, now: number): Live | null {
    const raw = val(a.model);
    const model = raw ? clean(raw, 80) : undefined;
    let s = this.sessionCache.get(sid);
    if (!s) {
      const row = this.store.q<SessionRow>('SELECT * FROM sessions WHERE id = ?', sid)[0];
      if (row) s = { ...row, n: row.n ?? 0, written: row.last, auto: {} };
    }
    if (s && s.grant_id !== c.grant) return null;
    if (s) {
      keep(this.sessionCache, sid, s, SESSIONS_KEPT);
      const changed = !!model && s.model !== model;
      if (changed) s.model = model ?? null;
      s.last = now;
      if (changed || now - s.written >= MINUTE) this.writeSession(s, now);
      this.limits.seen(sid, s.grant_id, now);
      return s;
    }
    const project = this.project({ folder: val(a.cwd) }, now);
    if (!project) return null;
    const fresh: Live = { id: sid, agent: c.agent, model: model ?? null, project, start: now, last: now, primed: 0, grant_id: c.grant, n: 0, written: now, auto: {} };
    const n = rowBytes(fresh.id, fresh.agent, fresh.model, fresh.project, fresh.grant_id);
    while (!this.room(n) && this.freeEvents(sid));
    if (!this.room(n)) return null;
    this.addExtra(n);
    this.store.q('INSERT INTO sessions(id, agent, model, project, start, last, primed, grant_id, n) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)', fresh.id, fresh.agent, fresh.model, fresh.project, fresh.start, fresh.last, fresh.primed, fresh.grant_id, fresh.n);
    keep(this.sessionCache, sid, fresh, SESSIONS_KEPT);
    this.limits.seen(sid, c.grant, now);
    return fresh;
  }

  private addEvent(s: Live, t: EvType, now: number, raw: { text?: string; path?: string; ok?: boolean; limit?: number }): EventRow | null {
    const text = raw.text !== undefined ? cleanText(raw.text, raw.limit) : undefined;
    const path = raw.path !== undefined ? cleanText(raw.path) : undefined;
    const flags = [...new Set([...(text?.flags ?? []), ...(path?.flags ?? [])])];
    const ev: Ev = compact({ t, at: now, text: text?.text, path: path?.text });
    const row: EventRow = { session: s.id, key: eventKey(s.id, ev), t, at: now, text: ev.text ?? null, path: ev.path ?? null, ok: raw.ok === undefined ? null : raw.ok ? 1 : 0, flags: flags.length ? JSON.stringify(flags) : null };
    const size = rowBytes(row.session, row.key, row.t, row.text, row.path, row.flags);
    while (!this.room(size) && this.freeEvents(s.id));
    if (!this.room(size)) {
      this.limits.refuse(SAY.full, now);
      return null;
    }
    const rows = this.store.q<{ key: string }>(
      'INSERT INTO events(session, key, t, at, text, path, ok, flags) VALUES(?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session, key) DO NOTHING RETURNING key',
      row.session,
      row.key,
      row.t,
      row.at,
      row.text,
      row.path,
      row.ok,
      row.flags,
    );
    if (!rows.length) return null;
    this.addExtra(size);
    s.n++;
    this.eventCache.get(s.id)?.push(row);
    if (s.n > EVENTS_PER_SESSION) this.events(s, now);
    return row;
  }

  private onEvent(c: Caller, a: EventArgs, name: string, host: string, now: number, part?: Part): string {
    const sid = val(a.session);
    if (!sid || sid.length > ID_MAX) return '';
    const tool = val(a.tool);
    if (tool && OWN_TOOL.test(tool)) return '';
    const cwd = val(a.cwd);
    if (!cwd || cwd.length > PATH_MAX) return '';
    const s = this.session(c, sid, a, now);
    if (!s) return '';
    const reader = `s-${sid}`;
    const reads = c.scopes.includes('read');
    if (name === 'UserPromptSubmit') {
      const prompt = val(a.prompt);
      if (!prompt) return '';
      const stripped = stripOwn(stripPrivate(prompt));
      const first = !s.primed;
      let kept: string | undefined;
      if (stripped.trim().length < 15) {
        if (!first || !stripped.trim() || /^[/!#]/.test(stripped.trim())) return '';
      } else {
        if (part !== 'recall') {
          const row = this.addEvent(s, 'prompt', now, { text: stripped, limit: stripped.length <= PROMPT_LONG ? undefined : PROMPT_KEPT });
          if (!row) return '';
          kept = row.text ?? undefined;
        }
        if (quietPrompt(stripped)) return '';
      }
      if (!reads || part === 'store') return '';
      const putBack = this.queued(s.project);
      const query = first ? undefined : (kept ?? cleanText(stripped).text);
      const res = this.memory({ project: s.project, reader, grant: c.grant, agent: c.agent, query, first, once: true, putBack, now });
      this.unqueue(res.delivered.filter((id) => putBack.some((p) => p.id === id)));
      if (first) {
        s.primed = 1;
        this.writeSession(s, now);
      }
      const paused = first ? this.limits.paused(now) : null;
      const text = paused ? withLine(res.text, paused, s.project, 3000) : res.text;
      return hookOutput(host, name, text);
    }
    if (name === 'PostToolUse' || name === 'PostToolUseFailure') {
      const file = val(a.file);
      const command = val(a.command);
      if (file && file.length <= PATH_MAX) this.addEvent(s, 'edit', now, { path: file });
      if (command) this.addEvent(s, 'command', now, { text: command, ok: name === 'PostToolUse', limit: COMMAND_CHARS });
      return '';
    }
    if (name === 'Stop' || name === 'StopFailure') {
      const message = val(a.message);
      this.addEvent(s, 'stop', now, { text: message ? stripOwn(message) : '', ok: name === 'Stop', limit: STOP_CHARS });
      this.rebuild(s, now, true);
      return '';
    }
    if (name === 'PostCompact') {
      const summary = val(a.summary);
      if (summary) this.addEvent(s, 'compact', now, { text: summary, limit: SUMMARY_CHARS });
      this.dropped(s, now);
      return '';
    }
    if (name === 'SessionStart') {
      const source = val(a.source);
      if (source !== 'clear' && source !== 'compact') return '';
      if (!reads) return '';
      if (this.deliveredFor(reader).size) this.store.dropDelivered(reader);
      this.deliveredCache.set(reader, new Set());
      const putBack = this.queued(s.project);
      const res = this.memory({ project: s.project, reader, grant: c.grant, agent: c.agent, first: true, once: true, putBack, rulesOnly: true, now });
      this.unqueue(res.delivered.filter((id) => putBack.some((p) => p.id === id)));
      return hookOutput(host, name, res.text);
    }
    if (name === 'SessionEnd') {
      this.rebuild(s, now, false);
      return '';
    }
    return '';
  }

  private events(s: Live, now: number): { evs: Ev[]; flags: string[] } {
    let rows = this.eventCache.get(s.id);
    if (!rows) rows = this.store.sessionEvents(s.id);
    rows.sort((x, y) => x.at - y.at || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    const old = now - KEEP_EVENTS;
    const drop = rows.filter((r, i) => r.at < old || i < rows!.length - EVENTS_PER_SESSION);
    if (drop.length) {
      const gone = new Set(drop.map((r) => r.key));
      for (const r of drop) this.store.q('DELETE FROM events WHERE session = ? AND key = ?', s.id, r.key);
      rows = rows.filter((r) => !gone.has(r.key));
    }
    if (s.n !== rows.length) {
      s.n = rows.length;
      this.writeSession(s, now);
    }
    keep(this.eventCache, s.id, rows, EVENT_SESSIONS_KEPT);
    const flags = new Set<string>();
    for (const r of rows) for (const f of r.flags ? (JSON.parse(r.flags) as string[]) : []) flags.add(f);
    const evs = rows.map((r) => compact({ t: r.t as EvType, at: r.at, text: r.text ?? undefined, path: r.path ?? undefined, ok: r.ok === null ? undefined : r.ok === 1 }) as Ev);
    return { evs, flags: [...flags] };
  }

  private autoId(s: Live, kind: string): string | null {
    if (!(kind in s.auto)) s.auto[kind] = this.store.meta<string | null>(`auto-${kind}:${s.id}`, null);
    return s.auto[kind];
  }

  private auto(s: Live, kind: 'card' | 'handoff', body: CardBody | HandoffBody, flags: string[], now: number): void {
    const id = this.autoId(s, kind);
    const old = id ? (this.pools.get(s.project)?.find((i) => i.id === id) ?? this.store.item(id)) : null;
    const source: Source = kind === 'card' && !(body as CardBody).last ? 'person' : 'agent';
    const origin = compact({ agent: s.agent, model: s.model ?? undefined, session: `s-${s.id}`, via: 'hook' as Via, source, at: now }) as Origin;
    const item: Item = { ...newItem(kind, s.project, body, origin), flags };
    const joined = kind === 'card' && !!old && this.autoId(s, 'card-merged') === old.id;
    if (joined && old) {
      let clean: Item;
      try {
        clean = fit(sanitizeItem({ ...item, id: old.id, created: old.created }));
      } catch {
        return;
      }
      if (!this.mergeable(old, clean, now)) return;
      const next = mergeCard(old, clean, now);
      if (next !== old && this.save(next, now, false).ok) this.forgetDelivered(old.id);
      return;
    }
    if (old) {
      item.id = old.id;
      item.pinned = old.pinned;
      if (kind === 'card') item.created = old.created;
    }
    const remember = (id: string, merged: boolean) => {
      s.auto[kind] = id;
      this.store.setMeta(`auto-${kind}:${s.id}`, id);
      if (!merged) return;
      s.auto['card-merged'] = id;
      this.store.setMeta(`auto-card-merged:${s.id}`, id);
    };
    const r = this.save(item, now, !old, (saved) => {
      if (!old) remember(saved.id, saved.id !== item.id);
    });
    if (!old && r.merged === 'same' && r.item) remember(r.item.id, true);
  }

  private rebuild(s: Live, now: number, handoff: boolean): void {
    const { evs, flags } = this.events(s, now);
    const card = autoCard(evs);
    if (card) this.auto(s, 'card', card, flags, now);
    if (!handoff) return;
    const lastPrompt = evs.reduce((n, e, i) => (e.t === 'prompt' && e.text ? i : n), -1);
    const failed = evs.some((e, i) => i > lastPrompt && e.t === 'stop' && e.ok === false);
    const h = autoHandoff(evs.filter((e) => !(e.t === 'stop' && e.ok === false)));
    if (!h) return;
    if (failed) h.next = `Stopped by an error. ${h.next.replace(/^Unfinished request\. /, '')}`;
    this.auto(s, 'handoff', h, flags, now);
  }

  private dropped(s: Live, now: number): void {
    const k = `dropped:${s.id}`;
    for (const id of this.store.meta<string[]>(k, [])) {
      const item = this.store.item(id);
      if (!item) continue;
      const n = this.removeItem(item);
      this.limits.setBytes(this.limits.bytes() - n);
      this.push({ type: 'remove', id });
    }
    const { evs, flags } = this.events(s, now);
    const ids: string[] = [];
    const origin = compact({ agent: s.agent, model: s.model ?? undefined, session: `s-${s.id}`, via: 'hook' as Via, source: 'agent' as Source, at: now }) as Origin;
    for (const body of droppedAt(evs, now)) {
      const r = this.save({ ...newItem('dropped', s.project, body, origin), flags }, now, true);
      if (r.ok && r.item) ids.push(r.item.id);
    }
    this.store.setMeta(k, ids);
  }

  private maintain(now: number): void {
    const h = this.limits.state();
    if (now - h.maintained < DAY) return;
    h.maintained = now;
    this.limits.touch();
    const old = now - KEEP_EVENTS;
    for (const { id } of this.store.q<{ id: string }>('SELECT id FROM sessions WHERE last < ?', old)) this.dropSession(id);
    this.recountExtra();
  }

  async me(): Promise<Me> {
    const now = this.now();
    const t = this.limits.today(now);
    return { bytes: this.limits.bytes() + this.limits.extra(), max: this.limits.max.storeBytes, callsToday: t.calls, storedToday: t.stored };
  }

  async space(): Promise<Space> {
    const counts = new Map(this.store.q<{ project: string; n: number }>('SELECT project, COUNT(*) AS n FROM items GROUP BY project').map((r) => [r.project, r.n]));
    const projects = this.store.q<{ key: string; name: string }>('SELECT key, name FROM projects ORDER BY created').map((p) => ({ key: p.key, name: p.name, items: counts.get(p.key) ?? 0 }));
    return {
      projects,
      agents: this.store.q<AgentRow>('SELECT * FROM agents ORDER BY first'),
      items: this.store.newest(SPACE_ITEMS).map(view),
      queue: this.store.q<{ item: string }>('SELECT item FROM queue ORDER BY at').map((r) => r.item),
      reads: this.readsList().slice(0, READS_KEPT),
      now: this.now(),
    };
  }

  private change(id: string, fn: (i: Item) => Item | null): ItemView | null {
    const i = this.store.item(id);
    if (!i) return null;
    const next = fn(i);
    if (!next) return null;
    this.putItem(next);
    this.push({ type: 'item', item: next });
    return view(next);
  }

  async pin(id: string, on: boolean): Promise<ItemView | null> {
    return this.change(id, (i) => ({ ...i, pinned: !!on }));
  }

  async keep(id: string): Promise<ItemView | null> {
    return this.change(id, (i) => ({ ...i, held: false }));
  }

  async putBack(id: string): Promise<ItemView | null> {
    const i = this.store.item(id);
    if (!i || i.kind === 'rule') return null;
    this.store.q('INSERT INTO queue(item, at) VALUES(?, ?) ON CONFLICT(item) DO UPDATE SET at = excluded.at', id, this.now());
    this.push({ type: 'item', item: i });
    return view(i);
  }

  async remove(id: string): Promise<boolean> {
    const item = this.store.item(id);
    if (!item) return false;
    const n = this.removeItem(item);
    const now = this.now();
    this.limits.setBytes(this.limits.bytes() - n);
    this.limits.flush(now, true);
    this.push({ type: 'remove', id });
    return true;
  }

  async addRule(a: { text: string; scope: 'project' | 'all'; project?: string }): Promise<Result> {
    const now = this.now();
    const text = typeof a.text === 'string' ? a.text.trim() : '';
    if (!text) return { ok: false, text: 'A rule must have text.' };
    if (text.length > 600) return { ok: false, text: SAY.size };
    const scope = a.scope === 'project' ? 'project' : 'all';
    const key = typeof a.project === 'string' ? a.project : '';
    if (scope === 'project' && !this.store.q('SELECT key FROM projects WHERE key = ?', key).length) return { ok: false, text: 'That project is not in this memory.' };
    const d = decideRule({ via: 'page' });
    const body: RuleBody = { text, words: text, scope, status: d.status, proof: d.proof };
    const origin: Origin = { agent: 'page', via: 'page', source: 'person', at: now };
    const r = this.save(newItem('rule', key, body, origin), now, true);
    return r.item ? { ...r, item: view(r.item) } : r;
  }

  async setRule(id: string, status: 'active' | 'off', line?: string): Promise<ItemView | 'changed' | null> {
    if (status !== 'active' && status !== 'off') return null;
    const cur = this.store.item(id);
    if (!cur || cur.kind !== 'rule') return null;
    if (typeof line === 'string' && ruleLine(cur.body as RuleBody) !== line) return 'changed';
    return this.change(id, (i) => {
      if (i.kind !== 'rule') return null;
      const b = i.body as RuleBody;
      const on = status === 'active' && b.status !== 'active';
      return { ...i, held: status === 'active' ? false : i.held, body: { ...b, status, ...(on ? { proof: 'page' as const } : {}) } };
    });
  }

  async mergeProjects(from: string, into: string): Promise<boolean> {
    if (!from || !into || from === into) return false;
    const has = (k: string) => this.store.q('SELECT key FROM projects WHERE key = ?', k).length > 0;
    if (!has(from) || !has(into)) return false;
    this.sql.transactionSync(() => {
      this.store.q('UPDATE items SET project = ? WHERE project = ?', into, from);
      this.store.q('UPDATE paths SET key = ? WHERE key = ?', into, from);
      this.store.q('UPDATE aliases SET key = ? WHERE key = ?', into, from);
      this.store.q('UPDATE sessions SET project = ? WHERE project = ?', into, from);
      this.store.q('DELETE FROM projects WHERE key = ?', from);
    });
    this.recountExtra();
    this.pools.clear();
    this.rulesCache = null;
    this.nameCache = null;
    this.resolved.clear();
    this.projectKeys.clear();
    this.sessionCache.clear();
    this.push({ type: 'reset' });
    return true;
  }

  exported(): Exported {
    return {
      items: this.store.all(),
      projects: this.store.q<{ key: string; name: string }>('SELECT key, name FROM projects ORDER BY created'),
      agents: this.store.q<AgentRow>('SELECT * FROM agents ORDER BY first'),
    };
  }

  async generation(): Promise<number> {
    return this.store.meta<number>('generation', 0);
  }

  async removeAgent(label: string): Promise<boolean> {
    const gone = this.store.q<{ id: string }>('DELETE FROM agents WHERE id = ? RETURNING id', label).length > 0;
    this.agentLast.delete(label);
    if (gone) this.push({ type: 'agent-removed', id: label });
    return gone;
  }

  async wipe(): Promise<void> {
    const generation = this.store.meta<number>('generation', 0) + 1;
    this.push({ type: 'reset' });
    this.page?.close();
    await this.sql.deleteAll();
    this.store.init();
    this.store.setMeta('generation', generation);
    this.forget();
    this.limits.reset();
  }

  async rowCount(): Promise<number> {
    let n = 0;
    for (const t of TABLES) n += this.store.count(t);
    return n;
  }
}
