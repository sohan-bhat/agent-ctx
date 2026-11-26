import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { newItem } from '../../core/src/index.ts';
import type { Caller, Person } from '../src/person.ts';
import { caller, open, person } from './helpers.ts';

type Kind = 'recall first' | 'recall query' | 'event prompt' | 'checkpoint' | 'handoff' | 'rule' | 'event edit' | 'event command' | 'event stop';
const MIX: [Kind, number][] = [
  ['recall first', 10],
  ['recall query', 25],
  ['event prompt', 25],
  ['checkpoint', 12],
  ['handoff', 4],
  ['rule', 2],
  ['event edit', 12],
  ['event command', 4],
  ['event stop', 6],
];
const TOPICS = ['barcode scanner', 'expiry reminders', 'shopping list', 'shelf labels', 'recipe import', 'stock counts', 'meal planner', 'price tracker'];
const AGENTS: Caller[] = [caller('Codex', 'grant-day-0'), caller('Claude Code', 'grant-day-1'), caller('Cursor', 'grant-day-2')];
const SEED_PER_PROJECT = 600;
const SITTINGS = 10;

function rng(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) % n;
  };
}

function where(p: number) {
  return { repo: `https://github.com/acme/app${p}`, folder: `/work/app${p}` };
}

async function seed(stub: DurableObjectStub<Person>): Promise<void> {
  await runInDurableObject(stub, (x: Person) => {
    const start = Date.now() - 300 * 86400000;
    for (let p = 0; p < 3; p++) {
      for (let i = 0; i < SEED_PER_PROJECT; i++) {
        const t = TOPICS[(i + p) % TOPICS.length];
        const at = start + (p * SEED_PER_PROJECT + i) * 14000000;
        const kind = i % 10 === 9 ? 'handoff' : 'card';
        const body = kind === 'card' ? { goal: `Worked on the ${t} part ${i}`, decisions: [{ what: `keep the ${t} small because part ${i} was slow` }], open: [`finish ${t} ${i}`] } : { goal: `Ship the ${t}`, next: `Wire the ${t} part ${i}` };
        x.store.put(newItem(kind, `github.com/acme/app${p}`, body, { agent: AGENTS[i % 3].agent, session: `s-old-${p}-${i % 7}`, via: 'hook', source: 'agent', at }));
      }
    }
  });
}

async function call(stub: DurableObjectStub<Person>, kind: Kind, i: number, a: number, p: number): Promise<void> {
  const c = AGENTS[a];
  const w = where(p);
  const topic = TOPICS[i % TOPICS.length];
  const hook = (event: string, more: Record<string, string>) => stub.event(c, { host: a === 1 ? 'claude-code' : 'codex', event, session: `day-${a}-${p}`, cwd: w.folder, ...more });
  if (kind === 'recall first') await stub.recall(c, w);
  else if (kind === 'recall query') await stub.recall(c, { ...w, query: `${topic} part decisions` });
  else if (kind === 'event prompt') await hook('UserPromptSubmit', { prompt: `please look at the ${topic} work again, step ${i}` });
  else if (kind === 'checkpoint') await stub.checkpoint(c, { ...w, goal: `Finished the ${topic} step ${i}`, decisions: [`keep ${topic} simple`], open: [`test ${topic} ${i}`], changed: [`src/${i}.ts`] });
  else if (kind === 'handoff') await stub.handoff(c, { ...w, goal: `Ship the ${topic}`, next: `Wire the ${topic} step ${i}`, files: [`src/${i}.ts`] });
  else if (kind === 'rule') await stub.rule(c, { ...w, text: `Notes for the ${topic}`, words: `please look at the ${topic} work again`, scope: 'project' });
  else if (kind === 'event edit') await hook('PostToolUse', { tool: 'Edit', file: `src/${topic.replace(/ /g, '-')}-${i}.ts` });
  else if (kind === 'event command') await hook('PostToolUseFailure', { tool: 'Bash', command: `npm test -- ${i}` });
  else await hook('Stop', { message: `Done with the ${topic} step ${i}.` });
}

it('a base person a year in, in ten sittings that each start cold, stays under 300 rows written and 6,000 rows read a day', async () => {
  const stub = person('day');
  await seed(stub);
  await evictDurableObject(stub);
  await open(stub);
  const r = rng(424242);
  const ops = MIX.flatMap(([kind, n]) => Array.from({ length: n }, () => ({ kind, a: 0, p: 0 })));
  for (let i = ops.length - 1; i > 0; i--) {
    const j = r(i + 1);
    [ops[i], ops[j]] = [ops[j], ops[i]];
  }
  const per_sitting = ops.length / SITTINGS;
  ops.forEach((op, i) => {
    const k = Math.floor(i / per_sitting);
    op.a = k % 3;
    op.p = (k * 2 + Math.floor(k / 3)) % 3;
  });
  const per = new Map<Kind, { read: number; written: number; n: number }>();
  let read = 0;
  let written = 0;
  let boots = 0;
  let instance = '';
  for (let i = 0; i < ops.length; i++) {
    if (i > 0 && i % per_sitting === 0) {
      await evictDurableObject(stub);
      await open(stub);
    }
    const op = ops[i];
    await call(stub, op.kind, i, op.a, op.p);
    const got = await runInDurableObject(stub, (x: Person) => ({ last: x.lastRows, boot: x.bootRows, id: x.instance }));
    if (got.id !== instance) {
      instance = got.id;
      boots++;
      read += got.boot.read;
      written += got.boot.written;
    }
    read += got.last.read;
    written += got.last.written;
    const k = per.get(op.kind) ?? { read: 0, written: 0, n: 0 };
    k.read += got.last.read;
    k.written += got.last.written;
    k.n++;
    per.set(op.kind, k);
  }
  const kinds = Object.fromEntries([...per].map(([k, v]) => [k, { read: Math.round((v.read / v.n) * 10) / 10, written: Math.round((v.written / v.n) * 10) / 10 }]));
  console.log(`DAY ${JSON.stringify({ calls: ops.length, boots, read, written, kinds })}`);
  expect(written).toBeLessThanOrEqual(300);
  expect(read).toBeLessThanOrEqual(6000);
});
