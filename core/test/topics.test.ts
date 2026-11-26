import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FOOTER, HEADER, NO_MATCH, OTHERS_CHARS, TOPIC_CHARS, recall, type RecallInput } from '../src/recall.ts';
import { TOPICS, looseMatches, resolveIds, shortIds, topicList } from '../src/topics.ts';
import type { Body, Item, Kind } from '../src/model.ts';
import { SETS, SET2B, SET3, SET4 } from './precision.ts';

const DAY = 86400000;
const NOW = Date.parse('2026-11-20T12:00:00Z');
const P = 'github.com/acme/tide-tables';
const Q = 'github.com/acme/rook-engine';
const projects = [{ key: P, names: ['tide app'] }, { key: Q, names: ['chess engine'] }];

let n = 0;
function item(kind: Kind, body: Body, o: { project?: string; days?: number; id?: string; extra?: Partial<Item> } = {}): Item {
  const at = NOW - (o.days ?? 1) * DAY;
  const id = o.id ?? `${String(++n).padStart(4, '0')}abcd-${kind}-${n}`;
  return { id, project: o.project ?? P, kind, body, origin: { agent: 'codex', via: 'tool', source: 'agent', at }, flags: [], held: false, pinned: false, folded: false, created: at, ...(o.extra ?? {}) };
}

const card = (goal: string, days: number, o: { project?: string; extra?: Partial<Item> } = {}) => item('card', { goal }, { days, ...o });

const GOALS = ['Harbor tide table cache', 'Moon phase widget', 'Offline sync queue', 'Push alerts for high water', 'Dark map tiles', 'Wind arrows on the chart', 'Login with passkeys', 'Settings page for units', 'Export readings as CSV', 'Station picker search', 'Battery saver mode', 'Crash on rotate', 'Onboarding tour', 'Widget refresh timing', 'Map zoom limits'];
const cards = GOALS.map((g, k) => card(g, k + 1));
const held = card('Held harbor tide secret plan', 0, { extra: { held: true } });
const rule = item('rule', { text: 'Harbor tide rule', words: 'harbor tide rule words', scope: 'all', status: 'active', proof: 'page' }, { days: 0 });
const pending = item('rule', { text: 'Pending harbor tide rule', words: 'pending harbor tide', scope: 'all', status: 'pending' }, { days: 0 });
const others = ['Opening book reader', 'Quiescence search', 'Rook endgame tables'].map((g, k) => card(g, k + 2, { project: Q }));
const all = [...cards, held, rule, pending, ...others];

function input(more: Partial<RecallInput> = {}): RecallInput {
  return { project: P, items: all, projects, first: false, session: 's', seen: [], now: NOW, ...more };
}

test('a short id is the first 8 characters and grows until unique', () => {
  const items = [item('card', { goal: 'a' }, { id: 'abcdefgh1111' }), item('card', { goal: 'b' }, { id: 'abcdefgh2222' }), item('card', { goal: 'c' }, { id: 'zzzzzzzz9999' }), item('card', { goal: 'd' }, { id: 'abcdefgh2299' })];
  const ids = shortIds(items);
  assert.equal(ids.get('zzzzzzzz9999'), 'zzzzzzzz');
  assert.equal(ids.get('abcdefgh1111'), 'abcdefgh1');
  assert.equal(ids.get('abcdefgh2222'), 'abcdefgh222');
  assert.equal(ids.get('abcdefgh2299'), 'abcdefgh229');
  assert.equal(new Set(ids.values()).size, 4);
});

test('resolveIds maps short ids, full ids and unique prefixes back and skips the rest', () => {
  const items = [item('card', { goal: 'a' }, { id: 'abcdefgh1111' }), item('card', { goal: 'b' }, { id: 'abcdefgh2222' }), item('card', { goal: 'c' }, { id: 'zzzzzzzz9999' })];
  const got = resolveIds(items, ['zzzzzzzz', 'abcdefgh2', 'abcdefgh1111', 'abcdefgh', 'nope', '', 'zzzzzzzz']).map((i) => i.id);
  assert.deepEqual(got, ['zzzzzzzz9999', 'abcdefgh2222', 'abcdefgh1111']);
  assert.deepEqual(resolveIds(items, ['abcdefgh']), []);
});

