import { DurableObject } from 'cloudflare:workers';
import {
  FOLD_AT,
  FOOTER,
  HEADER,
  autoCard,
  autoHandoff,
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
import { Store, TABLES, newer, type AgentRow, type EventRow, type ReadRow, type SessionRow } from './store.ts';
import { Limits, SAY } from './limits.ts';
import { buildExport } from './export.ts';

export interface Caller { agent: string; grant: string; scopes: string[] }
export interface Result { ok: boolean; text: string; item?: Item }
export interface Where { repo?: string; folder?: string }
export interface RecallArgs extends Where { query?: string; dropped?: boolean }
export interface CheckpointArgs extends Where { goal: string; changed?: string[]; decisions?: string[]; commands?: string[]; dead_ends?: string[]; open?: string[]; key?: string }
export interface HandoffArgs extends Where { goal: string; done?: string; next: string; blockers?: string[]; files?: string[]; check?: string; question?: string; task?: string; key?: string }
export interface RuleArgs extends Where { text: string; words: string; scope: 'project' | 'all'; key?: string }
export interface EventArgs { host?: string; event?: string; session?: string; cwd?: string; prompt?: string; tool?: string; file?: string; command?: string; message?: string; summary?: string; reason?: string; source?: string; model?: string }
export interface Space { projects: { key: string; name: string; items: number }[]; agents: AgentRow[]; items: Item[]; queue: string[]; reads: ReadRow[]; now: number }
export interface Me { bytes: number; max: number; callsToday: number; storedToday: number }

const MINUTE = 60000;
const DAY = 86400000;
const LIVE = 3 * MINUTE;
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
const PLACEHOLDER = /^\$\{[^}]*\}$/;
const FAILED = 'Memory could not be loaded. Do not assume that nothing is stored.';

function val(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s || PLACEHOLDER.test(s)) return undefined;
  return v;
}

