import test from 'node:test';
import assert from 'node:assert/strict';
import { SAME_CONTAINS, SAME_JACCARD, SAME_MIN_TERMS, applyPlan, foldCard, foldPlan, isProtected, mergeCard, mergeFolded, overlap, sameCard, totalBytes, underCeiling } from '../src/fold.ts';
import { ITEM_BYTES, itemBytes, newItem, type Body, type CardBody, type Item, type Kind, type Origin } from '../src/model.ts';
import { MONTH_DAYS, MONTH_START, month, type Checkpoint, type Step } from './month.ts';

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

const apply = applyPlan;
const AT_80 = START + 80 * DAY;

test('totalBytes adds up the body sizes', () => {
  const a = card(1);
  const b = card(2);
  assert.equal(totalBytes([a, b]), itemBytes(a) + itemBytes(b));
  assert.equal(totalBytes([]), 0);
});

test('under the mark the plan is empty', () => {
  const items = [card(1), card(2)];
  const total = totalBytes(items);
  assert.deepEqual(foldPlan(items, Math.ceil(total / 0.8) + 10), { fold: [], merge: [], drop: [] });
  assert.deepEqual(foldPlan(items), { fold: [], merge: [], drop: [] });
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
  const oneLess = apply(items, { fold: plan.fold.slice(0, -1), merge: [], drop: [] });
  assert.ok(totalBytes(oneLess) >= 0.7 * limit);
});

