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
import { Store, TABLES, type AgentRow, type EventRow, type SessionRow } from './store.ts';
import { Limits, SAY } from './limits.ts';

export interface Caller { agent: string; grant: string; scopes: string[] }
export interface Result { ok: boolean; text: string; item?: Item }
export interface Where { repo?: string; folder?: string }
export interface RecallArgs extends Where { query?: string; dropped?: boolean }
export interface CheckpointArgs extends Where { goal: string; changed?: string[]; decisions?: string[]; commands?: string[]; dead_ends?: string[]; open?: string[]; key?: string }
export interface HandoffArgs extends Where { goal: string; done?: string; next: string; blockers?: string[]; files?: string[]; check?: string; question?: string; task?: string; key?: string }
export interface RuleArgs extends Where { text: string; words: string; scope: 'project' | 'all'; key?: string }
export interface EventArgs { host?: string; event?: string; session?: string; cwd?: string; prompt?: string; tool?: string; file?: string; command?: string; message?: string; summary?: string; reason?: string; source?: string; model?: string }
export interface Space { projects: { key: string; name: string; items: number }[]; agents: AgentRow[]; items: Item[]; queue: string[]; now: number }
export interface Me { bytes: number; max: number; callsToday: number; storedToday: number }

const MINUTE = 60000;
const HOUR = 3600000;
const DAY = 86400000;
const LIVE = 3 * MINUTE;
const SAME_GRANT_WAIT = 20 * MINUTE;
const KEEP_EVENTS = 14 * DAY;
const EVENTS_PER_SESSION = 400;
const POOL = 400;
const SPACE_ITEMS = 1500;
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

