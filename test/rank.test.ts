import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scratch } from './synth.ts';
import { store } from '../src/core/paths.ts';
import { loadIndex, readCards, writeCardsAndIndex } from '../src/core/store.ts';
import { rankPrompt, rankStart, type Here } from '../src/core/rank.ts';
import { tokens } from '../src/core/text.ts';
import type { Card } from '../src/core/session.ts';

function card(id: string, place: string, title: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    session: id,
    part: 1,
    parts: 1,
    place,
    git: true,
    project: path.basename(place),
    places: [{ path: place, git: true, prompts: 1, edits: 1 }],
    first: '2026-11-10T10:00:00Z',
    last: '2026-11-10T12:00:00Z',
    title,
    summaries: [],
    prompts: [],
    files: [],
    transcript: `/x/${id}.jsonl`,
    turns: 1,
    ...extra,
  };
}

const now = Date.parse('2026-11-20T00:00:00Z');

test('tokens split code names and drop stop words', () => {
  assert.deepEqual(tokens('the SessionList and parse_jsonl-file'), ['session', 'list', 'parse', 'jsonl', 'file']);
});

test('session start ranks by fit, leaves out the current place, boosts the same remote', () => {
  const st = store(scratch('rank'));
  const cards = [
    card('a', '/code/mesher', 'Mesh solver tuning', { files: ['/code/mesher/src/mesh.rs'], summaries: ['Tuned the mesh solver for brackets'] }),
    card('b', '/code/ctxview', 'Context chart for ctxview', { files: ['/code/ctxview/web/Chart.tsx'] }),
    card('c', '/code/ctxview-docs', 'Docs for the context chart', { files: ['/code/ctxview-docs/chart.md'], remote: 'me/ctxview' }),
    card('d', '/code/garden', 'Garden planner', { files: ['/code/garden/plan.py'] }),
  ];
  writeCardsAndIndex(st, cards);
  const ix = loadIndex(st)!;
  const here: Here = { place: '/code/ctxview', git: true, remote: 'me/ctxview', folder: 'ctxview', files: ['/code/ctxview/web/Chart.tsx'] };
  const hits = rankStart(ix, here, now);
  const ids = hits.map((h) => ix.docs[h.doc].id);
  assert.ok(!ids.includes('b'));
  assert.equal(ids[0], 'c');
  assert.ok(!ids.includes('d'));
  const got = readCards(st, ix, hits.map((h) => h.doc));
  assert.equal(got[0].title, 'Docs for the context chart');
});

test('prompt ranking needs a real fit and stays quiet otherwise', () => {
  const st = store(scratch('rank2'));
  const cards = [
    card('a', '/code/mesher', 'Mesh solver tuning', { summaries: ['Tuned the tetrahedral mesh solver and fixed bracket stress results'], files: ['/code/mesher/src/mesh.rs'] }),
    card('b', '/code/orchard', 'Orchard planner frost map', { summaries: ['Built the frost map switch and the orchard kit'], files: ['/code/orchard/src/FrostMap.tsx'] }),
  ];
  for (let i = 0; i < 40; i++) cards.push(card(`n${i}`, `/code/p${i}`, `Filler project ${i} about gardening and recipes`, { summaries: [`Planted tomatoes in bed ${i}`] }));
  writeCardsAndIndex(st, cards);
  const ix = loadIndex(st)!;
  const hits = rankPrompt(ix, 'the frost map switch flickers on the orchard planner', now);
  assert.equal(ix.docs[hits[0].doc].id, 'b');
  assert.ok(hits.length <= 3 || hits[3].final < hits[0].final);
  assert.equal(rankPrompt(ix, 'what is the weather like on mars today', now).length, 0);
  assert.equal(rankPrompt(ix, 'ok', now).length, 0);
});

test('recency weighs newer cards higher at equal fit', () => {
  const st = store(scratch('rank3'));
  writeCardsAndIndex(st, [
    card('old', '/code/a', 'Parser rewrite for the lexer', { last: '2026-08-01T00:00:00Z' }),
    card('new', '/code/b', 'Parser rewrite for the lexer', { last: '2026-11-19T00:00:00Z' }),
  ]);
  const ix = loadIndex(st)!;
  const hits = rankPrompt(ix, 'parser rewrite lexer', now);
  assert.equal(ix.docs[hits[0].doc].id, 'new');
});
