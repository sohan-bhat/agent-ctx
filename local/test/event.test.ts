import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test as plainTest } from 'node:test';
import { FOOTER, HEADER } from '../../core/src/index.ts';
import { MAX, SAY } from '../../service/src/limits.ts';
import { CAPS, local } from '../src/db.ts';
import { HOOK, MAIN, hook, place, rows, run, server, type Json, type Place } from './kit.ts';

const TMP = mkdtempSync(join(tmpdir(), 'agent-ctx-event-'));
const KILN = '/work/kiln';
const ASK = 'Glaze the kiln shelf with the cone 6 mix';
const REPLY = 'The shelf is glazed and the kiln is loaded.';
const CURSOR = { CURSOR_VERSION: '3.2.0' };
const SILENT = { code: 0, out: '', err: '' };

after(() => rmSync(TMP, { recursive: true, force: true }));

function test(name: string, fn: () => void | Promise<void>): void {
  void plainTest(name, { timeout: 120000 }, fn);
}

const claude = (name: string, more: Json = {}, session = 's-1'): Json => ({ session_id: session, transcript_path: '/work/log/turns.jsonl', cwd: KILN, permission_mode: 'default', hook_event_name: name, ...more });
const cursor = (name: string, more: Json = {}, session = 'c-3'): Json => ({ conversation_id: session, generation_id: 'g-1', model: 'model-c', hook_event_name: name, cursor_version: '3.2.0', workspace_roots: [KILN], ...more });
const made = (tool: string, input: Json): Json => ({ tool_name: tool, tool_input: input, tool_use_id: 'use-1', tool_response: { stdout: 'tool-result-text' } });
const quiet = (r: { code: number | null; out: string; err: string }): { code: number | null; out: string; err: string } => ({ code: r.code, out: r.out, err: r.err });
const count = (where: Place, table: string): number => (existsSync(join(where.AGENT_CTX_HOME, 'memory.db')) ? rows<{ n: number }>(where, `SELECT COUNT(*) AS n FROM ${table}`)[0].n : 0);
const context = (out: string): string => (JSON.parse(out) as { additional_context: string }).additional_context;

function session(where: Place): void {
  assert.deepEqual(quiet(hook(where, 'claude-code', claude('UserPromptSubmit', { prompt: ASK }))), SILENT);
  assert.deepEqual(quiet(hook(where, 'claude-code', claude('PostToolUse', made('Write', { file_path: `${KILN}/glaze.md`, content: 'cone 6' })))), SILENT);
  assert.deepEqual(quiet(hook(where, 'claude-code', claude('Stop', { last_assistant_message: REPLY }))), SILENT);
}

test('a Claude Code session is stored by three hook runs and the next session gets the handoff as plain text', () => {
  const where = place(TMP);
  session(where);
  assert.deepEqual(rows<{ t: string; text: string | null; path: string | null }>(where, 'SELECT t, text, path FROM events ORDER BY at, t'), [
    { t: 'prompt', text: ASK, path: null },
    { t: 'edit', text: null, path: `${KILN}/glaze.md` },
    { t: 'stop', text: REPLY, path: null },
  ]);
  assert.deepEqual(rows<{ kind: string; agent: string; via: string }>(where, "SELECT kind, json_extract(origin, '$.agent') AS agent, json_extract(origin, '$.via') AS via FROM items ORDER BY kind"), [
    { kind: 'card', agent: 'claude-code', via: 'hook' },
    { kind: 'handoff', agent: 'claude-code', via: 'hook' },
  ]);
  assert.equal(readFileSync(join(where.AGENT_CTX_HOME, 'memory.db')).includes('tool-result-text'), false);
  const next = hook(where, 'claude-code', claude('UserPromptSubmit', { prompt: 'continue' }, 's-2'));
  assert.deepEqual([next.code, next.err], [0, '']);
  const lines = next.out.split('\n');
  assert.equal(lines[0], HEADER.replace('NAME', 'kiln'));
  assert.equal(lines[lines.length - 1], FOOTER);
  assert.match(next.out, /\nHANDOFF from claude-code on \d{4}-\d{2}-\d{2}[^\n]*\n> goal: Glaze the kiln shelf with the cone 6 mix\n> done: The shelf is glazed and the kiln is loaded\.\n> next: No open request\.\n> files: \/work\/kiln\/glaze\.md\n/);
  assert.deepEqual(quiet(hook(where, 'claude-code', claude('UserPromptSubmit', { prompt: 'continue' }, 's-2'))), SILENT);
});

