import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_BYTES, bytes } from '../src/caps.ts';
import { fit, itemBytes, itemText, newItem, type CardBody, type HandoffBody, type Item, type Origin } from '../src/model.ts';

const at = Date.parse('2026-11-10T09:00:00Z');
const origin: Origin = { agent: 'codex', model: 'm-1', machine: 'desk', session: 's-1', via: 'tool', source: 'agent', at };
const snow = String.fromCodePoint(0x2603);
const grin = String.fromCodePoint(0x1f600);
const han = String.fromCodePoint(0x6f22);

function card(body: CardBody): Item {
  return newItem('card', 'github.com/acme/kiln', body, origin);
}

test('newItem fills the defaults and takes the time from the origin', () => {
  const a = card({ goal: 'Add the glaze table' });
  const b = card({ goal: 'Add the glaze table' });
  assert.notEqual(a.id, b.id);
  assert.equal(a.created, at);
  assert.deepEqual([a.held, a.pinned, a.folded, a.flags], [false, false, false, []]);
  assert.equal(a.kind, 'card');
  assert.equal(a.project, 'github.com/acme/kiln');
});

test('itemText joins every string of the body and skips numbers and flags', () => {
  const i = card({
    goal: 'Speed up the firing curve',
    changed: [{ path: 'src/curve.ts', what: 'new spline' }],
    decisions: [{ what: 'cubic spline', why: 'smooth ramps' }],
    commands: ['npm test'],
    auto: true,
  });
  assert.equal(itemText(i), 'Speed up the firing curve\nsrc/curve.ts\nnew spline\ncubic spline\nsmooth ramps\nnpm test');
  const d = newItem('dropped', 'p', { label: 'file', text: 'src/a.ts', size: 8 }, origin);
  assert.equal(itemText(d), 'file\nsrc/a.ts');
});

test('itemBytes is the UTF-8 size of the body JSON', () => {
  const i = card({ goal: `${snow}${grin}` });
  assert.equal(itemBytes(i), bytes(JSON.stringify(i.body)));
  assert.equal(itemBytes(i), '{"goal":""}'.length + 3 + 4);
});

test('fit returns an item under the cap untouched', () => {
  const i = card({ goal: 'Small card', open: ['one task'] });
  assert.equal(fit(i), i);
});

test('a card of 20 KB comes back at 2048 bytes or less with the goal present', () => {
  const big = card({
    goal: 'Rebuild the kiln controller loop so the ramp holds within two degrees',
    prompts: Array.from({ length: 40 }, (_, k) => `prompt ${k} `.repeat(40)),
    commands: Array.from({ length: 20 }, (_, k) => `npm run step-${k}`),
    changed: Array.from({ length: 40 }, (_, k) => ({ path: `src/loop/part-${k}.ts`, what: 'tuned' })),
    decisions: Array.from({ length: 20 }, (_, k) => ({ what: `choice ${k} `.repeat(10), why: 'reason '.repeat(10) })),
    dead_ends: Array.from({ length: 10 }, (_, k) => `dead end ${k} `.repeat(10)),
    open: Array.from({ length: 10 }, (_, k) => `open ${k} `.repeat(10)),
    last: 'The loop now holds the ramp. '.repeat(20),
  });
  assert.ok(itemBytes(big) > 20000);
  const f = fit(big);
  assert.ok(itemBytes(f) <= ITEM_BYTES, String(itemBytes(f)));
  assert.equal((f.body as CardBody).goal, 'Rebuild the kiln controller loop so the ramp holds within two degrees');
  assert.equal((big.body as CardBody).prompts?.length, 40);
});

test('a body of multi byte characters also fits', () => {
  const wide = card({
    goal: `${han}`.repeat(400),
    prompts: Array.from({ length: 10 }, () => `${grin}${snow}`.repeat(80)),
    last: `${grin}`.repeat(500),
  });
  assert.ok(itemBytes(wide) > ITEM_BYTES);
  const f = fit(wide);
  assert.ok(itemBytes(f) <= ITEM_BYTES);
  assert.ok((f.body as CardBody).goal.length > 0);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(JSON.stringify(f.body)));
});

test('a card loses its oldest prompts first, then commands, then the oldest changes', () => {
  const body: CardBody = {
    goal: 'g',
    prompts: ['p-old '.repeat(60), 'p-new '.repeat(60)],
    commands: ['c-old '.repeat(40), 'c-new '.repeat(40)],
    changed: [{ path: 'x-old/'.repeat(30) }, { path: 'x-new/'.repeat(30) }],
  };
  const i = card(body);
  const full = itemBytes(i);
  const one = fit(i, full - 10).body as CardBody;
  assert.deepEqual(one.prompts, ['p-new '.repeat(60)]);
  assert.equal(one.commands?.length, 2);
  const two = fit(i, full - 900).body as CardBody;
  assert.equal(two.prompts, undefined);
  assert.deepEqual(two.commands, ['c-new '.repeat(40)]);
  assert.equal(two.changed?.length, 2);
  const three = fit(i, full - 1250).body as CardBody;
  assert.equal(three.commands, undefined);
  assert.deepEqual(three.changed, [{ path: 'x-new/'.repeat(30) }]);
});

