import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, run, SETS } from './precision.ts';
import { ITEMS, PROJECTS, QUERIES } from './corpus.ts';
import * as two from './corpus2.ts';

test('the test set has four projects, 50 labelled queries and the planned mix', () => {
  assert.equal(PROJECTS.length, 4);
  assert.equal(QUERIES.length, 50);
  const count = (k: string) => QUERIES.filter((q) => q.kind === k).length;
  assert.deepEqual([count('answer'), count('none'), count('chat'), count('cross')], [30, 10, 5, 5]);
  const ids = new Set(ITEMS.map((i) => i.id));
  for (const q of QUERIES) {
    for (const id of q.want) assert.ok(ids.has(id), id);
    if (q.kind === 'answer') assert.ok(q.want.length >= 1 && q.want.length <= 2 && q.want.every((id) => ITEMS.find((i) => i.id === id)!.project === q.project));
    if (q.kind === 'cross') assert.ok(q.want.every((id) => ITEMS.find((i) => i.id === id)!.project !== q.project));
  }
  const days = ITEMS.map((i) => i.created);
  assert.ok((Math.max(...days) - Math.min(...days)) / 86400000 >= 55);
});

test('set two has 40 cards a project, 120 labelled queries and the planned mix', () => {
  for (const p of PROJECTS) assert.equal(two.ITEMS.filter((i) => i.project === p.key && i.kind === 'card').length, 40, p.key);
  assert.equal(two.QUERIES.length, 120);
  const count = (k: string) => two.QUERIES.filter((q) => q.kind === k).length;
  assert.deepEqual([count('prompt'), count('short'), count('other'), count('none'), count('cross')], [40, 20, 15, 30, 15]);
  const byId = new Map(two.ITEMS.map((i) => [i.id, i]));
  for (const q of two.QUERIES) {
    for (const id of q.want) assert.ok(byId.has(id), id);
    if (q.kind === 'cross') assert.ok(q.want.length && q.want.every((id) => byId.get(id)!.project !== q.project));
    else if (q.kind !== 'none') assert.ok(q.want.length >= 1 && q.want.length <= 2 && q.want.every((id) => byId.get(id)!.project === q.project));
    if (q.kind === 'prompt') assert.ok(q.q.split(/\s+/).length >= 15 && q.q.split(/\s+/).length <= 60, q.q);
    if (q.kind === 'short') assert.ok(q.q.split(/\s+/).length >= 2 && q.q.split(/\s+/).length <= 5, q.q);
  }
  assert.ok(two.ITEMS.filter((i) => i.kind === 'card' && (i.body as { auto?: boolean }).auto).length >= 16);
});

test('recall over set one reaches the quality bar', () => {
  const s = measure(run(SETS.set1));
  assert.ok(s.precision_at_3 >= 0.85, `precision_at_3 ${s.precision_at_3}`);
  assert.ok(s.empty_correct >= 0.9, `empty_correct ${s.empty_correct}`);
  assert.ok(s.found >= 0.8, `found ${s.found}`);
});

test('recall over set two stays quiet on whole prompts', () => {
  const s = measure(run(SETS.set2));
  assert.ok(s.precision_at_3 >= 0.91, `precision_at_3 ${s.precision_at_3}`);
  assert.ok(s.empty_correct >= 0.98, `empty_correct ${s.empty_correct}`);
  assert.ok(s.found >= 0.76, `found ${s.found}`);
});

test('every vague chat line in set one gives the empty string', () => {
  for (const r of run(SETS.set1).filter((x) => x.query.kind === 'chat')) assert.equal(r.empty, true, r.query.q);
});
