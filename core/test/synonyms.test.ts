import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, joinPhrases, synonymsOf, tokens, vocabulary } from '../src/text.ts';

const SUBJECT = [
  'weather', 'wind', 'gust', 'rain', 'humidity', 'temperature', 'pressure', 'anemometer', 'vane', 'lightning', 'solar', 'forecast', 'station', 'sensor', 'lora', 'barometer', 'fog', 'battery',
  'recipe', 'ingredient', 'serving', 'servings', 'flour', 'sugar', 'egg', 'cook', 'cooking', 'meal', 'nutrition', 'aisle', 'grocery', 'kitchen', 'oven', 'bake', 'food', 'timer', 'shopping',
  'chess', 'pawn', 'king', 'queen', 'rook', 'bishop', 'knight', 'castle', 'castling', 'checkmate', 'perft', 'opening', 'endgame', 'eval', 'evaluation', 'tablebase', 'board', 'move', 'elo', 'book', 'engine',
  'club', 'waitlist', 'roster', 'student', 'parent', 'leader', 'member', 'meeting', 'attendance', 'consent', 'school', 'term', 'event', 'checkin', 'room', 'gym',
];

test('the table holds about 50 groups of general developer vocabulary', () => {
  assert.ok(GROUPS.length >= 45 && GROUPS.length <= 65, String(GROUPS.length));
  for (const g of GROUPS) assert.ok(g.length >= 2, g.join(' '));
});

test('the table holds no word of the made up projects own subject matter', () => {
  const subject = new Set(SUBJECT.flatMap((w) => tokens(w)));
  const words = new Set(GROUPS.flat().flatMap((w) => tokens(joinPhrases(w))));
  for (const w of words) assert.ok(!subject.has(w), w);
});

test('a word in a group gives the other members, both ways', () => {
  const [login] = tokens('login');
  const [auth] = tokens('auth');
  assert.ok(synonymsOf(login).includes(auth));
  assert.ok(synonymsOf(auth).includes(login));
  const [photo] = tokens('photo');
  const [image] = tokens('images');
  assert.ok(synonymsOf(photo).includes(image));
  assert.deepEqual(synonymsOf('zzz'), []);
  for (const t of vocabulary()) for (const o of synonymsOf(t)) assert.ok(synonymsOf(o).includes(t), `${t} ${o}`);
});

test('two word phrases join into one term before matching', () => {
  assert.deepEqual(tokens(joinPhrases('Sign in with github, then log-in again')), ['signin', 'github', 'login']);
  assert.deepEqual(tokens(joinPhrases('the sign up form and the end to end test')), ['signup', 'form', 'e2e', 'test']);
  assert.ok(synonymsOf(tokens(joinPhrases('sign in'))[0]).includes(tokens('login')[0]));
});
