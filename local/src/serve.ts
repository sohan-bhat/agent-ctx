import { randomBytes } from 'node:crypto';
import { Engine, type Caller } from '../../service/src/engine.ts';
import { MAX, type Max } from '../../service/src/limits.ts';
import { createServer, type Memory, type Reach } from '../../service/src/mcp.ts';
import { createRequestStateCodec, serveStdio } from '../../service/src/stdio.ts';
import { open, type Db } from './db.ts';

const CAPS: Max = { ...MAX, perMinute: MAX.perDay };
const OTHER = 'another agent';

function label(name: string | undefined): string {
  const clean = (name ?? '').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ._-]+/gu, '').replace(/ +/g, ' ').trim().slice(0, 40).trim();
  return clean || OTHER;
}

function caller(db: Db): <T>(fn: (engine: Engine) => Promise<T>) => Promise<T> {
  let engine: Engine | null = null;
  let seen = -1;
  return (fn) =>
    db
      .within(async () => {
        const changes = db.changes();
        if (!engine || changes !== seen) {
          engine = new Engine(db, () => Date.now(), CAPS);
          engine.limits.reserve = 0;
          seen = changes;
        }
        const out = await fn(engine);
        engine.limits.flush(Date.now(), true);
        return out;
      })
      .catch((e: unknown) => {
        engine = null;
        throw e;
      });
}

export function serve(name: string | undefined): void {
  const db = open();
  process.on('exit', () => db.close());
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => process.exit(0));
  const who: Caller = { agent: label(name), grant: label(name), scopes: ['read', 'write'] };
  const call = caller(db);
  const memory: Memory = {
    recall: (c, a, tool) => call((e) => e.recall(c, a, tool)),
    checkpoint: (c, a) => call((e) => e.checkpoint(c, a)),
    handoff: (c, a) => call((e) => e.handoff(c, a)),
    ruleDraft: (c, a) => call((e) => e.ruleDraft(c, a)),
    rule: (c, a, seen) => call((e) => e.rule(c, a, seen)),
    event: (c, a) => call((e) => e.event(c, a)),
  };
  const codec = createRequestStateCodec<string>({ key: randomBytes(32), ttlSeconds: 600 });
  const reach: Reach = { caller: () => ({ who, memory: () => memory }), state: () => codec };
  serveStdio(() => createServer(reach));
}
