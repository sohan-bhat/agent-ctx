import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf, buildBm25, idf, search, view } from '../src/text.ts';

const docs = [
  ['wind', 'gust', 'filter'],
  ['rain', 'gauge', 'bucket', 'rain'],
  ['wind', 'vane', 'offset'],
  ['battery', 'sleep'],
];

test('buildBm25 stores lengths, the average and postings of doc and count', () => {
  const d = buildBm25(docs);
  assert.equal(d.n, 4);
  assert.deepEqual(d.dl, [3, 4, 3, 2]);
  assert.equal(d.avgdl, 3);
  assert.deepEqual(d.terms.wind, [0, 1, 2, 1]);
  assert.deepEqual(d.terms.rain, [1, 2]);
});

test('rarer terms get a larger idf', () => {
  assert.ok(idf(10, 1) > idf(10, 5));
  assert.ok(idf(10, 0) > idf(10, 1));
});

test('search scores the matching docs, counts matched terms and gives a share of the best case', () => {
  const v = view(buildBm25(docs));
  const hits = search(v, ['wind', 'gust']);
  assert.deepEqual(hits.map((h) => h.doc), [0, 2]);
  assert.equal(hits[0].matched, 2);
  assert.equal(hits[1].matched, 1);
  assert.ok(hits[0].norm > hits[1].norm && hits[0].norm <= 1);
  assert.deepEqual(search(v, ['missing']), []);
});

test('query weights scale a term', () => {
  const v = view(buildBm25(docs));
  const plain = search(v, ['wind', 'rain']);
  const heavy = search(v, ['wind', 'rain'], new Map([['rain', 5]]));
  assert.equal(heavy[0].doc, 1);
  assert.ok(heavy.find((h) => h.doc === 1)!.score > plain.find((h) => h.doc === 1)!.score);
});

test('bucketOf is stable and inside the range', () => {
  assert.equal(bucketOf('wind', 64), bucketOf('wind', 64));
  for (const t of ['a', 'wind', 'gauge', 'x'.repeat(50)]) {
    const b = bucketOf(t, 64);
    assert.ok(b >= 0 && b < 64);
  }
});
