import test from 'node:test';
import assert from 'node:assert/strict';
import { CALL_CHARS, FIRST_CHARS, FOLD_AT, ITEM_BYTES, RESULT_CHARS, RULE_MAX, RULE_MIN, RULE_PROMPT_MAX, RULES_AUTO_PER_DAY, RULES_SHOWN, STORE_BYTES, bytes, cut } from '../src/caps.ts';

test('the caps hold the values of the design', () => {
  assert.deepEqual(
    [ITEM_BYTES, RESULT_CHARS, CALL_CHARS, FIRST_CHARS, RULE_MIN, RULE_MAX, RULE_PROMPT_MAX, RULES_AUTO_PER_DAY, RULES_SHOWN, STORE_BYTES, FOLD_AT],
    [2048, 600, 2400, 3000, 12, 300, 800, 5, 10, 10485760, 0.8],
  );
});

test('cut leaves short text alone and never goes over the limit', () => {
  assert.equal(cut('short', 10), 'short');
  assert.equal(cut('exactly ten', 11), 'exactly ten');
  for (const n of [0, 1, 2, 5, 13, 40, 99]) {
    const s = cut('The station reports gusts every ten seconds now and the radio sleeps between them.', n);
    assert.ok(s.length <= n, `${n} ${s}`);
  }
});

test('cut ends at a word when one is near and marks the cut', () => {
  assert.equal(cut('alpha beta gamma delta', 13), 'alpha beta…');
  assert.equal(cut('abcdefghijklmnop', 8), 'abcdefg…');
});

test('cut never leaves half of a surrogate pair', () => {
  const grin = String.fromCodePoint(0x1f600);
  const s = cut(grin.repeat(10), 6);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s));
  assert.ok(s.length <= 6);
});

test('bytes is the UTF-8 length', () => {
  assert.equal(bytes(''), 0);
  assert.equal(bytes('abc'), 3);
  assert.equal(bytes(String.fromCodePoint(0xe9)), 2);
  assert.equal(bytes(String.fromCodePoint(0x2603)), 3);
  assert.equal(bytes(String.fromCodePoint(0x1f600)), 4);
});
