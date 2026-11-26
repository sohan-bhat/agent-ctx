import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, namedProjects, rankItems, recency, recent } from '../src/rank.ts';
import type { Body, CardBody, Item, Kind } from '../src/model.ts';

const NOW = Date.parse('2026-11-20T12:00:00Z');

function item(id: string, kind: Kind, body: Body, daysAgo: number, extra: Partial<Item> = {}, session?: string): Item {
  const at = NOW - daysAgo * DAY;
  return {
    id,
    project: 'github.com/acme/rollcall',
    kind,
    body,
    origin: { agent: 'codex', via: 'tool', source: 'agent', at, ...(session ? { session } : {}) },
    flags: [],
    held: false,
    pinned: false,
    folded: false,
    created: at,
    ...extra,
  };
}

const card = (id: string, goal: string, daysAgo: number, more: Partial<CardBody> = {}, extra: Partial<Item> = {}, session?: string) =>
  item(id, 'card', { goal, ...more }, daysAgo, extra, session);

const items: Item[] = [
  card('waitlist', 'Add a waitlist when an event is full', 3, { decisions: [{ what: 'store waitlist position in the signups table', why: 'one query for the roster' }] }),
  card('emails', 'Send reminder emails the day before an event', 5, { dead_ends: ['cron on the free tier sleeps, moved to a queue'] }),
  card('roster', 'Export the event roster as CSV for club leaders', 8, { changed: [{ path: 'src/export/roster.ts' }] }),
  card('login', 'Switch login to magic links', 12, { open: ['rate limit the magic link endpoint'] }),
  card('theme', 'Dark theme for the event pages', 20),
  card('payments', 'Collect dues with a payment link per member', 30),
  card('held', 'Waitlist position leak in the admin view', 1, {}, { held: true }),
  item('rule', 'rule', { text: 'waitlist position always', words: 'waitlist position always', scope: 'project', status: 'active', proof: 'page' }, 1),
];

test('a query that names the subject of one card finds that card first', () => {
  const hits = rankItems(items, 'where do we store the waitlist position', NOW);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].item.id, 'waitlist');
  assert.ok(hits[0].matched >= 2);
});

test('held items and rules never appear', () => {
  const ids = rankItems(items, 'waitlist position admin leak always', NOW).map((h) => h.item.id);
  assert.ok(!ids.includes('held'));
  assert.ok(!ids.includes('rule'));
});

test('a query that fits nothing gives an empty array', () => {
  assert.deepEqual(rankItems(items, 'tune the kubernetes autoscaler for the gpu nodes', NOW), []);
});

test('chat words carry no weight, so a vague line gives an empty array', () => {
  for (const q of ['ok continue', 'looks good, keep going', 'great, carry on', 'sounds fine', '']) assert.deepEqual(rankItems(items, q, NOW), [], q);
});

test('two distinct query terms must match unless the query has one usable term', () => {
  assert.deepEqual(rankItems(items, 'waitlist kubernetes', NOW), []);
  assert.equal(rankItems(items, 'waitlist', NOW)[0]?.item.id, 'waitlist');
});

test('rare terms weigh more than terms spread over the project', () => {
  const pool = [
    card('a', 'event event event roster', 1),
    card('b', 'event magic', 1),
    card('c', 'event page', 1),
    card('d', 'event theme', 1),
    card('e', 'unrelated dues', 1),
  ];
  const hits = rankItems(pool, 'event magic', NOW);
  assert.equal(hits[0].item.id, 'b');
});

test('recency multiplies the score with the 21 day curve', () => {
  assert.equal(recency(NOW, NOW), 1);
  assert.ok(Math.abs(recency(NOW - 21 * DAY, NOW) - (0.4 + 0.6 / Math.E)) < 1e-12);
  assert.ok(Math.abs(recency(NOW - 400 * DAY, NOW) - 0.4) < 1e-6);
  const pool = [card('old', 'Badge printer driver for check in', 50), card('new', 'Badge printer driver for check in', 1), card('x', 'unrelated', 2), card('y', 'other', 3)];
  const hits = rankItems(pool, 'badge printer driver', NOW);
  assert.deepEqual(hits.map((h) => h.item.id), ['new', 'old']);
  assert.ok(hits[0].score > hits[1].score);
});

test('recent gives the newest cards and handoffs that are not held', () => {
  const pool = [
    ...items,
    item('h', 'handoff', { goal: 'Finish the waitlist', next: 'Wire the email' }, 2),
    item('d', 'dropped', { label: 'prompt', text: 'x', size: 1 }, 0),
  ];
  assert.deepEqual(recent(pool, 3).map((i) => i.id), ['h', 'waitlist', 'emails']);
  assert.deepEqual(recent(pool, 0), []);
});

test('for one session the card written by an agent wins over the auto card', () => {
  const pool = [
    card('auto', 'auto from hooks', 1, { auto: true }, {}, 's-9'),
    card('written', 'written by the agent', 2, {}, {}, 's-9'),
    card('auto-other', 'auto in another session', 3, { auto: true }, {}, 's-8'),
  ];
  assert.deepEqual(recent(pool, 5).map((i) => i.id), ['written', 'auto-other']);
});

test('namedProjects finds other projects named as a whole word', () => {
  const projects = [
    { key: 'github.com/acme/rollcall', names: ['club app'] },
    { key: 'github.com/acme/knightmare', names: ['chess engine'] },
    { key: 'github.com/acme/gale-station', names: ['weather station'] },
    { key: 'folder:pantry', names: [] },
  ];
  const cur = 'github.com/acme/rollcall';
  assert.deepEqual(namedProjects('how did knightmare cache positions', projects, cur), ['github.com/acme/knightmare']);
  assert.deepEqual(namedProjects('what did the Chess Engine use', projects, cur), ['github.com/acme/knightmare']);
  assert.deepEqual(namedProjects('the gale station firmware', projects, cur), ['github.com/acme/gale-station']);
  assert.deepEqual(namedProjects('pantry login and the weather-station', projects, cur), ['github.com/acme/gale-station', 'folder:pantry']);
  assert.deepEqual(namedProjects('rollcall and the club app', projects, cur), []);
  assert.deepEqual(namedProjects('knightmares and pantryware', projects, cur), []);
});
