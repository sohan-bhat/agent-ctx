import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, run } from './precision.ts';
import { ITEMS, PROJECTS, QUERIES } from './corpus.ts';

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

test('recall over the test set reaches the quality bar', () => {
  const s = measure(run());
  assert.ok(s.precision_at_3 >= 0.85, `precision_at_3 ${s.precision_at_3}`);
  assert.ok(s.empty_correct >= 0.9, `empty_correct ${s.empty_correct}`);
  assert.ok(s.found >= 0.8, `found ${s.found}`);
});

test('every vague chat line gives the empty string', () => {
  for (const r of run().filter((x) => x.query.kind === 'chat')) assert.equal(r.empty, true, r.query.q);
});