test('ids read exactly those items under EARLIER and mark them delivered', () => {
  const ids = shortIds(all);
  const want = [cards[3], cards[7]];
  const out = recall(input({ ids: want.map((i) => ids.get(i.id)!), tool: true }));
  assert.deepEqual(out.delivered, want.map((i) => i.id));
  const lines = out.text.split('\n');
  assert.equal(lines[0], HEADER.replace('NAME', 'tide-tables'));
  assert.ok(lines.includes('EARLIER'));
  assert.ok(lines.some((l) => l.startsWith('> ') && l.includes('Push alerts for high water')));
  assert.ok(out.text.endsWith(FOOTER));
});

test('ids skip held items, rules, pending rules, unknown ids and projects the query does not name', () => {
  const ids = shortIds(all);
  const ask = [held, rule, pending, others[0]].map((i) => ids.get(i.id)!).concat(['nope0000']);
  assert.deepEqual(recall(input({ ids: ask })), { text: '', delivered: [] });
  const named = recall(input({ ids: [ids.get(others[0].id)!], query: 'how does the chess engine read books' }));
  assert.deepEqual(named.delivered, [others[0].id]);
  assert.match(named.text, /> \d{4}-\d{2}-\d{2} codex in rook-engine\. Opening book reader\./);
});

test('ids read at most six items', () => {
  const ids = shortIds(all);
  assert.equal(recall(input({ ids: cards.map((i) => ids.get(i.id)!) })).delivered.length, 6);
});

test('with no hit on the tool path the topic list has the exact shape and fits 1,400 characters', () => {
  const out = recall(input({ query: 'zebra crossing lights', tool: true }));
  const lines = out.text.split('\n');
  assert.equal(lines[0], NO_MATCH);
  assert.deepEqual([lines[1], lines[2]], ['', 'TOPICS']);
  const topics = lines.filter((l) => l.startsWith('> '));
  assert.ok(topics.length >= 1 && topics.length <= TOPICS);
  const ids = shortIds(all);
  for (const l of topics) {
    assert.match(l, /^> [0-9a-z-]{8,} \d{4}-\d{2}-\d{2} codex\. .+$/);
    assert.ok(l.length <= 2 + 8 + 1 + 10 + 1 + 5 + 2 + 80, l);
  }
  assert.equal(topics[0].split(' ')[1], ids.get(cards[0].id));
  assert.ok(out.text.endsWith(`\n\n${FOOTER}`));
  assert.ok(out.text.length <= TOPIC_CHARS);
  assert.deepEqual(out.delivered, []);
  assert.equal(out.topics?.length, topics.length);
  assert.match(out.text, /\n\n\d+ more topics? (?:is|are) stored\.\n\n/);
});

test('the topic list ranks loose matches first, then the newest, and counts the rest', () => {
  const list = topicList(cards, 'which widget shows the moon', NOW);
  assert.equal(list.items.length, TOPICS);
  assert.equal(list.more, GOALS.length - TOPICS);
  assert.deepEqual(list.items.slice(0, 2).map((i) => (i.body as { goal: string }).goal), ['Moon phase widget', 'Widget refresh timing']);
  assert.equal((list.items[2].body as { goal: string }).goal, 'Harbor tide table cache');
  assert.equal(topicList(cards.slice(0, 5), 'zzz', NOW).more, 0);
});

test('a query that names another project lists that project topics', () => {
  const out = recall(input({ query: 'what does the chess engine do with zebras', tool: true }));
  assert.ok(out.text.startsWith('No confident match. Stored topics of rook-engine follow.'));
  assert.deepEqual(new Set(out.topics), new Set(others.map((i) => i.id)));
});

