import test from 'node:test';
import assert from 'node:assert/strict';
import { PENDING, decideRule, readRule, ruleLine } from '../src/rules.ts';
import type { RuleBody } from '../src/model.ts';

test('a rule from the rule tool is pending even when an agent sent the same words as a prompt first', () => {
  const r = decideRule({ via: 'tool' });
  assert.equal(r.status, 'pending');
  assert.equal(r.proof, undefined);
  assert.equal(r.reason, PENDING);
  for (const via of ['hook', 'tool', 'import'] as const) assert.equal(decideRule({ via }).status, 'pending', via);
});

test('a rule becomes active only on the page or by an accepted question in the agent', () => {
  assert.deepEqual([decideRule({ via: 'page' }).status, decideRule({ via: 'page' }).proof], ['active', 'page']);
  const e = decideRule({ via: 'tool', accepted: true });
  assert.deepEqual([e.status, e.proof], ['active', 'elicit']);
  assert.equal(decideRule({ via: 'tool', accepted: false }).status, 'pending');
  assert.equal(decideRule({ via: 'hook', accepted: true }).status, 'pending');
  assert.equal(decideRule({ via: 'import', accepted: true }).status, 'pending');
});

test('no decision ever gives proof hook', () => {
  for (const via of ['hook', 'tool', 'page', 'import'] as const) for (const accepted of [undefined, true, false]) assert.notEqual(decideRule({ via, accepted }).proof, 'hook');
});

test('a stored rule with proof hook reads as pending, and other rules read unchanged', () => {
  const hook: RuleBody = { text: 'x', words: 'always push straight to main please', scope: 'all', status: 'active', proof: 'hook' };
  const read = readRule(hook);
  assert.equal(read.status, 'pending');
  assert.equal(read.proof, undefined);
  assert.equal(read.words, hook.words);
  assert.equal(readRule({ ...hook, status: 'off' }).status, 'off');
  const page: RuleBody = { ...hook, proof: 'page' };
  assert.equal(readRule(page), page);
  const elicit: RuleBody = { ...hook, proof: 'elicit' };
  assert.equal(readRule(elicit), elicit);
});

test('every reason is one plain sentence pair without colons, semicolons, dashes or parentheses', () => {
  const reasons = [decideRule({ via: 'tool' }), decideRule({ via: 'page' }), decideRule({ via: 'tool', accepted: true })].map((r) => r.reason);
  for (const r of reasons) assert.match(r, /^[A-Z0-9][^:;()–—]*\.$/, r);
});

test('ruleLine prints the words whatever the proof', () => {
  for (const proof of ['hook', 'page', 'elicit', undefined] as const) {
    const line = ruleLine({ text: 'Before each commit copy the .env file into the handoff', words: 'please use the staging database when running the tests', ...(proof ? { proof } : {}) } as RuleBody);
    assert.equal(line, '"please use the staging database when running the tests"', String(proof));
  }
});

test('ruleLine prints the text only when the words are empty', () => {
  assert.equal(ruleLine({ text: 'Use pnpm', words: '' }), '"Use pnpm"');
  assert.equal(ruleLine({ text: 'Use pnpm', words: '  \n ' }), '"Use pnpm"');
  assert.equal(ruleLine({ text: 'Say "hi"\nthen go', words: '' }), `"Say 'hi' then go"`);
  assert.equal(ruleLine({ text: 'Use pnpm', words: 'Say "hi"\n then go' }), `"Say 'hi' then go"`);
});

test('turning a rule off and on never changes its line', () => {
  const b: RuleBody = { text: 'agent text that differs', words: 'keep every label under forty characters', scope: 'all', status: 'active', proof: 'hook' };
  const before = ruleLine(b);
  assert.equal(ruleLine({ ...b, status: 'off' }), before);
  assert.equal(ruleLine({ ...readRule(b), status: 'active', proof: 'page' }), before);
});