test('the hook ends with exit 0 and prints nothing for broken input, a foreign host, an unknown agent and a memory that cannot be opened', () => {
  const where = place(TMP);
  const event = claude('UserPromptSubmit', { prompt: ASK });
  for (const input of ['', ' ', '{', 'not json', '[]', 'null', '{}', JSON.stringify(claude('PreToolUse', made('Bash', { command: 'ls' }))), JSON.stringify(claude('PostToolUse', made('Read', { file_path: '/x' })))]) {
    assert.deepEqual(quiet(run(HOOK, ['--agent', 'claude-code'], where, input)), SILENT, input);
  }
  for (const args of [[], ['--agent'], ['--agent', 'elsewhere'], ['--agent', 'constructor'], ['--agent=nobody']]) assert.deepEqual(quiet(run(HOOK, args, where, JSON.stringify(event))), SILENT, args.join(' '));
  for (const sign of ['CURSOR_VERSION', 'CURSOR_PROJECT_DIR', 'DEVIN_PROJECT_DIR']) assert.deepEqual(quiet(hook(where, 'claude-code', event, { [sign]: '1' })), SILENT, sign);
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('beforeSubmitPrompt', { prompt: ASK }))), SILENT);
  assert.equal(existsSync(where.AGENT_CTX_HOME), false);
  const blocked = place(TMP);
  writeFileSync(blocked.AGENT_CTX_HOME, 'a file where the folder belongs');
  assert.deepEqual(quiet(hook(blocked, 'claude-code', event)), SILENT);
  const newer = place(TMP);
  mkdirSync(newer.AGENT_CTX_HOME);
  writeFileSync(join(newer.AGENT_CTX_HOME, 'memory.db'), '');
  rows(newer, 'PRAGMA user_version = 9');
  assert.deepEqual(quiet(hook(newer, 'claude-code', event)), SILENT);
  assert.deepEqual(rows<{ user_version: number }>(newer, 'PRAGMA user_version'), [{ user_version: 9 }]);
  assert.deepEqual(quiet(hook(where, 'claude-code', event)), SILENT);
  assert.equal(count(where, 'events'), 1);
});

test('the hook file holds no MCP library and no way to accept a rule, and the main file runs the same hook', () => {
  const text = readFileSync(HOOK, 'utf8');
  for (const word of ['modelcontextprotocol', 'zod', 'McpServer', '.setRule(', 'rules accept', 'node:child_process']) assert.equal(text.includes(word), false, word);
  assert.ok(statSync(HOOK).size < 250 * 1024, String(statSync(HOOK).size));
  assert.ok(readFileSync(MAIN, 'utf8').includes('McpServer'));
  const where = place(TMP);
  const event = claude('UserPromptSubmit', { prompt: ASK });
  assert.deepEqual(quiet(run(MAIN, ['hook', '--agent', 'claude-code'], where, JSON.stringify(event))), SILENT);
  assert.deepEqual(rows<{ t: string; text: string }>(where, 'SELECT t, text FROM events'), [{ t: 'prompt', text: ASK }]);
  assert.deepEqual(quiet(run(MAIN, ['hook', '--agent', 'claude-code'], where, 'not json')), SILENT);
  assert.deepEqual(quiet(run(MAIN, ['hook'], where, JSON.stringify(event), { PATH: '/nowhere' })), SILENT);
});