test('with no stored card at all the result stays empty for the existing sentence', () => {
  assert.deepEqual(recall(input({ items: [held, rule, pending], query: 'harbor tide', tool: true })), { text: '', delivered: [] });
});

test('with hits the text is today plus one short line of other close topics outside the block', () => {
  const base = input({ query: 'harbor tide table cache' });
  const today = recall(base);
  const tool = recall({ ...base, tool: true });
  assert.ok(today.delivered.length >= 1);
  assert.deepEqual(tool.delivered, today.delivered);
  const plain = recall(input({ query: 'login with passkeys', items: [cards[6], ...others] }));
  const plainTool = recall(input({ query: 'login with passkeys', items: [cards[6], ...others], tool: true }));
  assert.equal(plainTool.text, plain.text);
  const extra = input({ query: 'tide chart wind arrows', items: [card('Tide chart wind arrows', 1), card('Tide chart colors', 2), card('Tide alarms', 3), ...cards] });
  const t = recall({ ...extra, tool: true });
  const u = recall(extra);
  const line = t.text.split('\n\n').slice(-2)[0];
  assert.match(line, /^Other close topics by id are [0-9a-z-]{8,}(?:, [0-9a-z-]{8,})*(?: and [0-9a-z-]{8,})?\.$/);
  assert.ok(line.length < OTHERS_CHARS);
  assert.ok(t.others && t.others.length >= 1 && t.others.length <= 6);
  assert.ok(!t.others.some((id) => t.delivered.includes(id)));
  assert.equal(t.text.replace(`\n\n${line}`, ''), u.text);
});

test('held items, rules and pending rules never appear in a topic list or as other topics', () => {
  const out = recall(input({ query: 'zebra harbor tide', tool: true, items: [held, rule, pending, ...cards.slice(1)] }));
  for (const id of [held.id, rule.id, pending.id]) assert.ok(!(out.topics ?? []).includes(id) && !(out.others ?? []).includes(id));
  assert.ok(!looseMatches(all, 'harbor tide secret rule').some((i) => [held.id, rule.id, pending.id].includes(i.id)));
});

test('without tool no output is a topic list or holds another line', () => {
  for (const q of ['zebra crossing lights', 'harbor tide table cache']) {
    const out = recall(input({ query: q }));
    assert.ok(!out.text.startsWith('No confident match'));
    assert.equal(out.topics, undefined);
    assert.equal(out.others, undefined);
  }
});

test('with tool false or absent every output over sets 1, 2, 2b, 3 and 4 is byte for byte as before', () => {
  for (const tool of [undefined, false] as const) {
    const h = createHash('sha256');
    let runs = 0;
    for (const set of [SETS.set1, SETS.set2, SET2B, SET3, SET4]) {
      for (const q of set.queries) {
        for (const [query, first] of [[q.q, false], [q.q, true], ['', true]] as const) {
          const base = { project: q.project, items: set.items, projects: set.projects, query, first, session: 'eval', seen: [], now: set.now };
          const out = recall(tool === undefined ? base : { ...base, tool });
          h.update(out.text + '\u0001' + out.delivered.join(',') + '\u0002');
          runs++;
        }
      }
    }
    assert.equal(runs, 1350);
    assert.equal(h.digest('hex'), '265f43589fb8b946f6ba3cd206047b2511b85cb23b009295c32ef967ba6072bb', String(tool));
  }
});

test('long goals and long agent names are cut so twelve topics still fit 1,400 characters', () => {
  const long = Array.from({ length: 14 }, (_, k) => ({ ...card(`Topic ${k} ` + 'about the harbor gauge calibration and the slow chart '.repeat(3), k + 1), origin: { agent: 'a-very-long-agent-product-name', via: 'tool' as const, source: 'agent' as const, at: NOW - (k + 1) * DAY } }));
  const out = recall(input({ items: long, query: 'zebra', tool: true }));
  assert.ok(out.text.length <= TOPIC_CHARS, String(out.text.length));
  assert.equal(out.topics?.length, TOPICS);
  assert.match(out.text, /\n\n2 more topics are stored\.\n\n/);
});