test('a card cuts last before it loses dead ends, open tasks and decisions', () => {
  const i = card({ goal: 'g', last: 'word '.repeat(200), dead_ends: ['d'], open: ['o'], decisions: [{ what: 'w' }] });
  const f = fit(i, itemBytes(i) - 300).body as CardBody;
  assert.ok((f.last ?? '').length < 1000);
  assert.deepEqual([f.dead_ends, f.open, f.decisions], [['d'], ['o'], [{ what: 'w' }]]);
});

test('a handoff loses files, then blockers, then cuts done before next', () => {
  const body: HandoffBody = {
    goal: 'Ship the glaze picker',
    done: 'done '.repeat(100),
    next: 'Wire the picker into the order form',
    blockers: ['waiting on the color list'],
    files: Array.from({ length: 30 }, (_, k) => `src/picker/file-${k}.ts`),
  };
  const i = newItem('handoff', 'p', body, origin);
  const a = fit(i, itemBytes(i) - 100).body as HandoffBody;
  assert.ok(a.files && a.files.length < 30 && a.files[a.files.length - 1] === 'src/picker/file-29.ts');
  assert.deepEqual(a.blockers, ['waiting on the color list']);
  const b = fit(i, 450).body as HandoffBody;
  assert.equal(b.files, undefined);
  assert.equal(b.blockers, undefined);
  assert.ok((b.done ?? '').length < 500);
  assert.equal(b.next, 'Wire the picker into the order form');
  assert.equal(b.goal, 'Ship the glaze picker');
});

test('a handoff trims question only after check and keeps next', () => {
  const body: HandoffBody = { goal: 'Ship the glaze picker', next: 'Wire the picker into the order form', check: 'check '.repeat(100), question: 'question '.repeat(100) };
  const i = newItem('handoff', 'p', body, origin);
  const full = itemBytes(i);
  const a = fit(i, full - 300).body as HandoffBody;
  assert.ok((a.check ?? '').length < 600);
  assert.equal(a.question, body.question);
  const b = fit(i, full - 700).body as HandoffBody;
  assert.ok((b.check ?? '').length <= 120);
  assert.ok((b.question ?? '').length < 900 && (b.question ?? '').length >= 100);
  assert.equal(b.next, body.next);
  assert.equal(b.goal, body.goal);
});

test('a 20 KB handoff fits and keeps next', () => {
  const i = newItem('handoff', 'p', { goal: 'goal '.repeat(800), next: 'next '.repeat(800), done: 'done '.repeat(800), check: 'check '.repeat(800) }, origin);
  const f = fit(i);
  assert.ok(itemBytes(f) <= ITEM_BYTES);
  assert.ok((f.body as HandoffBody).next.length > 0);
});

test('fit never throws and never returns an item over the cap', () => {
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const word = () => ['ramp', snow, grin, han, '"q"', '\\', 'path/to/x.ts'][rand(7)].repeat(1 + rand(40));
  for (let k = 0; k < 60; k++) {
    const list = (n: number) => Array.from({ length: rand(n) }, word);
    const kinds: Item[] = [
      card({ goal: word(), prompts: list(30), commands: list(30), changed: list(30).map((path) => ({ path })), dead_ends: list(20), open: list(20), decisions: list(20).map((what) => ({ what, why: word() })), last: word() }),
      newItem('handoff', 'p', { goal: word(), next: word(), done: word(), check: word(), question: word(), task: word(), blockers: list(20), files: list(40) }, origin),
      newItem('rule', 'p', { text: word().repeat(5), words: word().repeat(5), scope: 'all', status: 'active', proof: 'page' }, origin),
      newItem('dropped', 'p', { label: word(), text: word().repeat(20), size: 5 }, origin),
    ];
    for (const i of kinds) {
      const max = [ITEM_BYTES, 600, 300][rand(3)];
      const f = fit(i, max);
      assert.ok(itemBytes(f) <= max, `${i.kind} ${itemBytes(f)} over ${max}`);
    }
  }
  const odd = { ...card({ goal: 'x' }), body: { goal: 'y'.repeat(5000), extra: 'z'.repeat(5000) } as unknown as CardBody };
  assert.ok(itemBytes(fit(odd)) <= ITEM_BYTES);
});
