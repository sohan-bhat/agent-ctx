import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Person } from '../src/person.ts';
import { MAX, SAY } from '../src/limits.ts';
import { KILN, awayFromMinuteEdge, caller, open, person, sql } from './helpers.ts';

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
