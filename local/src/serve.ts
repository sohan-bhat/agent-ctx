import { randomBytes } from 'node:crypto';
import { createServer, type Memory, type Reach } from '../../service/src/mcp.ts';
import { createRequestStateCodec, serveStdio } from '../../service/src/stdio.ts';
import { caller, open, who as named } from './db.ts';

declare const VERSION: string;

export function serve(name: string | undefined): void {
  const db = open();
  process.on('exit', () => db.close());
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => process.exit(0));
  const who = named(name);
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
  serveStdio(() => createServer(reach, VERSION));
}
