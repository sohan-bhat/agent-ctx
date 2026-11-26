import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DIM, cosine, quantize, rankHybrid } from '../src/hybrid.ts';
import { rankItems, type Hit } from '../src/rank.ts';
import { recall } from '../src/recall.ts';
import type { Item } from '../src/model.ts';
import { SETS, SET3, SET4, type TestSet } from './precision.ts';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const DAY = 86400000;

function card(id: string, goal: string, extra: Partial<Item> = {}): Item {
  const at = NOW - 3 * DAY;
  return { id, project: 'p', kind: 'card', body: { goal }, origin: { agent: 'codex', via: 'tool', source: 'agent', at }, flags: [], held: false, pinned: false, folded: false, created: at, ...extra };
}

function axis(...parts: [number, number][]): Int8Array {
  const v = new Array(8).fill(0);
  for (const [k, x] of parts) v[k] = x;
  return quantize(v);
}

const sig = (hits: Hit[]) => hits.map((h) => `${h.item.id}:${h.score}:${h.matched}`).join('|');
const SETTINGS = { bar: 0.5, margin: 0.2, gap: 0.1, max: 3, fill: true };

test('quantize keeps the direction as the unit vector times 127, rounded', () => {
  assert.deepEqual([...quantize([3, 4])], [76, 102]);
  assert.deepEqual([...quantize([0, -2, 0])], [0, -127, 0]);
  assert.deepEqual([...quantize([0, 0, 0])], [0, 0, 0]);
  assert.deepEqual([...quantize([Number.NaN, 1])], [0, 0]);
  const v = quantize(Array.from({ length: DIM }, (_, k) => Math.sin(k + 1)));
  assert.equal(v.length, DIM);
  assert.ok(v instanceof Int8Array);
  assert.ok(Math.max(...v.map(Math.abs)) <= 127);
});

test('cosine of int8 vectors matches the float cosine closely', () => {
  assert.equal(cosine(quantize([1, 2, 3]), quantize([1, 2, 3])), 1);
  assert.equal(cosine(quantize([1, 0]), quantize([-1, 0])), -1);
  assert.equal(cosine(quantize([1, 0]), quantize([0, 1])), 0);
  assert.equal(cosine(quantize([1, 0]), quantize([1, 0, 0])), 0);
  assert.equal(cosine(quantize([0, 0]), quantize([1, 0])), 0);
  let seed = 3;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  for (let k = 0; k < 50; k++) {
    const a = Array.from({ length: DIM }, rand);
    const b = a.map((x) => x + rand() * 0.8);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < DIM; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    assert.ok(Math.abs(cosine(quantize(a), quantize(b)) - dot / Math.sqrt(na * nb)) < 0.01);
  }
});

const pool = [
  card('near', 'Tide table cache for offline use'),
  card('close', 'Harbor chart drawing'),
  card('far1', 'Club roster export'),
  card('far2', 'Recipe scaling rules'),
  card('far3', 'Rook endgame tables'),
];
const vectors = new Map<string, Int8Array>([
  ['near', axis([0, 0.95], [1, 0.3])],
  ['close', axis([0, 0.9], [2, 0.44])],
  ['far1', axis([3, 1])],
  ['far2', axis([4, 1])],
  ['far3', axis([5, 1])],
]);
const query = axis([0, 1]);

test('with no query vector or no item vectors the result is rankItems exactly', () => {
  for (const q of ['tide table cache', 'nothing here matches', 'roster export']) {
    const words = rankItems(pool, q, NOW);
    assert.equal(sig(rankHybrid(pool, vectors, q, null, NOW, SETTINGS)), sig(words));
    assert.equal(sig(rankHybrid(pool, new Map(), q, query, NOW, SETTINGS)), sig(words));
  }
});

test('embedding candidates fill in after the word hits, three at most', () => {
  const ids = rankHybrid(pool, vectors, 'something with no shared words', query, NOW, SETTINGS).map((h) => h.item.id);
  assert.deepEqual(ids, ['near', 'close']);
  const words = rankItems(pool, 'club roster export', NOW).map((h) => h.item.id);
  assert.deepEqual(words, ['far1']);
  assert.deepEqual(rankHybrid(pool, vectors, 'club roster export', query, NOW, SETTINGS).map((h) => h.item.id), ['far1', 'near', 'close']);
  assert.deepEqual(rankHybrid(pool, vectors, 'something else', query, NOW, { ...SETTINGS, max: 1 }).map((h) => h.item.id), ['near']);
});

