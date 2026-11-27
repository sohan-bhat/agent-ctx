import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Engine, type Caller } from '../../service/src/engine.ts';
import { MAX, SAY, type Max } from '../../service/src/limits.ts';
import { Store, type Sql } from '../../service/src/store.ts';

const SCHEMA = 1;
const BUSY_MS = 5000;
const NEWER = 'This memory file has the format of a newer agent-ctx, so update agent-ctx to open the file.';

const STEPS: string[][] = [];
const STATEMENTS_KEPT = 200;
const LOCKED = 5;
const OTHER = 'another agent';
const SOURCE = 'npx -y github:sohan-bhat/agent-ctx';
const AT_PAGE = 'Rule saved as pending. The person turns the rule on with Accept at the agent-ctx page.';

export const PROGRAM = (globalThis as { Bun?: { isStandaloneExecutable?: boolean } }).Bun?.isStandaloneExecutable ? process.execPath : '';

export const CAPS: Max = { ...MAX, perMinute: 100000, perDay: 100000, storedPerDay: 5000, storeBytes: 100 * 1024 * 1024 };

const WORDS: [string, string][] = [
  [SAY.day, 'The limit of 100,000 calls for today is reached. Calls are accepted again tomorrow.'],
  [SAY.stored, '5,000 items were stored on this computer today. More can be stored tomorrow.'],
  [SAY.agents, 'This computer already has 20 connected agents.'],
  [SAY.full, 'The memory on this computer is full at 100 MB, so nothing new is stored.'],
  [SAY.projects, 'This computer already has 200 projects with saved items.'],
];

type Value = string | number | null;

export class Refusal extends Error {}

export function folder(): string {
  return process.env.AGENT_CTX_HOME || join(homedir(), '.agent-ctx');
}

export function file(): string {
  return join(folder(), 'memory.db');
}

export function quote(text: string): string {
  return /^[\w\-./:=@%+,\\]+$/.test(text) ? text : JSON.stringify(text);
}

export function typed(): string {
  const app = join(folder(), 'app');
  if (PROGRAM) return quote(existsSync(join(app, 'agent-ctx')) ? join(app, 'agent-ctx') : PROGRAM);
  const started = process.argv[1] ?? '';
  if (basename(started) === 'agent-ctx' && !started.includes('_npx')) return 'agent-ctx';
  return existsSync(join(app, 'agent-ctx.mjs')) ? `node ${quote(join(app, 'agent-ctx.mjs'))}` : SOURCE;
}

function sqlite(): typeof import('node:sqlite') {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (text.includes('SQLite is an experimental feature')) return;
    (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  } finally {
    process.emitWarning = emit;
  }
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function locked(e: unknown): boolean {
  return (e as { errcode?: number } | null)?.errcode === LOCKED;
}

export class Db implements Sql {
  private db: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  private depth = 0;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  exec(query: string, ...args: Value[]): { toArray(): unknown[]; rowsRead: number; rowsWritten: number } {
    let statement = this.statements.get(query);
    if (!statement) {
      if (this.statements.size >= STATEMENTS_KEPT) this.statements.clear();
      statement = this.db.prepare(query);
      this.statements.set(query, statement);
    }
    const rows = statement.all(...args);
    return { toArray: () => rows, rowsRead: 0, rowsWritten: 0 };
  }

  transactionSync(fn: () => void): void {
    const name = `step${this.depth}`;
    this.db.exec(this.depth ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
    this.depth++;
    try {
      fn();
    } catch (e) {
      this.depth--;
      this.db.exec(this.depth ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK');
      throw e;
    }
    this.depth--;
    this.db.exec(this.depth ? `RELEASE ${name}` : 'COMMIT');
  }

  within<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      this.depth = 1;
      try {
        const out = await fn();
        this.db.exec('COMMIT');
        return out;
      } catch (e) {
        if (this.db.isTransaction) this.db.exec('ROLLBACK');
        throw e;
      } finally {
        this.depth = 0;
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  changes(): number {
    return Number((this.exec('PRAGMA data_version').toArray()[0] as { data_version: number }).data_version);
  }

  async sync(): Promise<void> {}

  async deleteAll(): Promise<void> {
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const t of tables) this.db.exec(`DROP TABLE "${t.name.replaceAll('"', '""')}"`);
    this.statements.clear();
  }

  migrate(): void {
    this.transactionSync(() => {
      const at = Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
      if (at > SCHEMA) throw new Refusal(NEWER);
      for (let v = Math.max(at, 1); v < SCHEMA; v++) for (const step of STEPS[v - 1]) this.db.exec(step);
      new Store(this).init();
      if (at !== SCHEMA) this.db.exec(`PRAGMA user_version = ${SCHEMA}`);
    });
    this.statements.clear();
  }

  patience(ms: number): void {
    this.db.exec(`PRAGMA busy_timeout = ${Math.max(1, Math.floor(ms))}`);
  }

  wal(): boolean {
    return (this.db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: string }).journal_mode === 'wal';
  }

  close(): void {
    this.statements.clear();
    if (this.db.isOpen) this.db.close();
  }
}

export function open(wait = BUSY_MS): Db {
  const dir = folder();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'memory.db');
  if (!existsSync(path)) closeSync(openSync(path, 'a', 0o600));
  const { DatabaseSync } = sqlite();
  const until = Date.now() + wait;
  for (;;) {
    const db = new Db(new DatabaseSync(path, { timeout: Math.max(1, until - Date.now()) }));
    try {
      db.migrate();
      if (db.wal()) {
        db.patience(wait);
        return db;
      }
    } catch (e) {
      db.close();
      if (!locked(e) || Date.now() > until) throw e;
    }
    db.close();
    if (Date.now() > until) throw new Error('locked');
    pause(25);
  }
}

export function local(text: string): string {
  let out = text;
  for (const [from, to] of WORDS) if (out.includes(from)) out = out.split(from).join(to);
  return out.includes(AT_PAGE) ? out.split(AT_PAGE).join(`Rule saved as pending. The person turns the rule on in a terminal with ${typed()} rules.`) : out;
}

export function who(name: string | undefined): Caller {
  const clean = (name ?? '').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ._-]+/gu, '').replace(/ +/g, ' ').trim().slice(0, 40).trim();
  return { agent: clean || OTHER, grant: clean || OTHER, scopes: ['read', 'write'] };
}

export type Call = <T>(fn: (engine: Engine) => Promise<T>) => Promise<T>;

export function caller(db: Db): Call {
  let engine: Engine | null = null;
  let seen = -1;
  return <T>(fn: (engine: Engine) => Promise<T>) =>
    db
      .within(async () => {
        const changes = db.changes();
        if (!engine || changes !== seen) {
          engine = new Engine(db, () => Date.now(), CAPS);
          engine.limits.reserve = 0;
          engine.tracked = true;
          seen = changes;
        }
        const out = await fn(engine);
        engine.limits.flush(Date.now(), true);
        const text = (out as { text?: unknown } | null)?.text;
        return typeof text === 'string' ? ({ ...out, text: local(text) } as T) : out;
      })
      .catch((e: unknown) => {
        engine = null;
        throw e;
      });
}
