import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_BYTES, itemBytes, newItem, type CardBody, type Item, type Origin } from '../src/model.ts';
import { SAME_CONTAINS, SAME_JACCARD, SAME_MIN_TERMS, mergeCard, overlap, sameCard } from '../src/merge.ts';
import { month, type Checkpoint } from './month.ts';

const AT = Date.UTC(2026, 10, 1);
const A: Origin = { agent: 'Codex', via: 'tool', source: 'agent', at: AT };
const B: Origin = { agent: 'Claude Code', via: 'tool', source: 'agent', at: AT + 1000 };

function card(c: Checkpoint, project = 'github.com/acme/pantry', origin: Origin = A): Item {
  const body: CardBody = { goal: c.goal, changed: c.changed.map((path) => ({ path })), decisions: c.decisions.map((what) => ({ what })), dead_ends: c.dead_ends, open: c.open, commands: c.commands };
  return newItem('card', project, body, origin);
}

test('on seed 1 every repeat is the same card and no twin or other pair is', () => {
  const m = month(1);
  for (const s of m.steps) {
    if (s.kind !== 'checkpoint' || s.label.type === 'distinct' || s.label.type === 'chat') continue;
    const p = m.pieces[s.label.piece];
    assert.ok(sameCard(card(p.card), card(s.card, undefined, B)), `${s.label.type} of ${p.n}`);
  }
  for (const a of m.pieces) for (const b of m.pieces) {
    if (a.n >= b.n || a.project !== b.project) continue;
    assert.equal(sameCard(card(a.card), card(b.card)), false, `${a.n} and ${b.n}${a.twin === b.n ? ' twins' : ''}`);
  }
});

test('the thresholds sit inside the gap seen on seed 1', () => {
  assert.ok(SAME_JACCARD > 0.45 && SAME_JACCARD < 0.83);
  assert.ok(SAME_CONTAINS > 0.63 && SAME_CONTAINS < 0.96);
});

test('short cards that differ in one word stay apart, since that word can be the whole difference', () => {
  const short = (where: string) => card({ goal: `Fix the login redirect on ${where}`, changed: ['src/login.ts'], decisions: [], dead_ends: [], open: [], commands: [] });
  assert.equal(sameCard(short('safari'), short('firefox')), false);
  assert.equal(SAME_MIN_TERMS, 12);
});

test('cards of two projects, tiny cards, rules and handoffs are never the same card', () => {
  const p = month(1).pieces[0].card;
  assert.equal(sameCard(card(p), card(p, 'github.com/acme/kiln')), false);
  const tiny = card({ goal: 'Fix bug', changed: [], decisions: [], dead_ends: [], open: [], commands: [] });
  assert.equal(sameCard(tiny, card({ ...tiny.body, changed: [], decisions: [], dead_ends: [], open: [], commands: [] } as unknown as Checkpoint)), false);
  const rule = { ...card(p), kind: 'rule' as const };
  const handoff = { ...card(p), kind: 'handoff' as const };
  assert.equal(sameCard(rule, card(p)), false);
  assert.equal(sameCard(handoff, card(p)), false);
  assert.equal(sameCard(card(p), card(p)), true);
});

test('a merge that adds no line returns the stored card itself', () => {
  const p = month(1).pieces[3].card;
  const old = card(p);
  const again = card({ ...p, decisions: [...p.decisions].reverse(), goal: `Again ${p.goal}`, changed: [...p.changed].reverse() }, undefined, B);
  assert.equal(mergeCard(old, again, AT + 5000), old);
  const shouting = card({ ...p, open: p.open.map((o) => `  ${o.toUpperCase()}  `) }, undefined, B);
  assert.equal(mergeCard(old, shouting, AT + 5000), old);
});

test('a merge joins lists newest first without repeats, keeps the id and the date, and names the newest writer', () => {
  const p = month(1).pieces[5].card;
  const old = card(p);
  const incoming = card({ ...p, goal: 'Fixed it for good', dead_ends: [...p.dead_ends, 'checked it again on an old ipad'], open: [] }, undefined, B);
  const merged = mergeCard(old, incoming, AT + 9000);
  const b = merged.body as CardBody;
  assert.equal(merged.id, old.id);
  assert.equal(merged.created, old.created);
  assert.equal(merged.origin.agent, 'Claude Code');
  assert.equal(merged.origin.at, AT + 9000);
  assert.equal(b.goal, 'Fixed it for good');
  assert.deepEqual(b.dead_ends, [p.dead_ends[0], 'checked it again on an old ipad']);
  assert.deepEqual(b.open, p.open);
  assert.deepEqual(b.decisions?.map((d) => d.what).sort(), [...p.decisions].sort());
  assert.equal(b.changed?.length, 2);
});

test('an unstated goal keeps the stored goal, and the merged card fits the item size', () => {
  const p = month(1).pieces[7].card;
  const old = card(p);
  const big = card({ ...p, goal: 'Not stated', open: Array.from({ length: 40 }, (_, k) => `follow up item number ${k} ${'x'.repeat(60)}`) }, undefined, B);
  const merged = mergeCard(old, big, AT + 1);
  assert.equal((merged.body as CardBody).goal, p.goal);
  assert.ok(itemBytes(merged) <= ITEM_BYTES);
  assert.ok(overlap(old, merged).contains > 0);
});