test('pinned items and rules survive a plan that folds everything else', () => {
  const pinned = card(0, { pinned: true }, 1500);
  const rule = item('rule', { text: 'r'.repeat(1500), words: 'w'.repeat(200), scope: 'all', status: 'active', proof: 'page' }, 0);
  const handoff = item('handoff', { goal: 'Ship the firmware', next: 'n'.repeat(1500) }, 70);
  const others = Array.from({ length: 20 }, (_, k) => card(k + 1));
  const items = [pinned, rule, handoff, ...others];
  const limit = 6000;
  const plan = foldPlan(items, limit, 0.8, AT_80);
  const touched = new Set([...plan.fold, ...plan.merge.flatMap((m) => m.ids), ...plan.drop]);
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
  assert.deepEqual(plan.drop, []);
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

test('when fold and merge leave the total over the mark, the oldest folded cards are dropped', () => {
  const pinned = card(0, { pinned: true }, 1800);
  const cards = Array.from({ length: 40 }, (_, k) => card(k * 3));
  const items = [pinned, ...cards];
  const limit = Math.floor((itemBytes(pinned) + 1200) / 0.7);
  const plan = foldPlan(items, limit, 0.8, AT_80);
  assert.equal(plan.fold.length, 40);
  assert.ok(plan.drop.length > 0 && !plan.drop.includes(pinned.id));
  const dropped = new Set(plan.drop);
  const kept = cards.filter((c) => !dropped.has(c.id));
  assert.ok(kept.length > 0);
  assert.ok(Math.max(...cards.filter((c) => dropped.has(c.id)).map((c) => c.created)) <= Math.min(...kept.map((c) => c.created)));
  for (const m of plan.merge) assert.ok(!m.ids.some((id) => dropped.has(id)));
  const after = applyPlan(items, plan);
  assert.ok(totalBytes(after) < 0.8 * limit);
  assert.ok(after.includes(pinned));
});

test('old handoffs and old dropped items go after the folded cards, recent handoffs and rules never', () => {
  const now = START + 100 * DAY;
  const rule = item('rule', { text: 'r'.repeat(900), words: 'keep the anemometer cups clean', scope: 'project', status: 'active', proof: 'page' }, 1);
  const fresh = item('handoff', { goal: 'Fresh handoff', next: 'n'.repeat(900) }, 90);
  const stale = item('handoff', { goal: 'Stale handoff', next: 'n'.repeat(900) }, 20);
  const oldDrop = item('dropped', { label: 'prompt', text: 'd'.repeat(900), size: 900 }, 30);
  const newDrop = item('dropped', { label: 'prompt', text: 'd'.repeat(900), size: 900 }, 95);
  const cards = Array.from({ length: 5 }, (_, k) => card(k + 2));
  const items = [rule, fresh, stale, oldDrop, newDrop, ...cards];
  const protectedBytes = itemBytes(rule) + itemBytes(fresh);
  const plan = foldPlan(items, Math.floor(protectedBytes / 0.75), 0.8, now);
  assert.ok(cards.every((c) => plan.drop.includes(c.id)));
  assert.ok(plan.drop.includes(stale.id) && plan.drop.includes(oldDrop.id) && plan.drop.includes(newDrop.id));
  assert.ok(!plan.drop.includes(rule.id) && !plan.drop.includes(fresh.id));
  const soft = foldPlan(items, Math.floor((protectedBytes + itemBytes(newDrop) + 50) / 0.7), 0.8, now);
  assert.ok(soft.drop.includes(stale.id) && soft.drop.includes(oldDrop.id));
  assert.ok(!soft.drop.includes(newDrop.id));
  assert.equal(isProtected(fresh, now), true);
  assert.equal(isProtected(stale, now), false);
});

test('applyPlan folds, merges and drops without changing the input', () => {
  const items = [card(1), card(2), card(3), card(40)];
  const before = JSON.stringify(items);
  const out = applyPlan(items, { fold: [items[0].id, items[1].id, items[2].id], merge: [{ project: items[0].project, month: '2026-08', ids: [items[0].id, items[1].id] }], drop: [items[2].id] });
  assert.equal(JSON.stringify(items), before);
  assert.equal(out.length, 2);
  assert.equal(out[0].folded, true);
  assert.equal((out[0].body as CardBody).goal.split('\n').length, 2);
  assert.equal(out[1], items[3]);
});

test('30 MB of made up cards ends at or under 10 MB with every pinned item and active rule intact', () => {
  const MB = 1024 * 1024;
  const now = START + 400 * DAY;
  const filler = 'y'.repeat(1900);
  const projects = ['github.com/acme/gale-station', 'github.com/acme/pantry-notes', 'folder:rollcall'];
  const items: Item[] = [];
  let size = 0;
  const add = (i: Item) => {
    items.push(i);
    size += itemBytes(i);
  };
  let k = 0;
  while (size < 8.2 * MB) {
    add(item('card', { goal: `Pinned note ${k}`, decisions: [{ what: filler, why: 'kept on purpose' }] }, k % 390, { pinned: true, project: projects[k % 3] }));
    k++;
  }
  const rules = Array.from({ length: 60 }, (_, r) => item('rule', { text: `rule ${r}`, words: `always keep rule number ${r}`, scope: 'project', status: 'active', proof: 'hook' }, r, { project: projects[r % 3] }));
  for (const r of rules) add(r);
  while (size < 30 * MB) {
    add(item('card', { goal: `Card ${k} about readings, recipes or rosters`, decisions: [{ what: filler, why: 'made up' }] }, k % 390, { project: projects[k % 3] }));
    k++;
  }
  assert.equal(size, totalBytes(items));
  const plan = foldPlan(items, 10 * MB, 0.8, now);
  assert.ok(plan.fold.length > 0 && plan.drop.length > 0);
  const pinned = items.filter((i) => i.pinned);
  const { items: out, full } = underCeiling(items, 10 * MB, now);
  assert.ok(totalBytes(out) <= 10 * MB, String(totalBytes(out)));
  assert.equal(full, false);
  const kept = new Set(out);
  assert.ok(pinned.every((p) => kept.has(p)));
  assert.ok(rules.every((r) => kept.has(r)));
});

test('a store of 11 MB of pinned items alone gives full true and loses nothing', () => {
  const MB = 1024 * 1024;
  const filler = 'z'.repeat(1900);
  const items: Item[] = [];
  for (let k = 0, size = 0; size < 11 * MB; k++) {
    const i = item('card', { goal: `Pinned ${k}`, decisions: [{ what: filler }] }, k % 60, { pinned: true });
    items.push(i);
    size += itemBytes(i);
  }
  const { items: out, full } = underCeiling(items, 10 * MB, START + 100 * DAY);
  assert.equal(full, true);
  assert.equal(out.length, items.length);
  assert.ok(out.every((i, n) => i === items[n]));
});

test('a store under the mark comes back identical', () => {
  const items = [card(1), card(2), item('rule', { text: 'x', words: 'keep it short please', scope: 'all', status: 'active', proof: 'page' }, 3)];
  const { items: out, full } = underCeiling(items, 10 * 1024 * 1024, AT_80);
  assert.equal(full, false);
  assert.equal(out, items);
  assert.deepEqual(out, items);
});

test('a folded quarantined card stays held with its flags', () => {
  const bad = card(2, { held: true, flags: ['override'] });
  const f = foldCard(bad);
  assert.equal(f.held, true);
  assert.deepEqual(f.flags, ['override']);
});

test('a merged card keeps the hold and the flags of every member', () => {
  const group = [card(1), card(2, { held: true, flags: ['override'] }), card(3, { flags: ['markup'] })].map(foldCard);
  const m = mergeFolded(group);
  assert.equal(m.held, true);
  assert.deepEqual([...m.flags].sort(), ['markup', 'override']);
  const clean = mergeFolded([card(4), card(5)].map(foldCard));
  assert.equal(clean.held, false);
  assert.deepEqual(clean.flags, []);
});

test('a quarantined card stays held through a whole ceiling plan', () => {
  const items = [card(0, { held: true, flags: ['shell'] }), ...Array.from({ length: 30 }, (_, k) => card(k + 1))];
  const limit = Math.floor(totalBytes(items.map(foldCard)) / 1.05);
  const { items: out } = underCeiling(items, limit, AT_80);
  const goals = out.filter((i) => (i.body as CardBody).goal.includes('Calibrate sensor batch 0 '));
  assert.ok(goals.length >= 1);
  assert.ok(goals.every((i) => i.held && i.flags.includes('shell')));
});

{
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
}

const lines = (c: Checkpoint) => [...c.decisions, ...c.dead_ends, ...c.open];

test('the same seed gives the same month and another seed another month', () => {
  assert.deepEqual(month(1), month(1));
  assert.notDeepEqual(month(1).steps, month(2).steps);
});

for (const seed of [1, 2]) {
  test(`seed ${seed} holds the counts and labels the brief names`, () => {
    const m = month(seed);
    const of = (t: string) => m.steps.filter((s) => s.label.type === t);
    assert.equal(m.pieces.length, 60);
    assert.equal(of('distinct').length, 60);
    assert.equal(of('exact').length, 90);
    assert.equal(of('reworded').length, 90);
    assert.equal(of('chat').length, 60);
    assert.equal(of('recalled').length, 30);
    assert.deepEqual([0, 1].map((p) => m.pieces.filter((x) => x.project === p).length), [30, 30]);
    const twins = m.pieces.filter((p) => p.twin !== null && p.n < p.twin);
    assert.ok(twins.length >= 10);
    for (const a of twins) {
      const b = m.pieces[a.twin!];
      assert.equal(a.card.goal, b.card.goal);
      assert.deepEqual(a.card.changed, b.card.changed);
      assert.equal(a.facts.filter((f) => b.facts.includes(f)).length, 0);
    }
    for (let k = 1; k < m.steps.length; k++) assert.ok(m.steps[k].at >= m.steps[k - 1].at);
    for (const s of m.steps) assert.ok(s.at >= MONTH_START && s.at < MONTH_START + MONTH_DAYS * 86400000);
    const first = new Map(of('distinct').map((s) => [(s.label as { piece: number }).piece, s.at]));
    for (const s of [...of('exact'), ...of('reworded'), ...of('recalled')]) assert.ok(s.at > first.get((s.label as { piece: number }).piece)!);
    const who = new Set(m.steps.map((s) => s.who));
    assert.deepEqual([...who].sort(), [0, 1]);
  });

  test(`seed ${seed} rewords with the same facts, a new opening word and at most one line more or less`, () => {
    const m = month(seed);
    for (const s of m.steps.filter((x): x is Extract<Step, { kind: 'checkpoint' }> => x.kind === 'checkpoint' && x.label.type !== 'distinct')) {
      const p = m.pieces[(s.label as { piece: number }).piece];
      if (s.label.type === 'exact') {
        assert.deepEqual(s.card, p.card);
        continue;
      }
      assert.notEqual(s.card.goal.split(' ')[0], p.card.goal.split(' ')[0]);
      const had = lines(p.card);
      const has = lines(s.card);
      const lost = had.filter((l) => !has.includes(l)).length;
      const added = has.filter((l) => !had.includes(l)).length;
      assert.ok(lost + added <= 1, `${lost} ${added}`);
      assert.deepEqual([...s.card.changed].sort(), [...p.card.changed].sort());
    }
  });
}

test('chat sessions hold only short or quiet prompts', () => {
  for (const s of month(1).steps) if (s.kind === 'chat') for (const p of s.prompts) assert.ok(p.length < 15 || /^[/!#]/.test(p), p);
});