test('a memory file locked by another process makes the hook give up after about one second', async () => {
  const where = place(TMP);
  session(where);
  const before = count(where, 'events');
  const lock = spawn(
    process.execPath,
    ['-e', "process.emitWarning=()=>{};const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');console.log('locked');setTimeout(()=>{db.exec('ROLLBACK');db.close()},4000)", join(where.AGENT_CTX_HOME, 'memory.db')],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  try {
    await new Promise((resolve) => lock.stdout.once('data', resolve));
    const r = hook(where, 'claude-code', claude('PostToolUse', made('Bash', { command: 'npm test' })));
    assert.deepEqual(quiet(r), SILENT);
    assert.ok(r.ms >= 900 && r.ms < 2000, String(r.ms));
  } finally {
    lock.kill();
    await new Promise((resolve) => lock.on('exit', resolve));
  }
  assert.equal(count(where, 'events'), before);
  assert.deepEqual(quiet(hook(where, 'claude-code', claude('PostToolUse', made('Bash', { command: 'npm test' })))), SILENT);
  assert.equal(count(where, 'events'), before + 1);
});

test('a long reply is cut the way the event tool cuts and still stored', () => {
  const where = place(TMP);
  assert.deepEqual(quiet(hook(where, 'claude-code', claude('UserPromptSubmit', { prompt: ASK }))), SILENT);
  const long = `${'The glaze run went well. '.repeat(900)}END`;
  assert.ok(long.length > 2 * MAX.inputBytes);
  assert.deepEqual(quiet(hook(where, 'claude-code', claude('Stop', { last_assistant_message: long }))), SILENT);
  const [stop] = rows<{ text: string }>(where, "SELECT text FROM events WHERE t = 'stop'");
  assert.ok(stop.text.startsWith('The glaze run went well. The glaze run went well.') && stop.text.length <= 2000 && !stop.text.includes('END'), String(stop.text.length));
  assert.deepEqual(quiet(hook(where, 'claude-code', claude('PostToolUse', made('Bash', { command: 'x'.repeat(3 * MAX.inputBytes) })))), SILENT);
  assert.equal(count(where, 'events'), 2);
});

interface Asked { k: string; v: string }
const asked = (where: Place): Asked[] => rows<Asked>(where, "SELECT k, v FROM meta WHERE k LIKE 'asked:%' ORDER BY k");
const delivered = (where: Place, reader: string): number => rows<{ n: number }>(where, 'SELECT COUNT(*) AS n FROM delivered WHERE reader = ?', reader)[0].n;
const primed = (where: Place, id: string): number[] => rows<{ primed: number }>(where, 'SELECT primed FROM sessions WHERE id = ?', id).map((r) => r.primed);

test('a Cursor prompt is saved with nothing delivered or marked, and the next kept tool call brings the recall', () => {
  const where = place(TMP);
  session(where);
  const prompt = 'Fire the test tiles for the kiln shelf glaze';
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('beforeSubmitPrompt', { prompt }), CURSOR)), SILENT);
  assert.deepEqual(rows<{ text: string }>(where, "SELECT text FROM events WHERE session = 'c-3'"), [{ text: prompt }]);
  assert.deepEqual([delivered(where, 's-c-3'), primed(where, 'c-3')], [0, [0]]);
  assert.deepEqual(asked(where).map((r) => [r.k, (JSON.parse(r.v) as { prompt: string }).prompt]), [['asked:c-3', prompt]]);
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('postToolUse', made('Read', { file_path: `${KILN}/glaze.md` })), CURSOR)), SILENT);
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('afterAgentResponse', { text: 'Reading the glaze notes first.' }), CURSOR)), SILENT);
  assert.deepEqual([delivered(where, 's-c-3'), primed(where, 'c-3'), asked(where).length], [0, [0], 1]);
  const first = hook(where, 'cursor', cursor('postToolUse', made('Shell', { command: 'ls tiles' })), CURSOR);
  assert.deepEqual([first.code, first.err], [0, '']);
  const text = context(first.out);
  assert.deepEqual(Object.keys(JSON.parse(first.out) as Json), ['additional_context']);
  assert.equal(text.split('\n')[0], HEADER.replace('NAME', 'kiln'));
  assert.match(text, /\nHANDOFF from claude-code on \d{4}-\d{2}-\d{2}[^\n]*\n> goal: Glaze the kiln shelf with the cone 6 mix\n/);
  assert.deepEqual([delivered(where, 's-c-3'), primed(where, 'c-3'), asked(where).length], [1, [1], 0]);
  assert.deepEqual(rows<{ t: string }>(where, "SELECT t FROM events WHERE session = 'c-3' ORDER BY at, t DESC").map((r) => r.t), ['prompt', 'stop', 'command']);
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('postToolUse', made('Shell', { command: 'ls shelf' })), CURSOR)), SILENT);
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('beforeSubmitPrompt', { prompt }), {})), SILENT);
  assert.equal(asked(where).length, 0);
});

