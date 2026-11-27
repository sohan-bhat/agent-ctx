import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test as plainTest } from 'node:test';
import { gunzipSync } from 'node:zlib';
import type { Engine } from '../../service/src/engine.ts';
import { caller, open } from '../src/db.ts';
import { MAIN, ROOT, hook, place, rows, run, server, type Place } from './kit.ts';

const TMP = mkdtempSync(join(tmpdir(), 'agent-ctx-sync-'));
const OLD = join(ROOT, 'local', 'test', 'before-mirror.db.gz');
const KILN = '/work/kiln';
const COLUMNS = 'id, project, kind, body, origin, flags, held, pinned, folded, created, bytes';

after(() => rmSync(TMP, { recursive: true, force: true }));

function test(name: string, fn: () => void | Promise<void>, skip = false): void {
  void plainTest(name, { timeout: 180000, skip }, fn);
}

async function engine<T>(where: Place, fn: (engine: Engine) => T | Promise<T>): Promise<T> {
  const before = process.env.AGENT_CTX_HOME;
  process.env.AGENT_CTX_HOME = where.AGENT_CTX_HOME;
  const db = open();
  try {
    return await caller(db)(async (e) => fn(e));
  } finally {
    db.close();
    if (before === undefined) delete process.env.AGENT_CTX_HOME;
    else process.env.AGENT_CTX_HOME = before;
  }
}

const columns = (where: Place): string[] => rows<{ name: string }>(where, 'PRAGMA table_info(items)').map((c) => c.name);

test('a memory file made by the program before this build opens with every row, and the creation time stands for the missing time of the last change', async () => {
  const where = place(TMP);
  mkdirSync(where.AGENT_CTX_HOME, { recursive: true });
  writeFileSync(join(where.AGENT_CTX_HOME, 'memory.db'), gunzipSync(readFileSync(OLD)));
  assert.deepEqual([columns(where).includes('updated'), rows<{ user_version: number }>(where, 'PRAGMA user_version')[0].user_version], [false, 1]);
  const items = rows<{ id: string; created: number; kind: string }>(where, `SELECT ${COLUMNS} FROM items ORDER BY id`);
  const kept = ['events', 'sessions', 'projects', 'paths', 'aliases', 'agents'].map((table) => rows(where, `SELECT * FROM ${table} ORDER BY 1, 2`));
  assert.deepEqual([items.length, items.filter((i) => i.kind === 'rule').length, (kept[0] as unknown[]).length], [7, 2, 3]);
  const said = run(MAIN, ['rules'], where);
  assert.deepEqual([said.code, said.err, said.out.split('\n')[0]], [0, '', '2 rules are pending.']);
  assert.deepEqual(columns(where).slice(-2), ['updated', 'taken']);
  assert.equal(rows<{ user_version: number }>(where, 'PRAGMA user_version')[0].user_version, 1);
  assert.deepEqual(rows(where, `SELECT ${COLUMNS} FROM items ORDER BY id`), items);
  assert.deepEqual(['events', 'sessions', 'projects', 'paths', 'aliases', 'agents'].map((table) => rows(where, `SELECT * FROM ${table} ORDER BY 1, 2`)), kept);
  const text = (await server(where, 'codex', [['recall', { folder: KILN }]]))[0];
  assert.match(text, /\nHANDOFF from claude-code on \d{4}-\d{2}-\d{2}[^\n]*\n> goal: Load the kiln shelf with the test tiles\n/);
  assert.ok(text.includes('Glaze the kiln shelf'), text);
  const changed = await engine(where, (e) => e.changes(0));
  assert.deepEqual(changed.items.map((i) => [i.id, i.updated]).sort(), items.map((i) => [i.id, i.created]).sort());
  assert.deepEqual([changed.hidden, changed.removed], [[], []]);
  const card = items.find((i) => i.kind === 'card') as { id: string; created: number };
  await engine(where, (e) => e.pin(card.id, true));
  const later = await engine(where, (e) => e.changes(Math.max(...items.map((i) => i.created))));
  assert.deepEqual(later.items.map((i) => [i.id, i.pinned, i.updated > card.created]), [[card.id, true, true]]);
  assert.equal(hook(where, 'claude-code', { hook_event_name: 'Stop', session_id: 's-1', cwd: KILN, last_assistant_message: 'The tiles are fired.' }).code, 0);
  assert.equal(rows<{ n: number }>(where, 'SELECT COUNT(*) AS n FROM items')[0].n, 7);
});
