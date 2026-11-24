import fs from 'node:fs';
import { claudeDir, ctxHome, store } from './core/paths.ts';
import { logError } from './core/fsx.ts';
import { releaseLock, tryLock } from './core/lock.ts';
import { applyJobs, claimPending, hasPending } from './core/update.ts';
import { WORKER_LIMIT_MS } from './core/limits.ts';
import { enforce, sweepLeftovers } from './core/budget.ts';

const limit = Number(process.env.CLAUDE_CTX_WORKER_LIMIT_MS) || WORKER_LIMIT_MS;
const st = store(ctxHome());
const trace = process.env.CLAUDE_CTX_TRACE ? st.trace : '';
let holding = false;

function note(what: string): void {
  if (!trace) return;
  try {
    fs.appendFileSync(trace, `${what} ${process.pid} ${Date.now()}\n`);
  } catch {}
}

function stop(code: number, why?: string): never {
  if (why) logError(st.log, 'worker', why);
  if (holding) {
    releaseLock(st.lock);
    holding = false;
    note('release');
  }
  note('exit');
  process.exit(code);
}

const killer = setTimeout(() => stop(0, `life limit of ${limit} ms reached`), limit);
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

async function main(): Promise<void> {
  note('start');
  for (let round = 0; round < 20; round++) {
    if (!tryLock(st.lock, limit + 5000)) break;
    holding = true;
    note('acquire');
    try {
      sweepLeftovers(st);
      for (;;) {
        const jobs = claimPending(st);
        if (!jobs.length) break;
        await applyJobs(st, claudeDir(), jobs);
      }
      enforce(st);
    } catch (e) {
      logError(st.log, 'worker', e);
    } finally {
      releaseLock(st.lock);
      holding = false;
      note('release');
    }
    if (!hasPending(st)) break;
  }
  clearTimeout(killer);
  stop(0);
}

main().catch((e) => stop(0, String(e)));