test('a later Cursor prompt is stored once and recalled with the saved words at a session start', async () => {
  const where = place(TMP);
  const saved = await server(where, 'claude-code', [['checkpoint', { folder: KILN, goal: 'Pick the cone for the celadon glaze', decisions: ['use cone 6 for celadon because cone 10 crazes the shelf'] }]]);
  const more = await server(where, 'claude-code', [
    ['checkpoint', { folder: KILN, goal: 'Thread the loom heddles', changed: ['warp.md'] }],
    ['checkpoint', { folder: KILN, goal: 'Sharpen the lathe chisels', changed: ['tools.md'] }],
    ['checkpoint', { folder: KILN, goal: 'Label the pigment jars', changed: ['shelf.md'] }],
  ]);
  for (const text of [...saved, ...more]) assert.equal(text.startsWith('Checkpoint saved.'), true, text);
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('beforeSubmitPrompt', { prompt: 'hello' }), CURSOR)), SILENT);
  assert.equal(count(where, 'events'), 0);
  const start = hook(where, 'cursor', cursor('sessionStart'), CURSOR);
  assert.match(context(start.out), /\nEARLIER\n> \d{4}-\d{2}-\d{2} claude-code\. /);
  assert.deepEqual(['loom', 'lathe', 'pigment', 'celadon'].map((word) => context(start.out).includes(word)), [true, true, true, false]);
  assert.deepEqual([primed(where, 'c-3'), asked(where).length], [[1], 0]);
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('sessionStart'), CURSOR)), SILENT);
  const later = 'Which cone did we pick for the celadon glaze and why?';
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('beforeSubmitPrompt', { prompt: `${later} key=${'sk'}-${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4'}` }), CURSOR)), SILENT);
  assert.equal(asked(where)[0].v.includes('a1B2c3D4e5F6'), false);
  assert.equal(readFileSync(join(where.AGENT_CTX_HOME, 'memory.db')).includes('a1B2c3D4e5F6'), false);
  const again = hook(where, 'cursor', cursor('postToolUse', made('Write', { file_path: `${KILN}/cone.md` })), CURSOR);
  assert.match(context(again.out), /\nEARLIER\n> \d{4}-\d{2}-\d{2} claude-code\. Pick the cone for the celadon glaze\. Decided use cone 6 for celadon/);
  assert.equal(rows<{ n: number }>(where, "SELECT COUNT(*) AS n FROM events WHERE session = 'c-3' AND t = 'prompt'")[0].n, 1);
  assert.deepEqual(rows<{ t: string }>(where, "SELECT t FROM events WHERE session = 'c-3' AND t != 'prompt'"), [{ t: 'edit' }]);
});

