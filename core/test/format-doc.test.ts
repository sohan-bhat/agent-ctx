import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEM_BYTES, STORE_BYTES } from '../src/model.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const doc = fs.readFileSync(path.join(here, '..', '..', 'docs', 'format.md'), 'utf8');
const model = fs.readFileSync(path.join(here, '..', 'src', 'model.ts'), 'utf8');

function body(name: string): string {
  const m = new RegExp(`export interface ${name} \\{([^}]*)\\}`).exec(model);
  assert.ok(m, `interface ${name} in model.ts`);
  return m[1];
}

function keysOf(name: string): string[] {
  return body(name)
    .split(';')
    .map((s) => /^\s*(\w+)\??\s*:/.exec(s)?.[1])
    .filter((k): k is string => !!k);
}

function valuesOf(name: string): string[] {
  const m = new RegExp(`export type ${name} = ([^;]*);`).exec(model);
  assert.ok(m, `type ${name} in model.ts`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function section(title: string): string {
  const parts = doc.split(/^## /m);
  const hit = parts.find((p) => p.split('\n')[0].trim() === title);
  assert.ok(hit, `section ${title} in docs/format.md`);
  return hit;
}

const has = (text: string, word: string) => text.includes('`' + word + '`');

const KINDS: [string, string, string][] = [
  ['card', 'CardBody', 'Body of a card'],
  ['handoff', 'HandoffBody', 'Body of a handoff'],
  ['rule', 'RuleBody', 'Body of a rule'],
  ['dropped', 'DroppedBody', 'Body of a dropped item'],
];

test('every key of Item and Origin is in its own section of the doc', () => {
  for (const k of keysOf('Item')) assert.ok(has(section('Item'), k), `Item.${k}`);
  for (const k of keysOf('Origin')) assert.ok(has(section('Origin'), k), `Origin.${k}`);
});

test('every key of every body kind is in the table of that kind', () => {
  for (const [, iface, title] of KINDS) for (const k of keysOf(iface)) assert.ok(has(section(title), k), `${iface}.${k}`);
  for (const k of keysOf('Change')) assert.ok(has(section('Body of a card'), `changed[].${k}`), `Change.${k}`);
  for (const k of keysOf('Decision')) assert.ok(has(section('Body of a card'), `decisions[].${k}`), `Decision.${k}`);
});

test('every allowed value of Kind, Via, Source and the rule fields is in the doc', () => {
  assert.deepEqual(valuesOf('Kind'), KINDS.map((k) => k[0]));
  for (const v of valuesOf('Kind')) assert.ok(has(section('Item'), v), `Kind ${v}`);
  for (const v of valuesOf('Via')) assert.ok(section('Origin').includes(`| \`${v}\` |`), `Via ${v}`);
  for (const v of valuesOf('Source')) assert.ok(section('Origin').includes(`| \`${v}\` |`), `Source ${v}`);
  for (const v of [...body('RuleBody').matchAll(/'([^']+)'/g)].map((x) => x[1])) assert.ok(has(section('Body of a rule'), v), `rule value ${v}`);
});

test('the caps in the doc equal ITEM_BYTES and STORE_BYTES', () => {
  const cap = (name: string) => Number(new RegExp(`\\|\\s*${name}\\s*\\|\\s*(\\d+) bytes\\s*\\|`).exec(section('Size caps'))?.[1]);
  assert.equal(cap('Item body'), ITEM_BYTES);
  assert.equal(cap('Store'), STORE_BYTES);
});

test('each example line parses as JSON, has a known kind and only known keys', () => {
  const blocks = [...doc.matchAll(/```jsonl\n([\s\S]*?)```/g)].map((m) => m[1]);
  const lines = blocks.flatMap((b) => b.split('\n')).filter((l) => l.trim());
  assert.ok(lines.length >= 4);
  const kinds = new Map(KINDS.map(([kind, iface]) => [kind, keysOf(iface)]));
  const seen = new Set<string>();
  for (const line of lines) {
    const item = JSON.parse(line);
    assert.ok(kinds.has(item.kind), `kind ${item.kind}`);
    seen.add(item.kind);
    assert.deepEqual(Object.keys(item), keysOf('Item'));
    for (const k of Object.keys(item.body)) assert.ok(kinds.get(item.kind)!.includes(k), `${item.kind} body key ${k}`);
    for (const k of Object.keys(item.origin)) assert.ok(keysOf('Origin').includes(k), `origin key ${k}`);
    assert.ok(valuesOf('Via').includes(item.origin.via) && valuesOf('Source').includes(item.origin.source));
  }
  assert.deepEqual([...seen].sort(), valuesOf('Kind').sort());
});

test('the doc names its format version', () => {
  assert.match(section('Version'), /^Format 1\.$/m);
});
