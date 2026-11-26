import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorDocs } from '../service/vendor-docs.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = readFileSync(join(ROOT, 'docs', 'vendors.md'), 'utf8');

function rows(): string[][] {
  return DOC.split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| Product') && !l.startsWith('|---'))
    .map((l) => l.slice(2, -2).split(' | '));
}

function redirectForm(uri: string): string {
  const u = new URL(uri);
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  return loopback && !u.port ? `${u.protocol}//${u.hostname}:PORT${u.pathname}` : uri;
}

test('every vendor fixture has one row that names its document, its file and every redirect it lists', () => {
  const docs = vendorDocs(join(ROOT, 'service', 'test', 'fixtures', 'vendors'));
  assert.equal(docs.size, 4);
  for (const [clientId, v] of docs) {
    const row = rows().filter((r) => r[1].includes(clientId));
    assert.equal(row.length, 1, clientId);
    assert.ok(row[0][1].includes(v.file), `${clientId} names ${v.file}`);
    for (const uri of v.doc.redirect_uris as string[]) assert.ok(row[0][2].includes(redirectForm(uri)), `${clientId} lists ${uri}`);
    assert.match(v.file, /^[a-z]+(?:-[a-z]+)*\.\d{4}-\d{2}-\d{2}\.json$/);
  }
  const named = rows().filter((r) => r[1].startsWith('Metadata document'));
  assert.equal(named.length, docs.size);
});

test('the table keeps four columns and the copy rules', () => {
  for (const r of rows()) assert.equal(r.length, 4, r.join(' | '));
  const prose = DOC.replace(/[a-z]+:\/\/\S+/g, '').replace(/`[^`]*`/g, '');
  assert.doesNotMatch(prose, /[;()–—]|\w: /);
});

const COPY = [
  'README.md',
  'AGENTS.md',
  'docs/format.md',
  'docs/cost.md',
  'docs/vendors.md',
  'plugins/src/claude-code/README.md',
  'plugins/src/codex/README.md',
  'plugins/claude-code/README.md',
  'plugins/codex/README.md',
];

function proseLines(text: string): string[] {
  return text
    .replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, '')
    .split('\n')
    .filter((l) => !/^(?: {4}|\t)/.test(l) && !/^\|(?:\s*:?-+:?\s*\|)+$/.test(l))
    .map((l) => l.replace(/`[^`\n]*`/g, ''));
}

test('the nine documents have no it, its, itself, dashes, semicolons or parentheses in prose', () => {
  for (const file of COPY) {
    for (const line of proseLines(readFileSync(join(ROOT, file), 'utf8'))) {
      assert.doesNotMatch(line, /\b(?:it|its|itself|it's)\b|[–—;()]/i, `${file} ${line}`);
    }
  }
});