test('a saved Cursor prompt older than 30 minutes is forgotten', () => {
  const where = place(TMP);
  session(where);
  const old = (minutes: number): void => void rows(where, 'UPDATE meta SET v = ? WHERE k = ?', JSON.stringify({ at: Date.now() - minutes * 60000, prompt: 'continue' }), 'asked:c-3');
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('beforeSubmitPrompt', { prompt: 'continue' }), CURSOR)), SILENT);
  old(31);
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('postToolUse', made('Shell', { command: 'ls' })), CURSOR)), SILENT);
  assert.deepEqual([asked(where).length, delivered(where, 's-c-3'), primed(where, 'c-3')], [0, 0, [0]]);
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('beforeSubmitPrompt', { prompt: 'continue' }), CURSOR)), SILENT);
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('beforeSubmitPrompt', { prompt: 'continue' }, 'c-4'), CURSOR)), SILENT);
  old(29);
  assert.match(context(hook(where, 'cursor', cursor('postToolUse', made('Shell', { command: 'ls' })), CURSOR).out), /\nHANDOFF from claude-code /);
  rows(where, 'UPDATE meta SET v = ? WHERE k = ?', JSON.stringify({ at: Date.now() - 31 * 60000, prompt: 'continue' }), 'asked:c-4');
  assert.deepEqual(quiet(hook(where, 'cursor', cursor('beforeSubmitPrompt', { prompt: 'continue' }, 'c-5'), CURSOR)), SILENT);
  assert.deepEqual(asked(where).map((r) => r.k), ['asked:c-5']);
});

test('the local limits are 100,000 calls and 5,000 stored items a day in 100 MB, and no local text names an account or a page', async () => {
  assert.deepEqual(CAPS, { perMinute: 100000, perDay: 100000, storedPerDay: 5000, agents: 20, inputBytes: 8192, storeBytes: 100 * 1024 * 1024 });
  assert.deepEqual([MAX.perDay, MAX.storedPerDay, MAX.storeBytes], [2000, 500, 10 * 1024 * 1024]);
  for (const [name, text] of Object.entries(SAY)) assert.equal(/account|page/i.test(local(text)), false, name);
  assert.equal(local(SAY.day), 'The limit of 100,000 calls for today is reached. Calls are accepted again tomorrow.');
  assert.equal(local(SAY.stored), '5,000 items were stored on this computer today. More can be stored tomorrow.');
  assert.equal(local(`Capture is paused. ${SAY.full}`), 'Capture is paused. The memory on this computer is full at 100 MB, so nothing new is stored.');
  assert.equal(local(SAY.size), SAY.size);
  const where = place(TMP);
  const words = 'amber basil cedar delta ember fjord garnet harbor indigo jasper kelp lumen maple nectar onyx pollen quartz russet sable tundra umber velvet walnut xenon yarrow zephyr anchor bramble copper dune echo fennel glacier hazel iris juniper kestrel lagoon meadow nimbus orchid pebble quill raven sorrel thistle upland vesper willow zinnia'.split(' ');
  const word = (n: number, k: number): string => words[(n * 7 + k * 13 + Math.floor(n / words.length) * (k + 3)) % words.length];
  const calls = Array.from({ length: 520 }, (_, n): [string, Json] => ['checkpoint', { folder: KILN, goal: `Task ${n} ${word(n, 1)} ${word(n, 2)} ${word(n, 3)} number ${n * 37}`, changed: [`src/${word(n, 4)}/${word(n, 5)}-${n}.ts`], decisions: [`use ${word(n, 6)} ${n} because ${word(n, 7)} ${n * 3} failed`], key: `k-${n}` }]);
  const said = await server(where, 'codex', calls);
  assert.equal(said.filter((text) => text.startsWith('Checkpoint saved.')).length, 520, said.find((text) => !text.startsWith('Checkpoint saved.')));
  assert.ok(count(where, 'items') > MAX.storedPerDay);
  const big = await server(where, 'codex', [['checkpoint', { folder: KILN, goal: 'x'.repeat(MAX.inputBytes) }]]);
  assert.deepEqual(big, [SAY.size]);
});