test('a candidate must pass the bar, the margin over the median and the gap to the best', () => {
  assert.deepEqual(rankHybrid(pool, vectors, 'zz', query, NOW, { ...SETTINGS, bar: 0.97 }), []);
  assert.deepEqual(rankHybrid(pool, vectors, 'zz', query, NOW, { ...SETTINGS, margin: 0.99 }), []);
  assert.deepEqual(rankHybrid(pool, vectors, 'zz', query, NOW, { ...SETTINGS, gap: 0.001 }).map((h) => h.item.id), ['near']);
  const flat = new Map([...vectors.keys()].map((id) => [id, axis([0, 1], [6, 0.2])]));
  assert.deepEqual(rankHybrid(pool, flat, 'zz', query, NOW, SETTINGS), []);
});

test('held items and rules never appear, and vectors of another length are skipped', () => {
  const items = [card('held', 'x', { held: true }), { ...card('rule', 'y'), kind: 'rule' as const, body: { text: 'y', words: 'y', scope: 'all' as const, status: 'active' as const, proof: 'page' as const } }, ...pool];
  const v = new Map(vectors);
  v.set('held', query);
  v.set('rule', query);
  const ids = rankHybrid(items, v, 'zz', query, NOW, SETTINGS).map((h) => h.item.id);
  assert.ok(!ids.includes('held') && !ids.includes('rule'));
  const short = new Map([['near', quantize([1, 0])]]);
  assert.deepEqual(rankHybrid(pool, short, 'zz', query, NOW, SETTINGS), []);
});

function poolOf(set: TestSet, project: string): Item[] {
  return set.items.filter((i) => i.project === project && !i.held && (i.kind === 'card' || i.kind === 'handoff'));
}

const digest = (s: string) => createHash('sha256').update(s).digest('hex');

test('over sets 1, 2, 3 and 4 the hybrid with no vectors equals the words only ranker and recall', () => {
  const sets: [string, TestSet][] = [['set1', SETS.set1], ['set2', SETS.set2], ['set3', SET3], ['set4', SET4]];
  const some = new Map([[SETS.set2.items[0].id, quantize([1, 2, 3])]]);
  let checked = 0;
  for (const [name, set] of sets) {
    set.queries.forEach((q, k) => {
      const items = poolOf(set, q.project);
      const words = sig(rankItems(items, q.q, set.now));
      assert.equal(sig(rankHybrid(items, new Map(), q.q, null, set.now)), words, `${name} query ${k}`);
      assert.equal(sig(rankHybrid(items, some, q.q, null, set.now)), words, `${name} query ${k}`);
      const base = { project: q.project, items: set.items, projects: set.projects, query: q.q, first: false, session: 'eval', seen: [], now: set.now };
      const a = recall(base);
      const b = recall({ ...base, vectors: new Map(), queryVector: null });
      const c = recall({ ...base, vectors: some, queryVector: null });
      assert.equal(digest(b.text) + b.delivered.join(','), digest(a.text) + a.delivered.join(','), `${name} query ${k}`);
      assert.equal(digest(c.text) + c.delivered.join(','), digest(a.text) + a.delivered.join(','), `${name} query ${k}`);
      checked++;
    });
  }
  assert.ok(checked >= 300, String(checked));
});

test('recall passes the vectors to the hybrid, here and for a named project', () => {
  const other = { ...card('o1', 'Opening book reader for the engine'), project: 'github.com/acme/knightmare' };
  const others = [other, ...['Quiescence search', 'UCI time control', 'Pawn structure terms'].map((g, k) => ({ ...card(`o${k + 2}`, g), project: 'github.com/acme/knightmare' }))];
  const items = [...pool, ...others];
  const projects = [{ key: 'p', names: [] }, { key: 'github.com/acme/knightmare', names: ['chess engine'] }];
  const v = new Map(vectors);
  v.set('o1', axis([7, 1]));
  others.slice(1).forEach((o, k) => v.set(o.id, axis([k + 3, 1])));
  const base = { project: 'p', items, projects, first: false, session: 's', seen: [], now: NOW, hybrid: SETTINGS };
  assert.deepEqual(recall({ ...base, query: 'zz qq' }).delivered, []);
  assert.deepEqual(recall({ ...base, query: 'zz qq', vectors: v, queryVector: query }).delivered, ['near', 'close']);
  const named = recall({ ...base, query: 'how does the chess engine do zz', vectors: v, queryVector: axis([6, 1]), namedVectors: new Map([['github.com/acme/knightmare', axis([7, 1])]]) });
  assert.deepEqual(named.delivered, ['o1']);
});

test('with fill off, embedding candidates come only when words found nothing', () => {
  const quiet = { ...SETTINGS, fill: false };
  assert.deepEqual(rankHybrid(pool, vectors, 'club roster export', query, NOW, quiet).map((h) => h.item.id), ['far1']);
  assert.deepEqual(rankHybrid(pool, vectors, 'something with no shared words', query, NOW, quiet).map((h) => h.item.id), ['near', 'close']);
});

test('the default settings add nothing to a query that words already answer', () => {
  assert.deepEqual(rankHybrid(pool, vectors, 'club roster export', query, NOW).map((h) => h.item.id), ['far1']);
});
