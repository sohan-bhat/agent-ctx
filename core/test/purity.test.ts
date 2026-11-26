import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('no file under core/src touches a Node or host API', () => {
  const list = files(SRC);
  assert.ok(list.length >= 12);
  for (const f of list) {
    const text = fs.readFileSync(f, 'utf8');
    for (const banned of ['node:', 'process.', 'Buffer']) assert.ok(!text.includes(banned), `${path.basename(f)} holds ${banned}`);
  }
});