export class Person extends DurableObject<Env> {
  store: Store;
  limits: Limits;
  lastRows = { read: 0, written: 0 };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new Store(ctx.storage.sql);
    this.limits = new Limits(this.store);
    ctx.blockConcurrencyWhile(async () => this.store.init());
  }

  private measure<T>(fn: () => T): T {
    const before = this.store.counts();
    try {
      return fn();
    } finally {
      const after = this.store.counts();
      this.lastRows = { read: after.read - before.read, written: after.written - before.written };
    }
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
    if (input !== null && JSON.stringify(input ?? null).length > this.limits.max.inputBytes) return { ok: false, text: SAY.size };
    return this.touchAgent(c.agent, now);
  }

  private touchAgent(label: string, now: number): Result | null {
    const row = this.store.q<AgentRow>('SELECT * FROM agents WHERE id = ?', label)[0];
    if (row) {
      if (now - row.last > MINUTE) this.store.q('UPDATE agents SET last = ? WHERE id = ?', now, label);
      return null;
    }
    const n = this.store.q<{ n: number }>('SELECT COUNT(*) AS n FROM agents')[0]?.n ?? 0;
    if (n >= this.limits.max.agents) return { ok: false, text: SAY.agents };
    const agent: AgentRow = { id: label, label, first: now, last: now };
    this.store.q('INSERT INTO agents(id, label, first, last) VALUES(?, ?, ?, ?)', agent.id, agent.label, agent.first, agent.last);
    this.push({ type: 'agent', agent });
    return null;
  }

  private project(w: Where, now: number): string {
    const folder = (w.folder ?? '').trim();
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
    const r = resolveProject({ repo: w.repo, folder }, known);
    if (r.learn?.path && known.paths[r.learn.path] !== r.key) this.store.q('INSERT INTO paths(path, key) VALUES(?, ?) ON CONFLICT(path) DO UPDATE SET key = excluded.key', r.learn.path, r.key);
    if (r.learn?.alias && known.aliases[r.learn.alias] !== r.key) this.store.q('INSERT INTO aliases(alias, key) VALUES(?, ?) ON CONFLICT(alias) DO UPDATE SET key = excluded.key', r.learn.alias, r.key);
    this.store.q('INSERT INTO projects(key, name, created) VALUES(?, ?, ?) ON CONFLICT(key) DO NOTHING', r.key, projectName(r.key), now);
    return r.key;
  }

  private origin(c: Caller, now: number, via: Via, source: Source, session?: string, model?: string): Origin {
    return compact({ agent: c.agent, model, session, via, source, at: now }) as Origin;
  }

  private save(item: Item, now: number, counted: boolean): Result {
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
    let total = this.store.totalBytes();
    const last = this.store.meta<number>('folded', -1);
    if (total - this.store.bytesOf(clean.id) + size > FOLD_AT * limit && total > last + 0.02 * limit) total = this.fold(now);
    const prev = this.store.bytesOf(clean.id);
    if (total - prev + size > limit) {
      this.limits.refuse(SAY.full, now);
      return { ok: false, text: SAY.full };
    }
    this.store.put(clean);
    this.store.setTotal(total - prev + size);
    if (counted) this.limits.stored(now);
    if (this.limits.paused(now)) this.limits.clear();
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
      this.store.setTotal(total);
      this.store.setMeta('folded', total);
    });
    this.push({ type: 'reset' });
    return total;
  }

  private remembered(c: Caller, kind: string, project: string, body: unknown, key: string | undefined, now: number): { hit?: Result; marks: string[] } {
    const marks: string[] = [];
    if (typeof key === 'string' && key) marks.push(`key:${c.grant}:${hash(key)}`);
    marks.push(`body:${c.grant}:${hash(JSON.stringify([kind, project, body]))}`);
    for (const m of marks) {
      const seen = this.store.meta<{ id: string; at: number; text: string } | null>(m, null);
      const ttl = m.startsWith('key:') ? DAY : 10 * MINUTE;
      if (seen && now - seen.at < ttl) {
        const item = this.store.item(seen.id);
        if (item) return { hit: { ok: true, text: seen.text, item }, marks };
      }
    }
    return { marks };
  }

  private remember(marks: string[], r: Result, now: number): void {
    if (!r.ok || !r.item) return;
    for (const m of marks) this.store.setMeta(m, { id: r.item.id, at: now, text: r.text });
  }

  private liveSessions(now: number): SessionRow[] {
    return this.store.q<SessionRow>('SELECT * FROM sessions WHERE last >= ?', now - LIVE);
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

  private memory(o: { project: string; reader: string; grant: string; query?: string; first: boolean; once: boolean; putBack: Item[]; rulesOnly?: boolean; now: number }): { text: string; delivered: string[] } {
    const query = (o.query ?? '').trim();
    const rules = this.store.rules();
    let items: Item[] = o.rulesOnly ? [] : this.store.projectItems(o.project, POOL);
    let projects: { key: string; names: string[] }[] = [];
    if (query && !o.rulesOnly) {
      const names = new Map<string, string[]>();
      for (const p of this.store.q<{ key: string; name: string }>('SELECT key, name FROM projects')) names.set(p.key, [p.name]);
      for (const a of this.store.q<{ alias: string; key: string }>('SELECT alias, key FROM aliases')) names.get(a.key)?.push(a.alias);
      projects = [...names.entries()].map(([key, n]) => ({ key, names: [...new Set(n.filter(Boolean))] }));
      for (const key of namedProjects(query, projects, o.project)) items = items.concat(this.store.projectItems(key, POOL));
    }
    const live = this.liveSessions(o.now);
    const liveOfGrant = new Set(live.filter((s) => s.grant_id === o.grant).map((s) => `s-${s.id}`));
    const seen = this.store.q<{ item: string }>('SELECT item FROM seen WHERE reader = ?', o.reader).map((r) => r.item);
    const byId = new Map<string, Item>();
    for (const i of [...items, ...rules]) byId.set(i.id, i);
    const pool = [...byId.values()].filter((i) => i.kind !== 'handoff' || this.offer(i, o.reader, o.grant, o.now, liveOfGrant));
    const res = recall({
      project: o.project,
      items: pool,
      projects,
      query,
      first: o.first,
      seen,
      putBack: o.putBack,
      now: o.now,
      live: live.map((s) => `s-${s.id}`).filter((s) => s !== o.reader),
      once: o.once,
    });
    const record = o.once ? res.delivered : res.delivered.filter((id) => byId.get(id)?.kind === 'handoff');
    for (const id of record) this.store.q('INSERT INTO seen(reader, item) VALUES(?, ?) ON CONFLICT DO NOTHING', o.reader, id);
    return res;
  }

  async recall(c: Caller, a: RecallArgs): Promise<Result> {
    return this.measure(() => {
      const now = Date.now();
      const stop = this.gate(c, now, 'read', a);
      if (stop) return stop;
      try {
        const project = this.project(a, now);
        const query = (a.query ?? '').trim();
        let putBack: Item[] = [];
        if (a.dropped) {
          const dropped = this.store.projectItems(project, POOL).filter((i) => i.kind === 'dropped' && !i.held);
          putBack = query ? rankItems(dropped, query, now).slice(0, 5).map((h) => h.item) : dropped.slice(0, 5);
        }
        const res = this.memory({ project, reader: `g-${c.grant}`, grant: c.grant, query, first: !query, once: false, putBack, now });
        return { ok: true, text: res.text };
      } catch {
        return { ok: false, text: FAILED };
      }
    });
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
      const r = this.save(newItem('card', project, body, this.origin(c, now, 'tool', 'agent', `g-${c.grant}`)), now, true);
      const out = r.ok ? { ...r, text: 'Checkpoint saved. Its open tasks are shown to the next agent at the start of its session.' } : r;
      this.remember(memo.marks, out, now);
      return out;
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
      const r = this.save(newItem('handoff', project, body, this.origin(c, now, 'tool', 'agent', `g-${c.grant}`)), now, true);
      const out = r.ok ? { ...r, text: 'Handoff saved for the next agent.' } : r;
      this.remember(memo.marks, out, now);
      return out;
    });
  }

  async rule(c: Caller, a: RuleArgs): Promise<Result> {
    return this.measure(() => {
      const now = Date.now();
      const stop = this.gate(c, now, 'write', a);
      if (stop) return stop;
      const project = this.project(a, now);
      const scope = a.scope === 'project' ? 'project' : 'all';
      const memo = this.remembered(c, 'rule', project, [a.text, a.words, scope], a.key, now);
      if (memo.hit) return memo.hit;
      let words: string;
      try {
        words = cleanText(typeof a.words === 'string' ? a.words : '').text;
      } catch {
        return { ok: false, text: SAY.clean };
      }
      const prompts = this.store
        .q<{ text: string }>("SELECT e.text AS text FROM events e JOIN sessions s ON e.session = s.id WHERE s.grant_id = ? AND e.t = 'prompt' AND e.at >= ?", c.grant, now - DAY)
        .map((r) => r.text);
      const today = new Date(now).toISOString().slice(0, 10);
      const activatedToday = this.store.rules().filter((r) => (r.body as RuleBody).proof === 'hook' && new Date(r.created).toISOString().slice(0, 10) === today).length;
      const d = decideRule({ text: a.text, words, scope }, { via: 'tool', prompts, activatedToday });
      const body: RuleBody = compact({ text: 'x', words: 'x', scope, status: d.status, proof: d.proof });
      body.text = typeof a.text === 'string' ? a.text : '';
      body.words = words;
      const r = this.save(newItem('rule', project, body, this.origin(c, now, 'tool', d.status === 'active' ? 'person' : 'agent', `g-${c.grant}`)), now, true);
      const out = r.ok ? { ...r, text: d.reason } : r;
      this.remember(memo.marks, out, now);
      return out;
    });
  }
}
