import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX } from '../service/src/limits.ts';
import { ITEM_BYTES, STORE_BYTES } from '../core/src/caps.ts';

const doc = readFileSync(new URL('../docs/cost.md', import.meta.url), 'utf8');
const num = (x: number) => x.toLocaleString('en-US');

function section(title: string): string {
  const start = doc.indexOf(`## ${title}`);
  assert.ok(start >= 0, title);
  const rest = doc.slice(start + 3 + title.length);
  const end = rest.indexOf('\n## ');
  return end >= 0 ? rest.slice(0, end) : rest;
}

test('the limits in cost.md are exactly the constants the service enforces', () => {
  assert.equal(MAX.storeBytes, STORE_BYTES);
  const want = [
    `${num(MAX.perMinute)} calls a minute`,
    `${num(MAX.perDay)} calls a day`,
    `${num(MAX.storedPerDay)} stored items a day`,
    `${num(MAX.agents)} connected agents`,
    `${num(ITEM_BYTES)} bytes an item`,
    `${num(MAX.storeBytes)} bytes a person`,
    `${num(MAX.inputBytes)} bytes of input a call`,
  ];
  const limits = section('Limits per account');
  const lines = limits.split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(lines, want.map((w) => `- ${w}`));
});

test('cost.md follows the copy rules', () => {
  const prose = doc
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('|') && !l.startsWith('#'));
  for (const l of prose) {
    assert.equal(/[–—;()]/.test(l), false, l);
    assert.equal(/\p{L}: /u.test(l), false, l);
    assert.equal(/ - /.test(l), false, l);
  }
});