function cleanText(s: string): { text: string; flags: string[] } {
  const r = sanitize(redact(stripOwn(stripPrivate(s))));
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

export class Person extends DurableObject<Env> {
  store: Store;
  limits: Limits;
  lastRows = { read: 0, written: 0 };
  bootRows = { read: 0, written: 0 };
  instance = crypto.randomUUID();
  private pools = new Map<string, Item[]>();
  private rulesCache: Item[] | null = null;
  private nameCache: { key: string; names: string[] }[] | null = null;
  private resolved = new Map<string, string>();
  private projectKeys = new Set<string>();
  private agentLast = new Map<string, number>();
  private sessionCache = new Map<string, Live>();
  private deliveredCache = new Map<string, Set<string>>();
  private eventCache = new Map<string, EventRow[]>();
  private readsCache: ReadRow[] | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new Store(ctx.storage.sql);
    this.limits = new Limits(this.store);
    ctx.blockConcurrencyWhile(async () => {
      this.store.init();
      this.bootRows = this.store.counts();
    });
  }

  private measure<T>(fn: () => T): T {
    const before = this.store.counts();
    try {
      return fn();
    } finally {
      this.limits.flush(Date.now());
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

  private push(msg: unknown): void {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        continue;
      }
    }
  }

  private gate(c: Caller, now: number, need: 'read' | 'write', input: unknown): Result | null {
    if (!c.scopes.includes(need)) return { ok: false, text: need === 'write' ? SAY.scope : SAY.noread };
    const limited = this.limits.call(now);
    if (limited) return { ok: false, text: limited };
    this.maintain(now);
    if (input !== null && JSON.stringify(input ?? null).length > this.limits.max.inputBytes) return { ok: false, text: SAY.size };
    return this.touchAgent(c.agent, now);
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
    const n = this.store.q<{ n: number }>('SELECT COUNT(*) AS n FROM agents')[0]?.n ?? 0;
    if (n >= this.limits.max.agents) return { ok: false, text: SAY.agents };
    const agent: AgentRow = { id: label, label, first: now, last: now };
    this.store.q('INSERT INTO agents(id, label, first, last) VALUES(?, ?, ?, ?)', agent.id, agent.label, agent.first, agent.last);
    this.agentLast.set(label, now);
    this.push({ type: 'agent', agent });
    return null;
  }

  private project(w: Where, now: number): string {
    const folder = redact((typeof w.folder === 'string' ? w.folder : '').trim());
    const repo = typeof w.repo === 'string' ? w.repo : '';
    const memo = `${repo}\u0001${folder}`;
    const hit = this.resolved.get(memo);
    if (hit !== undefined) return hit;
    const name = folder ? folderName(folder) : '';
    const known: Known = { paths: {}, aliases: {}, repos: [] };
    if (folder) {
      const p = this.store.q<{ key: string }>('SELECT key FROM paths WHERE path = ?', folder)[0];
      if (p) known.paths[folder] = p.key;
    }
    if (name) {
      const a = this.store.q<{ key: string }>('SELECT key FROM aliases WHERE alias = ?', name)[0];
      if (a) known.aliases[name] = a.key;
      known.repos = this.store.q<{ key: string }>("SELECT key FROM projects WHERE name = ? AND key NOT LIKE 'folder:%'", name).map((r) => r.key);
    }
    const remote = repo ? cleanRemote(repo) : null;
    const resolved = resolveProject({ repo: remote ?? undefined, folder }, known);
    const r = { ...resolved, key: redact(resolved.key) };
    let changed = false;
    if (r.learn?.path && known.paths[r.learn.path] !== r.key) {
      this.store.q('INSERT INTO paths(path, key) VALUES(?, ?) ON CONFLICT(path) DO UPDATE SET key = excluded.key', r.learn.path, r.key);
      changed = true;
    }
    if (r.learn?.alias && known.aliases[r.learn.alias] !== r.key) {
      this.store.q('INSERT INTO aliases(alias, key) VALUES(?, ?) ON CONFLICT(alias) DO UPDATE SET key = excluded.key', r.learn.alias, r.key);
      changed = true;
    }
    if (!this.projectKeys.has(r.key)) {
      const added = this.store.q('INSERT INTO projects(key, name, created) VALUES(?, ?, ?) ON CONFLICT(key) DO NOTHING RETURNING key', r.key, projectName(r.key), now);
      if (added.length) changed = true;
      this.projectKeys.add(r.key);
    }
    if (changed) {
      this.resolved.clear();
      this.nameCache = null;
    }
    keep(this.resolved, memo, r.key, 200);
    return r.key;
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
    const limit = this.limits.max.storeBytes;
    const size = itemBytes(clean);
    let total = this.limits.bytes();
    let prev = this.store.bytesOf(clean.id);
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
    after?.(clean);
    this.limits.flush(now, true);
    this.push({ type: 'item', item: clean });
    return { ok: true, text: '', item: clean };
  }

  private fold(now: number): number {
    const limit = this.limits.max.storeBytes;
    let total = 0;
    this.ctx.storage.transactionSync(() => {
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

  private memory(o: { project: string; reader: string; grant: string; agent: string; query?: string; first: boolean; once: boolean; putBack: Item[]; rulesOnly?: boolean; now: number }): { text: string; delivered: string[] } {
    const query = (o.query ?? '').trim();
    const rules = this.rulesList();
    const live = this.limits.live(o.now);
    const liveOfGrant = new Set(live.filter((s) => s.grant === o.grant).map((s) => `s-${s.sid}`));
    const seen = this.deliveredFor(o.reader);
    let items: Item[] = [];
    let projects: { key: string; names: string[] }[] = [];
    if (!o.rulesOnly) {
      if (query) {
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
    });
    const record = (o.once ? res.delivered : res.delivered.filter((id) => byId.get(id)?.kind === 'handoff')).filter((id) => !seen.has(id));
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

  async recall(c: Caller, a: RecallArgs): Promise<Result> {
    return this.measure(() => {
      const now = Date.now();
      const stop = this.gate(c, now, 'read', a);
      if (stop) return stop;
      try {
        const project = this.project(a, now);
        const query = (a.query ?? '').trim();
        const queued = this.queued(project);
        let putBack = queued;
        if (a.dropped) {
          const dropped = this.pool(project).filter((i) => i.kind === 'dropped' && !i.held && !queued.some((q) => q.id === i.id));
          putBack = [...queued, ...(query ? rankItems(dropped, query, now).slice(0, 5).map((h) => h.item) : dropped.slice(0, 5))];
        }
        const res = this.memory({ project, reader: `g-${c.grant}`, grant: c.grant, agent: c.agent, query, first: !query, once: false, putBack, now });
        this.unqueue(res.delivered.filter((id) => queued.some((q) => q.id === id)));
        return { ok: true, text: res.text };
      } catch {
        return { ok: false, text: FAILED };
      }
    });
  }

  private write(c: Caller, now: number, kind: 'card' | 'handoff' | 'rule', project: string, body: CardBody | HandoffBody | RuleBody, source: Source, marks: string[], text: string): Result {
    const r = this.save(newItem(kind, project, body, this.origin(c, now, 'tool', source, `g-${c.grant}`)), now, true, (saved) => {
      for (const m of marks) this.limits.setMark(m, { id: saved.id, at: now, text });
    });
    return r.ok ? { ...r, text } : r;
  }

  async checkpoint(c: Caller, a: CheckpointArgs): Promise<Result> {
    return this.measure(() => {
      const now = Date.now();
      const stop = this.gate(c, now, 'write', a);
      if (stop) return stop;
      const project = this.project(a, now);
      const body: CardBody = compact({
        goal: 'x',
        changed: strings(a.changed)?.map((path) => ({ path })),
        decisions: strings(a.decisions)?.map((what) => ({ what })),
        commands: strings(a.commands),
        dead_ends: strings(a.dead_ends),
        open: strings(a.open),
      });
      body.goal = typeof a.goal === 'string' ? a.goal : '';
      const memo = this.remembered(c, 'card', project, body, a.key, now);
      if (memo.hit) return memo.hit;
      return this.write(c, now, 'card', project, body, 'agent', memo.marks, 'Checkpoint saved. Its open tasks are shown to the next agent at the start of its session.');
    });
  }

  async handoff(c: Caller, a: HandoffArgs): Promise<Result> {
    return this.measure(() => {
      const now = Date.now();
      const stop = this.gate(c, now, 'write', a);
      if (stop) return stop;
      const project = this.project(a, now);
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
      body.goal = typeof a.goal === 'string' ? a.goal : '';
      body.next = typeof a.next === 'string' ? a.next : '';
      const memo = this.remembered(c, 'handoff', project, body, a.key, now);
      if (memo.hit) return memo.hit;
      return this.write(c, now, 'handoff', project, body, 'agent', memo.marks, 'Handoff saved for the next agent.');
    });
  }

  private prompts(grant: string, now: number, fromStore: boolean): string[] {
    if (fromStore) {
      return this.store
        .q<{ text: string }>("SELECT e.text AS text FROM events e JOIN sessions s ON e.session = s.id WHERE s.grant_id = ? AND e.t = 'prompt' AND e.at >= ?", grant, now - DAY)
        .map((r) => r.text);
    }
    const out: string[] = [];
    for (const [sid, rows] of this.eventCache) {
      if (this.sessionCache.get(sid)?.grant_id !== grant) continue;
      for (const r of rows) if (r.t === 'prompt' && r.at >= now - DAY && r.text) out.push(r.text);
    }
    return out;
  }

  async rule(c: Caller, a: RuleArgs): Promise<Result> {
    return this.measure(() => {
      const now = Date.now();
      const stop = this.gate(c, now, 'write', a);
      if (stop) return stop;
      const scope = a.scope === 'project' ? 'project' : 'all';
      const named = (v: unknown) => typeof v === 'string' && v.trim() !== '';
      if (scope === 'project' && !named(a.repo) && !named(a.folder)) return { ok: false, text: SAY.where };
      const project = scope === 'all' ? '' : this.project(a, now);
      const memo = this.remembered(c, 'rule', project, [a.text, a.words, scope], a.key, now);
      if (memo.hit) return memo.hit;
      let words: string;
      try {
        words = cleanText(typeof a.words === 'string' ? a.words : '').text;
      } catch {
        return { ok: false, text: SAY.clean };
      }
      const today = new Date(now).toISOString().slice(0, 10);
      const activatedToday = this.rulesList().filter((r) => (r.body as RuleBody).proof === 'hook' && new Date(r.created).toISOString().slice(0, 10) === today).length;
      const input = { text: a.text, words, scope } as const;
      let d = decideRule(input, { via: 'tool', prompts: this.prompts(c.grant, now, false), activatedToday });
      if (d.status !== 'active') d = decideRule(input, { via: 'tool', prompts: this.prompts(c.grant, now, true), activatedToday });
      const body: RuleBody = compact({ text: 'x', words: 'x', scope, status: d.status, proof: d.proof });
      body.text = typeof a.text === 'string' ? a.text : '';
      body.words = words;
      return this.write(c, now, 'rule', project, body, d.status === 'active' ? 'person' : 'agent', memo.marks, d.reason);
    });
  }

  async event(c: Caller, a: EventArgs): Promise<Result> {
    return this.measure(() => {
      const now = Date.now();
      const name = val(a.event) ?? '';
      const host = val(a.host) ?? '';
      const asks = name === 'UserPromptSubmit' || name === 'SessionStart';
      const stop = this.gate(c, now, 'write', null);
      if (stop) return { ok: true, text: '' };
      try {
        return { ok: true, text: this.onEvent(c, a, name, host, now) };
      } catch {
        return { ok: true, text: asks ? hookOutput(host, name, FAILED) : '' };
      }
    });
  }

  private writeSession(s: Live, now: number): void {
    this.store.q('UPDATE sessions SET last = ?, model = ?, n = ?, primed = ? WHERE id = ?', s.last, s.model, s.n, s.primed, s.id);
    s.written = now;
  }

  private session(c: Caller, sid: string, a: EventArgs, now: number): Live {
    const raw = val(a.model);
    const model = raw ? cut(redact(raw), 80) : undefined;
    let s = this.sessionCache.get(sid);
    if (!s) {
      const row = this.store.q<SessionRow>('SELECT * FROM sessions WHERE id = ?', sid)[0];
      if (row) s = { ...row, n: row.n ?? 0, written: row.last, auto: {} };
    }
    if (s) {
      keep(this.sessionCache, sid, s, SESSIONS_KEPT);
      const changed = !!model && s.model !== model;
      if (changed) s.model = model ?? null;
      s.last = now;
      if (changed || now - s.written >= MINUTE) this.writeSession(s, now);
      this.limits.seen(sid, s.grant_id, now);
      return s;
    }
    const fresh: Live = { id: sid, agent: c.agent, model: model ?? null, project: this.project({ folder: val(a.cwd) }, now), start: now, last: now, primed: 0, grant_id: c.grant, n: 0, written: now, auto: {} };
    this.store.q('INSERT INTO sessions(id, agent, model, project, start, last, primed, grant_id, n) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)', fresh.id, fresh.agent, fresh.model, fresh.project, fresh.start, fresh.last, fresh.primed, fresh.grant_id, fresh.n);
    keep(this.sessionCache, sid, fresh, SESSIONS_KEPT);
    this.limits.seen(sid, c.grant, now);
    return fresh;
  }

  private addEvent(s: Live, t: EvType, now: number, raw: { text?: string; path?: string; ok?: boolean }): boolean {
    const text = raw.text !== undefined ? cleanText(raw.text) : undefined;
    const path = raw.path !== undefined ? cleanText(raw.path) : undefined;
    const flags = [...new Set([...(text?.flags ?? []), ...(path?.flags ?? [])])];
    const ev: Ev = compact({ t, at: now, text: text?.text, path: path?.text });
    const row: EventRow = { session: s.id, key: eventKey(s.id, ev), t, at: now, text: ev.text ?? null, path: ev.path ?? null, ok: raw.ok === undefined ? null : raw.ok ? 1 : 0, flags: flags.length ? JSON.stringify(flags) : null };
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
    if (!rows.length) return false;
    s.n++;
    this.eventCache.get(s.id)?.push(row);
    if (s.n > EVENTS_PER_SESSION) this.events(s, now);
    return true;
  }

  private onEvent(c: Caller, a: EventArgs, name: string, host: string, now: number): string {
    const sid = val(a.session);
    if (!sid) return '';
    const tool = val(a.tool);
    if (tool && OWN_TOOL.test(tool)) return '';
    const s = this.session(c, sid, a, now);
    const reader = `s-${sid}`;
    if (name === 'UserPromptSubmit') {
      const prompt = val(a.prompt);
      if (!prompt) return '';
      const stripped = stripOwn(stripPrivate(prompt));
      const first = !s.primed;
      const kept = stripped.length <= 800 ? stripped : cut(stripped, 300);
      if (stripped.trim().length < 15) {
        if (!first || !stripped.trim() || /^[/!#]/.test(stripped.trim())) return '';
      } else {
        if (!this.addEvent(s, 'prompt', now, { text: kept })) return '';
        if (quietPrompt(stripped)) return '';
      }
      const putBack = this.queued(s.project);
      const query = first ? undefined : cleanText(kept).text;
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
      if (file) this.addEvent(s, 'edit', now, { path: file });
      if (command) this.addEvent(s, 'command', now, { text: cut(command, 300), ok: name === 'PostToolUse' });
      return '';
    }
    if (name === 'Stop' || name === 'StopFailure') {
      const message = val(a.message);
      this.addEvent(s, 'stop', now, { text: message ? stripOwn(message) : '', ok: name === 'Stop' });
      this.rebuild(s, now, true);
      return '';
    }
    if (name === 'PostCompact') {
      const summary = val(a.summary);
      if (summary) this.addEvent(s, 'compact', now, { text: summary });
      this.dropped(s, now);
      return '';
    }
    if (name === 'SessionStart') {
      const source = val(a.source);
      if (source !== 'clear' && source !== 'compact') return '';
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
    if (old) {
      item.id = old.id;
      item.pinned = old.pinned;
      if (kind === 'card') item.created = old.created;
    }
    this.save(item, now, !old, (saved) => {
      if (old) return;
      s.auto[kind] = saved.id;
      this.store.setMeta(`auto-${kind}:${s.id}`, saved.id);
    });
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
    for (const { id } of this.store.q<{ id: string }>('SELECT id FROM sessions WHERE last < ?', old)) {
      this.store.q('DELETE FROM events WHERE session = ?', id);
      this.store.q('DELETE FROM sessions WHERE id = ?', id);
      this.store.dropDelivered(`s-${id}`);
      for (const k of [`auto-card:${id}`, `auto-handoff:${id}`, `dropped:${id}`]) this.store.dropMeta(k);
      this.sessionCache.delete(id);
      this.eventCache.delete(id);
      this.deliveredCache.delete(`s-${id}`);
    }
  }

  async me(): Promise<Me> {
    const now = Date.now();
    const t = this.limits.today(now);
    return { bytes: this.limits.bytes(), max: this.limits.max.storeBytes, callsToday: t.calls, storedToday: t.stored };
  }

  async space(): Promise<Space> {
    const counts = new Map(this.store.q<{ project: string; n: number }>('SELECT project, COUNT(*) AS n FROM items GROUP BY project').map((r) => [r.project, r.n]));
    const projects = this.store.q<{ key: string; name: string }>('SELECT key, name FROM projects ORDER BY created').map((p) => ({ key: p.key, name: p.name, items: counts.get(p.key) ?? 0 }));
    return {
      projects,
      agents: this.store.q<AgentRow>('SELECT * FROM agents ORDER BY first'),
      items: this.store.newest(SPACE_ITEMS),
      queue: this.store.q<{ item: string }>('SELECT item FROM queue ORDER BY at').map((r) => r.item),
      reads: this.readsList().slice(0, READS_KEPT),
      now: Date.now(),
    };
  }

  private change(id: string, fn: (i: Item) => Item | null): Item | null {
    const i = this.store.item(id);
    if (!i) return null;
    const next = fn(i);
    if (!next) return null;
    this.putItem(next);
    this.push({ type: 'item', item: next });
    return next;
  }

  async pin(id: string, on: boolean): Promise<Item | null> {
    return this.change(id, (i) => ({ ...i, pinned: !!on }));
  }

  async keep(id: string): Promise<Item | null> {
    return this.change(id, (i) => ({ ...i, held: false }));
  }

  async putBack(id: string): Promise<Item | null> {
    const i = this.store.item(id);
    if (!i || i.kind === 'rule') return null;
    this.store.q('INSERT INTO queue(item, at) VALUES(?, ?) ON CONFLICT(item) DO UPDATE SET at = excluded.at', id, Date.now());
    this.push({ type: 'item', item: i });
    return i;
  }

  async remove(id: string): Promise<boolean> {
    const item = this.store.item(id);
    if (!item) return false;
    const n = this.removeItem(item);
    const now = Date.now();
    this.limits.setBytes(this.limits.bytes() - n);
    this.limits.flush(now, true);
    this.push({ type: 'remove', id });
    return true;
  }

  async addRule(a: { text: string; scope: 'project' | 'all'; project?: string }): Promise<Result> {
    const now = Date.now();
    const text = typeof a.text === 'string' ? a.text.trim() : '';
    if (!text) return { ok: false, text: 'A rule needs text.' };
    if (text.length > 600) return { ok: false, text: SAY.size };
    const scope = a.scope === 'project' ? 'project' : 'all';
    const key = typeof a.project === 'string' ? a.project : '';
    if (scope === 'project' && !this.store.q('SELECT key FROM projects WHERE key = ?', key).length) return { ok: false, text: 'That project is not in this memory.' };
    const d = decideRule({ text, words: text, scope }, { via: 'page', prompts: [], activatedToday: 0 });
    const body: RuleBody = { text, words: text, scope, status: d.status, proof: d.proof };
    const origin: Origin = { agent: 'page', via: 'page', source: 'person', at: now };
    return this.save(newItem('rule', key, body, origin), now, true);
  }

  async setRule(id: string, status: 'active' | 'off'): Promise<Item | null> {
    if (status !== 'active' && status !== 'off') return null;
    return this.change(id, (i) => {
      if (i.kind !== 'rule') return null;
      const b = i.body as RuleBody;
      return { ...i, held: status === 'active' ? false : i.held, body: { ...b, status, proof: status === 'active' && b.status !== 'active' ? 'page' : b.proof } };
    });
  }

  async mergeProjects(from: string, into: string): Promise<boolean> {
    if (!from || !into || from === into) return false;
    const has = (k: string) => this.store.q('SELECT key FROM projects WHERE key = ?', k).length > 0;
    if (!has(from) || !has(into)) return false;
    this.ctx.storage.transactionSync(() => {
      this.store.q('UPDATE items SET project = ? WHERE project = ?', into, from);
      this.store.q('UPDATE paths SET key = ? WHERE key = ?', into, from);
      this.store.q('UPDATE aliases SET key = ? WHERE key = ?', into, from);
      this.store.q('UPDATE sessions SET project = ? WHERE project = ?', into, from);
      this.store.q('DELETE FROM projects WHERE key = ?', from);
    });
    this.pools.clear();
    this.rulesCache = null;
    this.nameCache = null;
    this.resolved.clear();
    this.projectKeys.clear();
    this.sessionCache.clear();
    this.push({ type: 'reset' });
    return true;
  }

  async exportAll(): Promise<Uint8Array> {
    return buildExport({
      items: this.store.all(),
      projects: this.store.q<{ key: string; name: string }>('SELECT key, name FROM projects ORDER BY created'),
      agents: this.store.q<AgentRow>('SELECT * FROM agents ORDER BY first'),
    });
  }

  async wipe(): Promise<void> {
    this.push({ type: 'reset' });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, 'reset');
      } catch {
        continue;
      }
    }
    await this.ctx.storage.deleteAll();
    this.store.init();
    this.forget();
    this.limits.reset();
  }

  async rowCount(): Promise<number> {
    let n = 0;
    for (const t of TABLES) n += this.store.count(t);
    return n;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response(null, { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send('pong');
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    if (code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code)) ws.close(code, reason);
    else ws.close();
  }
}
