import test from 'node:test';
import assert from 'node:assert/strict';
import { foldCard, foldPlan, mergeFolded, totalBytes } from '../src/fold.ts';
import { ITEM_BYTES } from '../src/caps.ts';
import { itemBytes, type Body, type CardBody, type Item, type Kind } from '../src/model.ts';

const DAY = 86400000;
const START = Date.parse('2026-08-01T00:00:00Z');

let n = 0;
function item(kind: Kind, body: Body, day: number, extra: Partial<Item> = {}): Item {
  const at = START + day * DAY;
  return {
    id: `${kind}-${String(++n).padStart(3, '0')}`,
    project: 'github.com/acme/gale-station',
    kind,
    body,
    origin: { agent: 'codex', model: 'm-2', machine: 'bench', session: `s-${n}`, via: 'hook', source: 'agent', at },
    flags: [],
    held: false,
    pinned: false,
    folded: false,
    created: at,
    ...extra,
  };
}

function card(day: number, extra: Partial<Item> = {}, size = 900): Item {
  return item('card', { goal: `Calibrate sensor batch ${day} so the wind readings match the reference mast`, decisions: [{ what: 'x'.repeat(size), why: 'drift' }], open: ['check the humidity offset'] }, day, extra);
}

function apply(items: Item[], plan: ReturnType<typeof foldPlan>): Item[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const id of plan.fold) byId.set(id, foldCard(byId.get(id)!));
  for (const m of plan.merge) {
    const group = m.ids.map((id) => byId.get(id)!);
    for (const id of m.ids) byId.delete(id);
    const merged = mergeFolded(group);
    byId.set(merged.id, merged);
  }
  return [...byId.values()];
}

test('totalBytes adds up the body sizes', () => {
  const a = card(1);
  const b = card(2);
  assert.equal(totalBytes([a, b]), itemBytes(a) + itemBytes(b));
  assert.equal(totalBytes([]), 0);
});

test('under the mark the plan is empty', () => {
  const items = [card(1), card(2)];
  const total = totalBytes(items);
  assert.deepEqual(foldPlan(items, Math.ceil(total / 0.8) + 10), { fold: [], merge: [] });
  assert.deepEqual(foldPlan(items), { fold: [], merge: [] });
});

test('foldCard keeps the date, the agent and the goal cut to 120, and drops the rest', () => {
  const c = item('card', { goal: 'Rewrite the gust detector '.repeat(10), changed: [{ path: 'src/gust.c' }], last: 'done', auto: true }, 3);
  const f = foldCard(c);
  assert.equal(f.folded, true);
  assert.equal(f.created, c.created);
  assert.equal(f.id, c.id);
  assert.deepEqual(Object.keys(f.body), ['goal']);
  assert.ok((f.body as CardBody).goal.length <= 120 && (f.body as CardBody).goal.startsWith('Rewrite the gust detector'));
  assert.deepEqual(f.origin, { agent: 'codex', via: 'hook', source: 'agent', at: c.origin.at });
  assert.equal(c.folded, false);
});

test('over the mark the oldest unpinned cards fold until the total sits under 0.7 of the limit', () => {
  const items = Array.from({ length: 30 }, (_, k) => card(k));
  const total = totalBytes(items);
  const limit = Math.floor(total / 0.85);
  const plan = foldPlan(items, limit);
  assert.ok(plan.fold.length > 0 && plan.fold.length < 30);
  assert.deepEqual(plan.fold, items.slice(0, plan.fold.length).map((i) => i.id));
  assert.deepEqual(plan.merge, []);
  const after = totalBytes(apply(items, plan));
  assert.ok(after < 0.7 * limit);
  const oneLess = apply(items, { fold: plan.fold.slice(0, -1), merge: [] });
  assert.ok(totalBytes(oneLess) >= 0.7 * limit);
});

test('pinned items and rules survive a plan that folds everything else', () => {
  const pinned = card(0, { pinned: true }, 1500);
  const rule = item('rule', { text: 'r'.repeat(1500), words: 'w'.repeat(200), scope: 'all', status: 'active', proof: 'page' }, 0);
  const handoff = item('handoff', { goal: 'Ship the firmware', next: 'n'.repeat(1500) }, 70);
  const others = Array.from({ length: 20 }, (_, k) => card(k + 1));
  const items = [pinned, rule, handoff, ...others];
  const limit = 6000;
  const plan = foldPlan(items, limit, 0.8);
  const touched = new Set([...plan.fold, ...plan.merge.flatMap((m) => m.ids)]);
  assert.ok(!touched.has(pinned.id) && !touched.has(rule.id) && !touched.has(handoff.id));
  assert.deepEqual(new Set(plan.fold), new Set(others.map((i) => i.id)));
  const after = apply(items, plan);
  assert.ok(after.includes(pinned) && after.includes(rule) && after.includes(handoff));
});

test('when folding is not enough, folded cards merge per project and month, oldest month first', () => {
  const a = Array.from({ length: 12 }, (_, k) => card(k * 5));
  const b = Array.from({ length: 12 }, (_, k) => card(k * 5 + 1, { project: 'folder:recipes' }));
  const items = [...a, ...b];
  const folded = items.map(foldCard);
  const limit = totalBytes(folded);
  const plan = foldPlan(items, limit);
  assert.equal(plan.fold.length, 24);
  assert.ok(plan.merge.length > 0);
  const months = plan.merge.map((m) => m.month);
  assert.deepEqual(months, [...months].sort());
  assert.equal(months[0], '2026-08');
  for (const m of plan.merge) {
    const group = items.filter((i) => m.ids.includes(i.id));
    assert.ok(group.length >= 2);
    assert.ok(group.every((i) => i.project === m.project && new Date(i.created).toISOString().startsWith(m.month)));
  }
  const after = apply(items, plan);
  assert.ok(totalBytes(after) < 0.8 * limit);
});

test('the total after applying a plan sits under the mark', () => {
  for (const [count, div] of [[40, 0.9], [40, 1.5], [60, 3]] as const) {
    const items = Array.from({ length: count }, (_, k) => card(k % 50, k % 3 ? {} : { project: 'folder:club' }));
    const limit = Math.floor(totalBytes(items) / div);
    const after = apply(items, foldPlan(items, limit));
    assert.ok(totalBytes(after) < 0.8 * limit, `${count} ${div}`);
  }
});

test('mergeFolded lists the goals cut to 60 each in one folded card that fits', () => {
  const group = [card(3), card(1), card(2)].map(foldCard);
  const m = mergeFolded(group);
  assert.equal(m.kind, 'card');
  assert.equal(m.folded, true);
  assert.equal(m.created, group[1].created);
  const goals = (m.body as CardBody).goal.split('\n');
  assert.equal(goals.length, 3);
  assert.ok(goals[0].startsWith('Calibrate sensor batch 1') && goals.every((g) => g.length <= 60));
  const many = Array.from({ length: 80 }, (_, k) => foldCard(card(k)));
  assert.ok(itemBytes(mergeFolded(many)) <= ITEM_BYTES);
  const again = mergeFolded([m, foldCard(card(4))]);
  assert.equal((again.body as CardBody).goal.split('\n').length, 4);
});
