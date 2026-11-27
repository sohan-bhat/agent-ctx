import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { Store, type Sql } from '../../service/src/store.ts';

const SCHEMA = 1;
const BUSY_MS = 5000;
const NEWER = 'This memory file has the format of a newer agent-ctx, so update agent-ctx to open the file.';

const STEPS: string[][] = [];
const STATEMENTS_KEPT = 200;
const LOCKED = 5;

type Value = string | number | null;

export class Refusal extends Error {}

function folder(): string {
  return process.env.AGENT_CTX_HOME || join(homedir(), '.agent-ctx');
}

export function file(): string {
  return join(folder(), 'memory.db');
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

  wal(): boolean {
    return (this.db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: string }).journal_mode === 'wal';
  }

  close(): void {
    this.statements.clear();
    if (this.db.isOpen) this.db.close();
  }
}

export function open(): Db {
  const dir = folder();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'memory.db');
  if (!existsSync(path)) closeSync(openSync(path, 'a', 0o600));
  const { DatabaseSync } = sqlite();
  const until = Date.now() + BUSY_MS;
  for (;;) {
    const db = new Db(new DatabaseSync(path, { timeout: BUSY_MS }));
    try {
      db.migrate();
      if (db.wal()) return db;
    } catch (e) {
      db.close();
      if (!locked(e) || Date.now() > until) throw e;
    }
    db.close();
    if (Date.now() > until) throw new Error('locked');
    pause(25);
  }
}
