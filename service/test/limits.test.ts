import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Caller, Person } from '../src/person.ts';
import { MAX, RESERVE, SAY } from '../src/limits.ts';
import { awayFromMinuteEdge, caller, KILN, open, person, sql } from './helpers.ts';
import { env } from 'cloudflare:workers';
import { type Item, newItem } from '../../core/src/index.ts';

{
  const A = caller('Codex', 'grant-a');
  const TEN_MB = 10 * 1024 * 1024;

  function filler(i: number, size: number): string {
    const words = ['ramp', 'glaze', 'cone', 'kiln', 'hold', 'vent', 'shelf', 'bisque', 'slip', 'wedge'];
    let s = `card ${i}`;
    let k = i;
    while (s.length < size) {
      k = (k * 1103515245 + 12345) % 2147483648;
      s += ` ${words[k % words.length]}`;
    }
    return s.slice(0, size);
  }

  async function count(stub: DurableObjectStub<Person>): Promise<number> {
    return (await sql<{ n: number }>(stub, 'SELECT COUNT(*) AS n FROM items'))[0].n;
  }

  describe('limits', () => {
    it('the 61st call in a minute gets the plain sentence and stores nothing', async () => {
      const p = person();
      await awayFromMinuteEdge();
      for (let i = 0; i < MAX.perMinute; i++) expect((await p.recall(A, KILN)).ok).toBe(true);
      expect(await p.recall(A, KILN)).toEqual({ ok: false, text: SAY.minute });
      expect(await p.checkpoint(A, { ...KILN, goal: 'one more' })).toEqual({ ok: false, text: SAY.minute });
      expect(await count(p)).toBe(0);
    });

    it('the 501st stored item in a day gets the plain sentence', async () => {
      const p = person();
      await open(p, { storedPerDay: MAX.storedPerDay });
      for (let i = 0; i < MAX.storedPerDay; i++) expect((await p.checkpoint(A, { ...KILN, goal: `card ${i}` })).ok).toBe(true);
      expect(await p.checkpoint(A, { ...KILN, goal: 'card 500' })).toEqual({ ok: false, text: SAY.stored });
      expect(await count(p)).toBe(MAX.storedPerDay);
    });

    it('a 50 KB checkpoint gets the plain sentence and stores nothing', async () => {
      const p = person();
      expect(await p.checkpoint(A, { ...KILN, goal: filler(1, 50 * 1024) })).toEqual({ ok: false, text: SAY.size });
      expect(await count(p)).toBe(0);
    });

    it('a 6 KB checkpoint is fitted to 2 KB', async () => {
      const p = person();
      const r = await p.checkpoint(A, { ...KILN, goal: 'Fit me', open: Array.from({ length: 30 }, (_, i) => filler(i, 200)) });
      expect(r.ok).toBe(true);
      const bytes = (await sql<{ bytes: number }>(p, 'SELECT bytes FROM items'))[0].bytes;
      expect(bytes).toBeLessThanOrEqual(2048);
    });

    it('the 21st agent gets the plain sentence', async () => {
      const p = person();
      for (let i = 0; i < MAX.agents; i++) expect((await p.recall(caller(`Agent ${i}`, `g-${i}`), KILN)).ok).toBe(true);
      expect(await p.recall(caller('Agent 20', 'g-20'), KILN)).toEqual({ ok: false, text: SAY.agents });
    });

    it('a store pushed past 10 MB with pinned items is refused and stays under 10 MB', async () => {
      const p = person();
      const out = await runInDurableObject(p, async (x: Person) => {
        x.limits.max = { ...x.limits.max, perMinute: 1e9, perDay: 1e9, storedPerDay: 1e9 };
        let last = '';
        for (let i = 0; i < 8000; i++) {
          const r = await x.checkpoint(A, { ...KILN, goal: filler(i, 1950) });
          if (!r.ok) {
            last = r.text;
            break;
          }
          x.store.put({ ...r.item!, pinned: true });
          if (x.limits.bytes() > TEN_MB) return { last: 'over', total: x.limits.bytes(), sum: x.store.sumBytes() };
        }
        return { last, total: x.limits.bytes(), sum: x.store.sumBytes() };
      });
      expect(out.last).toBe(SAY.full);
      expect(out.total).toBe(out.sum);
      expect(out.sum).toBeLessThanOrEqual(TEN_MB);
      expect(out.sum).toBeGreaterThan(TEN_MB - 4096);
    });

    it('30 MB of checkpoints never leave more than 10 MB stored at any step', async () => {
      const p = person();
      const out = await runInDurableObject(p, async (x: Person) => {
        x.limits.max = { ...x.limits.max, perMinute: 1e9, perDay: 1e9, storedPerDay: 1e9 };
        let sent = 0;
        let peak = 0;
        let refused = 0;
        let drift = 0;
        for (let i = 0; sent < 30 * 1024 * 1024; i++) {
          const goal = filler(i, 1990);
          sent += goal.length;
          const r = await x.checkpoint(A, { ...KILN, goal });
          if (!r.ok) refused++;
          const total = x.limits.bytes();
          peak = Math.max(peak, total);
          if (i % 500 === 0 && x.store.sumBytes() !== total) drift++;
        }
        return { peak, refused, drift, sum: x.store.sumBytes(), total: x.limits.bytes() };
      });
      expect(out.peak).toBeLessThanOrEqual(TEN_MB);
      expect(out.sum).toBeLessThanOrEqual(TEN_MB);
      expect(out.sum).toBe(out.total);
      expect(out.drift).toBe(0);
    });
  });
}

