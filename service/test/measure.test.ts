import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Person } from '../src/person.ts';
import { caller, open, person } from './helpers.ts';

const A = caller('Codex', 'grant-m');
const W = { repo: 'https://github.com/acme/pantry', folder: '/work/pantry' };
const TOPICS = ['barcode scanner', 'expiry reminders', 'shopping list export', 'shelf labels', 'recipe import', 'stock counts', 'meal planner', 'price tracker'];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

async function rows(stub: DurableObjectStub<Person>): Promise<{ read: number; written: number }> {
  return runInDurableObject(stub, (p: Person) => p.lastRows);
}

describe('measured numbers', () => {
  it('rows per call and local recall time on a person with 400 items', async () => {
    const stub = person('measure');
    await open(stub);
    await runInDurableObject(stub, async (p: Person) => {
      for (let i = 0; i < 400; i++) {
        const t = TOPICS[i % TOPICS.length];
        await p.checkpoint(A, { ...W, goal: `Work on the ${t} part ${i}`, decisions: [`keep ${t} simple because step ${i} was slow`], open: [`finish ${t} ${i}`], changed: [`src/${t.replace(/ /g, '-')}/${i}.ts`] });
      }
    });
    const out: Record<string, { read: number; written: number }> = {};
    const measure = async (name: string, n: number, fn: (i: number) => Promise<unknown>) => {
      const r: number[] = [];
      const w: number[] = [];
      for (let i = 0; i < n; i++) {
        await fn(i);
        const x = await rows(stub);
        r.push(x.read);
        w.push(x.written);
      }
      out[name] = { read: median(r), written: median(w) };
    };
    await measure('recall without query', 100, () => stub.recall(A, W));
    await measure('recall with query', 100, (i) => stub.recall(A, { ...W, query: `${TOPICS[i % TOPICS.length]} decisions` }));
    await measure('checkpoint', 100, (i) => stub.checkpoint(A, { ...W, goal: `Measured card ${i}`, open: [`task ${i}`] }));
    await measure('event edit', 100, (i) => stub.event(A, { host: 'claude-code', event: 'PostToolUse', session: 'm-1', cwd: W.folder, tool: 'Edit', file: `src/file-${i}.ts` }));
    await measure('event prompt', 100, (i) => stub.event(A, { host: 'claude-code', event: 'UserPromptSubmit', session: `m-p-${i % 10}`, cwd: W.folder, prompt: `look at the ${TOPICS[i % TOPICS.length]} work again ${i}` }));
    await measure('event stop', 100, (i) => stub.event(A, { host: 'claude-code', event: 'Stop', session: 'm-1', cwd: W.folder, message: `Finished step ${i}` }));
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      await stub.recall(A, i % 2 ? W : { ...W, query: `${TOPICS[i % TOPICS.length]} work` });
      times.push(performance.now() - t0);
    }
    console.log(`MEASURE rows ${JSON.stringify(out)}`);
    console.log(`MEASURE local recall ms median ${median(times).toFixed(2)} p95 ${p95(times).toFixed(2)} over 200 calls`);
    expect(out.checkpoint.written).toBeGreaterThan(0);
    expect(out['recall without query'].read).toBeGreaterThan(0);
  });
});
