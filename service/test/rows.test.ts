import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newItem, type Item } from '../../core/src/index.ts';
import type { Person } from '../src/person.ts';
import { MAX, SAY } from '../src/limits.ts';
import { awayFromMinuteEdge, caller, KILN, open, person } from './helpers.ts';

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
  it('a lost counter write is more lenient by at most one minute of calls and never stricter', async () => {
    const p = person();
    await awayFromMinuteEdge();
    for (let i = 0; i < 10; i++) expect((await p.recall(A, KILN)).ok).toBe(true);
    expect((await p.me()).callsToday).toBe(10);
    await evictDurableObject(p);
    const after = (await p.me()).callsToday;
    expect(after).toBe(1);
    let accepted = 0;
    for (let i = 0; i < MAX.perMinute + 20; i++) if ((await p.recall(A, KILN)).ok) accepted++;
    expect(accepted).toBe(MAX.perMinute - 1);
    expect(accepted + 10).toBeGreaterThan(MAX.perMinute);
    expect(accepted + 10).toBeLessThanOrEqual(MAX.perMinute + 9);
    expect(await p.recall(A, KILN)).toEqual({ ok: false, text: SAY.minute });
  });

  it('a stored item writes the counters with it', async () => {
    const p = person();
    await awayFromMinuteEdge();
    for (let i = 0; i < 5; i++) await p.recall(A, KILN);
    await p.checkpoint(A, { ...KILN, goal: 'Counted card' });
    await evictDurableObject(p);
    const me = await p.me();
    expect([me.callsToday, me.storedToday]).toEqual([6, 1]);
    expect(me.bytes).toBeGreaterThan(0);
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