{
  const A = caller('Codex', 'grant-a');
  const B = caller('Claude Code', 'grant-b');
  const PROJECT = 'github.com/acme/kiln';

  type Inner = { pools: Map<string, Item[]>; pool(project: string): Item[] };
  const inner = (x: Person) => x as unknown as Inner;

  async function poolMatches(stub: DurableObjectStub<Person>): Promise<boolean> {
    return runInDurableObject(stub, (x: Person) => {
      const cached = inner(x).pools.get(PROJECT);
      if (!cached) return true;
      const fresh = x.store.projectItems(PROJECT, 400);
      return JSON.stringify(cached.map((i) => [i.id, i.held, i.pinned, i.created])) === JSON.stringify(fresh.map((i) => [i.id, i.held, i.pinned, i.created]));
    });
  }

  function seedItems(n: number, start: number): Item[] {
    const out: Item[] = [];
    for (let i = 0; i < n; i++) {
      const kind = i % 5 === 4 ? 'handoff' : i % 7 === 6 ? 'dropped' : 'card';
      const body = kind === 'card' ? { goal: `Kiln card ${i}` } : kind === 'handoff' ? { goal: `Kiln goal ${i}`, next: `Kiln next ${i}` } : { label: 'prompt', text: `dropped ${i}`, size: 9 };
      const item = newItem(kind, PROJECT, body, { agent: i % 2 ? 'Codex' : 'Cursor', session: i % 3 ? `s-x-${i % 4}` : 'g-grant-a', via: 'hook', source: 'agent', at: start + i * 1000 });
      item.id = `seed-${String(i).padStart(4, '0')}`;
      item.held = i % 11 === 10;
      item.folded = i % 13 === 12;
      out.push(item);
    }
    return out;
  }

  describe('rows kept low without changing behaviour', () => {
    it('a restart never loses a call and counts at most the reserve more', async () => {
      const p = person();
      await awayFromMinuteEdge();
      for (let i = 0; i < 10; i++) expect((await p.recall(A, KILN)).ok).toBe(true);
      expect((await p.me()).callsToday).toBe(10);
      await evictDurableObject(p);
      const after = (await p.me()).callsToday;
      expect(after).toBeGreaterThanOrEqual(10);
      expect(after).toBeLessThanOrEqual(10 + RESERVE);
      let accepted = 0;
      for (let i = 0; i < MAX.perMinute + 20; i++) if ((await p.recall(A, KILN)).ok) accepted++;
      expect(accepted + 10).toBeLessThanOrEqual(MAX.perMinute);
      expect(accepted + 10).toBeGreaterThanOrEqual(MAX.perMinute - RESERVE);
      expect(await p.recall(A, KILN)).toEqual({ ok: false, text: SAY.minute });
    });

    it('a stored item writes the counters with it', async () => {
      const p = person();
      await awayFromMinuteEdge();
      for (let i = 0; i < 5; i++) await p.recall(A, KILN);
      await p.checkpoint(A, { ...KILN, goal: 'Counted card' });
      await evictDurableObject(p);
      const me = await p.me();
      expect(me.callsToday).toBeGreaterThanOrEqual(6);
      expect(me.callsToday).toBeLessThanOrEqual(6 + RESERVE);
      expect(me.storedToday).toBe(1);
      expect(me.bytes).toBeGreaterThan(0);
    });

    it('a call that crashes the object mid way is still counted, so crashing calls reach the minute limit', async () => {
      const id = person().id;
      await awayFromMinuteEdge();
      let crashes = 0;
      let refused: unknown = null;
      for (let n = 1; n <= MAX.perMinute && !refused; n++) {
        const stub = env.PERSON.get(id);
        await runInDurableObject(stub, (x: Person) => {
          const inside = x as unknown as { project: () => never; ctx: DurableObjectState };
          inside.project = () => {
            inside.ctx.abort('crash in the middle of a call');
            throw new Error('unreachable');
          };
        });
        const r = await stub.recall(A, KILN).then(
          (v) => v,
          () => null,
        );
        if (r) {
          refused = r;
          break;
        }
        crashes++;
        const hot = await runInDurableObject(env.PERSON.get(id), (x: Person) => x.store.meta<{ dayN?: number }>('hot', {}));
        expect(hot.dayN ?? 0).toBeGreaterThanOrEqual(crashes);
      }
      expect(refused).toEqual({ ok: false, text: SAY.minute });
      expect(crashes).toBeGreaterThanOrEqual(5);
      expect(crashes).toBeLessThanOrEqual(MAX.perMinute);
    });

    it('the pool cache matches the store after every kind of write', async () => {
      const p = person();
      await open(p);
      await runInDurableObject(p, (x: Person) => {
        for (const i of seedItems(420, Date.now() - 86400000)) x.store.put(i);
      });
      await p.recall(A, { ...KILN, query: 'kiln card goal' });
      expect(await poolMatches(p)).toBe(true);
      const c = await p.checkpoint(A, { ...KILN, goal: 'A new kiln card' });
      expect(await poolMatches(p)).toBe(true);
      await p.pin('seed-0410', true);
      await p.keep('seed-0406');
      expect(await poolMatches(p)).toBe(true);
      await p.remove(c.item!.id);
      await p.recall(A, { ...KILN, query: 'kiln card goal' });
      expect(await poolMatches(p)).toBe(true);
      await p.remove('seed-0002');
      await p.recall(A, { ...KILN, query: 'kiln card goal' });
      expect(await poolMatches(p)).toBe(true);
      for (let i = 0; i < 3; i++) await p.event(B, { host: 'claude-code', event: 'Stop', session: 'cc-1', cwd: KILN.folder, message: `turn ${i}` });
      await p.event(B, { host: 'claude-code', event: 'UserPromptSubmit', session: 'cc-1', cwd: KILN.folder, prompt: 'look at the kiln cards again' });
      await p.event(B, { host: 'claude-code', event: 'Stop', session: 'cc-1', cwd: KILN.folder, message: 'done' });
      expect(await poolMatches(p)).toBe(true);
      const read = await runInDurableObject(p, (x: Person) => {
        x.store.rowsRead = 0;
        inner(x).pool(PROJECT);
        return x.store.rowsRead;
      });
      expect(read).toBe(0);
    });

    it('a cold first recall prints exactly what a warm one prints', async () => {
      for (const shape of [0, 1, 2, 3, 4]) {
        const cold = person();
        const warm = person();
        const start = Date.now() - 86400000;
        for (const stub of [cold, warm]) {
          await open(stub);
          await runInDurableObject(stub, (x: Person) => {
            const items = seedItems(60 + shape * 150, start);
            if (shape === 2) for (const i of items) if (i.kind === 'handoff') i.held = true;
            if (shape === 3) for (const i of items) if (i.kind === 'card') i.held = i.id < 'seed-0590';
            if (shape === 4) items.forEach((i, k) => {
              if (i.kind === 'card') i.held = k % 20 !== 0;
            });
            for (const i of items) x.store.put(i);
          });
          await stub.addRule({ text: 'Fire slowly through quartz inversion', scope: 'all' });
        }
        await runInDurableObject(warm, (x: Person) => {
          inner(x).pool(PROJECT);
        });
        for (const who of [A, B]) {
          const a = await cold.recall(who, KILN);
          const b = await warm.recall(who, KILN);
          expect(a.text).toBe(b.text);
          const ev = { host: 'claude-code', event: 'UserPromptSubmit', session: `first-${who.grant}`, cwd: KILN.folder, prompt: 'start the kiln work for today please' };
          expect((await cold.event(who, ev)).text).toBe((await warm.event(who, ev)).text);
        }
      }
    });
  });
}

