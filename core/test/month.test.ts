import test from 'node:test';
import assert from 'node:assert/strict';
import { MONTH_DAYS, MONTH_START, month, type Checkpoint, type Step } from './month.ts';

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