{
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

  async function call(stub: DurableObjectStub<Person>, kind: Kind, i: number, a: number, p: number): Promise<string> {
    const c = AGENTS[a];
    const w = where(p);
    const topic = TOPICS[i % TOPICS.length];
    const hook = (event: string, more: Record<string, string>) => stub.event(c, { host: a === 1 ? 'claude-code' : 'codex', event, session: `day-${a}-${p}`, cwd: w.folder, ...more });
    if (kind === 'recall first') return (await stub.recall(c, w, true)).text;
    if (kind === 'recall query') return (await stub.recall(c, { ...w, query: i % 2 ? `${topic} part decisions` : `zebra quartz lantern ${i}` }, true)).text;
    if (kind === 'event prompt') await hook('UserPromptSubmit', { prompt: `please look at the ${topic} work again, step ${i}` });
    else if (kind === 'checkpoint') await stub.checkpoint(c, { ...w, goal: `Finished the ${topic} step ${i}`, decisions: [`keep ${topic} simple`], open: [`test ${topic} ${i}`], changed: [`src/${i}.ts`] });
    else if (kind === 'handoff') await stub.handoff(c, { ...w, goal: `Ship the ${topic}`, next: `Wire the ${topic} step ${i}`, files: [`src/${i}.ts`] });
    else if (kind === 'rule') await stub.rule(c, { ...w, text: `Notes for the ${topic}`, words: `please look at the ${topic} work again`, scope: 'project' });
    else if (kind === 'event edit') await hook('PostToolUse', { tool: 'Edit', file: `src/${topic.replace(/ /g, '-')}-${i}.ts` });
    else if (kind === 'event command') await hook('PostToolUseFailure', { tool: 'Bash', command: `npm test -- ${i}` });
    else await hook('Stop', { message: `Done with the ${topic} step ${i}.` });
    return '';
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
    let topicLists = 0;
    for (let i = 0; i < ops.length; i++) {
      if (i > 0 && i % per_sitting === 0) {
        await evictDurableObject(stub);
        await open(stub);
      }
      const op = ops[i];
      if ((await call(stub, op.kind, i, op.a, op.p)).includes('\nTOPICS\n')) topicLists++;
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
    console.log(`DAY ${JSON.stringify({ calls: ops.length, boots, read, written, topicLists, kinds })}`);
    expect(written).toBeLessThanOrEqual(300);
    expect(read).toBeLessThanOrEqual(6000);
    expect(topicLists).toBeGreaterThan(0);
  });
}

{
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
}
