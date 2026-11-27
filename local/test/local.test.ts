import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { after, test as plain } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FOOTER, HEADER } from '../../core/src/index.ts';
import { INSTRUCTIONS, toolList } from '../../service/src/mcp.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(ROOT, 'plugins', 'claude-code', 'scripts');
const BUNDLE = join(SCRIPTS, 'agent-ctx.mjs');
const BUILT = ['agent-ctx.mjs', 'hook.mjs', 'LICENSES.txt'];
const PENDING = 'Rule saved as pending. The person turns the rule on in a terminal with npx -y github:sohan-bhat/agent-ctx rules.';
const TMP = mkdtempSync(join(tmpdir(), 'agent-ctx-local-'));
const REAL = join(userInfo().homedir, '.agent-ctx');
const REAL_BEFORE = existsSync(REAL);
const NEWER = 'This memory file has the format of a newer agent-ctx, so update agent-ctx to open the file.';
const KILN = '/work/kiln';

const started: ChildProcessWithoutNullStreams[] = [];

after(() => {
  for (const child of started) if (child.exitCode === null) child.kill();
  rmSync(TMP, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

function test(name: string, fn: () => void | Promise<void>): void {
  void plain(name, { timeout: 120000 }, fn);
}
interface Place { HOME: string; AGENT_CTX_HOME: string }
interface Answer { text: string; isError: boolean; error?: { code: number; message: string } }

let places = 0;

function place(): Place {
  const HOME = join(TMP, `home-${++places}`);
  mkdirSync(HOME);
  return { HOME, AGENT_CTX_HOME: join(HOME, 'memory') };
}

function envOf(where: Partial<Place>): Record<string, string> {
  for (const v of Object.values(where)) assert.ok(v.startsWith(TMP + sep), `${v} lies outside the temp folder`);
  assert.ok(where.HOME, 'HOME is missing');
  return { PATH: '/usr/bin:/bin', ...where };
}

function run(args: string[], where: Partial<Place>, node: string[] = []): { code: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [...node, BUNDLE, ...args], { encoding: 'utf8', env: envOf(where), input: '' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function database(where: Place) {
  const emit = process.emitWarning;
  process.emitWarning = () => undefined;
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    return new DatabaseSync(join(where.AGENT_CTX_HOME, 'memory.db'));
  } finally {
    process.emitWarning = emit;
  }
}

function rows<T>(where: Place, query: string): T[] {
  const db = database(where);
  try {
    return db.prepare(query).all().map((r) => ({ ...r })) as T[];
  } finally {
    db.close();
  }
}

class Agent {
  err = '';
  private child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private id = 0;
  private waiting = new Map<number, (m: Json) => void>();
  private gone: Promise<number | null>;

  constructor(name: string, where: Place) {
    this.child = spawn(process.execPath, [BUNDLE, 'mcp', '--agent', name], { env: envOf(where), stdio: ['pipe', 'pipe', 'pipe'] });
    started.push(this.child);
    this.child.stderr.on('data', (d) => (this.err += String(d)));
    this.child.stdout.on('data', (d) => {
      this.buffer += String(d);
      for (let at = this.buffer.indexOf('\n'); at >= 0; at = this.buffer.indexOf('\n')) {
        const m = JSON.parse(this.buffer.slice(0, at)) as Json;
        this.buffer = this.buffer.slice(at + 1);
        const done = this.waiting.get(m.id as number);
        if (!done || !('result' in m || 'error' in m)) continue;
        this.waiting.delete(m.id as number);
        done(m);
      }
    });
    this.gone = new Promise((done) => this.child.on('exit', (code) => done(code)));
    void this.gone.then(() => {
      for (const done of this.waiting.values()) done({ error: { code: 0, message: `The program stopped. ${this.err}` } });
    });
  }

  send(method: string, params: Json): Promise<Json> {
    const id = ++this.id;
    return new Promise((done) => {
      this.waiting.set(id, done);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async start(capabilities: Json = {}): Promise<Json> {
    const r = await this.send('initialize', { protocolVersion: '2025-11-25', capabilities, clientInfo: { name: 'local-test', version: '1.0.0' } });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return r;
  }

  async call(name: string, args: Json, more: Json = {}): Promise<Answer> {
    const m = await this.send('tools/call', { name, arguments: args, ...more });
    const result = (m.result ?? {}) as { content?: { text?: string }[]; isError?: boolean };
    return { text: (result.content ?? []).map((c) => c.text ?? '').join(''), isError: !!result.isError, error: m.error as Answer['error'] };
  }

  stop(): Promise<number | null> {
    this.child.stdin.end();
    return this.gone;
  }
}

async function open(name: string, where: Place): Promise<Agent> {
  const a = new Agent(name, where);
  const r = await a.start();
  assert.ok(r.result, a.err);
  return a;
}

test('the committed bundle is the build of the sources', () => {
  const out = join(TMP, 'rebuilt');
  const r = spawnSync(process.execPath, [join(ROOT, 'local', 'build.mjs'), out], { encoding: 'utf8', env: envOf(place()) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(SCRIPTS).sort(), [...BUILT].sort());
  for (const name of BUILT) assert.ok(readFileSync(join(out, name)).equals(readFileSync(join(SCRIPTS, name))), `${name} is stale. Run npm run build and commit plugins/claude-code/scripts.`);
});

test('the version is the version in package.json and the bare command prints at most six plain lines', () => {
  const where = place();
  const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  assert.deepEqual(run(['--version'], where), { code: 0, out: `${version}\n`, err: '' });
  for (const args of [[], ['install'], ['--help']]) {
    const bare = run(args, where);
    assert.equal(bare.code, 0);
    assert.equal(bare.err, '');
    const lines = bare.out.trimEnd().split('\n');
    assert.ok(lines.length <= (args[0] === '--help' ? 7 : 6) && lines.every((l) => l.trim()), bare.out);
    assert.ok(lines[0].includes(args.length === 1 && args[0] === '--help' ? `agent-ctx ${version}` : 'No agent was found on this computer, so nothing was changed.'), lines[0]);
    const prose = bare.out.replace(join(where.AGENT_CTX_HOME, 'memory.db'), 'PATH').replace(/npx -y github:\S+/g, 'COMMAND');
    assert.equal(/\b(it|its|itself|it's)\b|[—–;:()]| - /i.exec(prose), null);
  }
  const unknown = run(['frobnicate'], where);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.out, '');
  assert.equal(unknown.err.split('\n')[0], 'No command named frobnicate exists in this version.');
  assert.equal(existsSync(where.AGENT_CTX_HOME), false);
});

test('the version in the answer to initialize is the version in package.json', async () => {
  const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  const a = new Agent('codex', place());
  assert.deepEqual(((await a.start()).result as { serverInfo: unknown }).serverInfo, { name: 'agent-ctx', version });
  assert.equal(await a.stop(), 0);
});

test('a Node older than 22.16 gets one plain line and a non zero exit', () => {
  const old = (v: string) => run(['mcp', '--agent', 'codex'], place(), ['--import', `data:text/javascript,Object.defineProperty(process.versions,'node',{value:'${v}'})`]);
  assert.deepEqual(old('22.15.9'), { code: 1, out: '', err: 'Node 22.16 or newer is required for agent-ctx and this computer has Node 22.15.9.\n' });
  assert.deepEqual(old('20.19.0'), { code: 1, out: '', err: 'Node 22.16 or newer is required for agent-ctx and this computer has Node 20.19.0.\n' });
});

test('tools/list over stdio equals the tool list of the Worker character for character', async () => {
  const a = new Agent('claude-code', place());
  assert.equal(((await a.start()).result as { instructions: string }).instructions, INSTRUCTIONS);
  const listed = ((await a.send('tools/list', {})).result as { tools: { name: string }[] }).tools;
  assert.deepEqual(listed.map((t) => t.name), ['recall', 'checkpoint', 'handoff', 'rule', 'event']);
  assert.equal(JSON.stringify(listed), JSON.stringify(toolList()));
  assert.equal(await a.stop(), 0);
});

test('a checkpoint saved through one process comes back from recall in another as quoted data that names the saving agent', async () => {
  const where = place();
  const writer = await open('claude-code', where);
  const saved = await writer.call('checkpoint', { folder: KILN, goal: 'Glaze the kiln shelf', decisions: ['use cone 6 because cone 10 warps the shelf'] });
  assert.deepEqual(saved, { text: "Checkpoint saved. The open tasks are shown to the next agent when that agent's session starts.", isError: false, error: undefined });
  assert.equal(await writer.stop(), 0);
  const reader = await open('cursor', where);
  const text = (await reader.call('recall', { folder: KILN })).text;
  const lines = text.split('\n');
  assert.equal(lines[0], HEADER.replace('NAME', 'kiln'));
  assert.equal(lines[lines.length - 1], FOOTER);
  const card = lines.filter((l) => l.includes('Glaze the kiln shelf'));
  assert.equal(card.length, 1);
  assert.match(card[0], /^> \d{4}-\d{2}-\d{2} claude-code\. Glaze the kiln shelf\. Decided use cone 6/);
  assert.equal(await reader.stop(), 0);
});

test('a handoff written by claude-code in one process reaches cursor in a second open process with claude-code named as the origin', async () => {
  const where = place();
  const writer = await open('claude-code', where);
  const reader = await open('cursor', where);
  assert.equal((await reader.call('recall', { folder: KILN, query: 'kiln glaze tiles' })).isError, false);
  const saved = await writer.call('handoff', { folder: KILN, goal: 'Glaze the kiln shelf', next: 'Fire the test tiles at cone 6', question: 'Which shelf holds the tiles' });
  assert.equal(saved.text, 'Handoff saved for the next agent.');
  const text = (await reader.call('recall', { folder: KILN })).text;
  assert.match(text, /\nHANDOFF from claude-code on \d{4}-\d{2}-\d{2}\n> question: Which shelf holds the tiles\n> goal: Glaze the kiln shelf\n> next: Fire the test tiles at cone 6\n/);
  assert.ok(!text.includes('from cursor'));
  const origin = rows<{ origin: string }>(where, "SELECT origin FROM items WHERE kind = 'handoff'").map((r) => (JSON.parse(r.origin) as { agent: string }).agent);
  assert.deepEqual(origin, ['claude-code']);
  assert.deepEqual(rows<{ id: string }>(where, 'SELECT id FROM agents ORDER BY id').map((r) => r.id), ['claude-code', 'cursor']);
  assert.deepEqual([await writer.stop(), await reader.stop()], [0, 0]);
});

test('three processes that each write 300 events at the same time store all 900 rows and no call fails', async () => {
  const where = place();
  const names = ['claude-code', 'cursor', 'codex'];
  const agents = await Promise.all(names.map((n) => open(n, where)));
  const answers = await Promise.all(
    agents.map((a, k) => Promise.all(Array.from({ length: 300 }, (_, i) => a.call('event', { host: names[k], event: 'PostToolUse', session: `session-${names[k]}`, cwd: KILN, tool: 'Bash', command: `npm test -- part ${k} step ${i}` })))),
  );
  for (const a of answers.flat()) assert.deepEqual(a, { text: '', isError: false, error: undefined });
  assert.deepEqual(await Promise.all(agents.map((a) => a.stop())), [0, 0, 0]);
  assert.deepEqual(rows<{ session: string; n: number }>(where, 'SELECT session, COUNT(*) AS n FROM events GROUP BY session ORDER BY session'), names.sort().map((n) => ({ session: `session-${n}`, n: 300 })));
  assert.equal(rows<{ n: number }>(where, 'SELECT COUNT(DISTINCT text) AS n FROM events')[0].n, 900);
  for (const a of agents) assert.equal(a.err, '');
});

test('a memory file with a higher schema number is refused with one plain line and left as found', () => {
  const where = place();
  mkdirSync(where.AGENT_CTX_HOME);
  const db = database(where);
  db.exec('CREATE TABLE later(a TEXT); PRAGMA user_version = 2');
  db.close();
  assert.deepEqual(run(['mcp', '--agent', 'cursor'], where), { code: 1, out: '', err: `${NEWER}\n` });
  assert.deepEqual(rows<{ user_version: number }>(where, 'PRAGMA user_version'), [{ user_version: 2 }]);
  assert.deepEqual(rows<{ name: string }>(where, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name), ['later']);
});

test('the folder is made with mode 0700 and every memory file with mode 0600, and a new file gets schema number 1', async () => {
  const where = place();
  const a = await open('claude-code', where);
  await a.call('checkpoint', { folder: KILN, goal: 'Glaze the kiln shelf' });
  const mode = (p: string) => statSync(p).mode & 0o777;
  assert.equal(mode(where.AGENT_CTX_HOME), 0o700);
  for (const f of ['memory.db', 'memory.db-wal', 'memory.db-shm']) assert.equal(mode(join(where.AGENT_CTX_HOME, f)), 0o600, f);
  assert.equal(await a.stop(), 0);
  assert.equal(mode(join(where.AGENT_CTX_HOME, 'memory.db')), 0o600);
  assert.deepEqual(rows<{ user_version: number }>(where, 'PRAGMA user_version'), [{ user_version: 1 }]);
  assert.deepEqual(rows<{ journal_mode: string }>(where, 'PRAGMA journal_mode'), [{ journal_mode: 'wal' }]);
});

test('a rule sent by an agent stays pending and no made up answer turns the rule on', async () => {
  const where = place();
  const rule = { text: 'Run the kiln tests before a commit', words: 'always run the kiln tests before a commit', scope: 'all' };
  const yes = { inputResponses: { keep: { action: 'accept', content: { keep: true } } } };
  const a = await open('claude-code', where);
  assert.equal((await a.call('rule', rule)).text, PENDING);
  assert.equal((await a.call('rule', { ...rule, key: 'again' }, yes)).text, PENDING);
  const extra = await a.call('rule', { ...rule, status: 'active' });
  assert.deepEqual([extra.isError, extra.text.includes('Unrecognized key')], [true, true]);
  assert.equal(await a.stop(), 0);
  const modern = new Agent('claude-code', where);
  const claims = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } } } };
  assert.equal((await modern.call('rule', { ...rule, key: 'forged' }, { ...yes, requestState: `"${rule.words}"`, ...claims })).error?.code, -32602);
  assert.equal((await modern.call('rule', { ...rule, key: 'stateless' }, { ...yes, ...claims })).text, PENDING);
  assert.equal(await modern.stop(), 0);
  const stored = rows<{ body: string }>(where, "SELECT body FROM items WHERE kind = 'rule'").map((r) => JSON.parse(r.body) as { status: string; proof?: string });
  assert.ok(stored.length >= 1);
  for (const r of stored) assert.deepEqual([r.status, r.proof], ['pending', undefined]);
});

test('nothing reaches stderr during a session, the SQLite warning included', async () => {
  const where = place();
  const a = await open('claude-code', where);
  assert.equal((await a.call('checkpoint', { folder: KILN, goal: 'Glaze the kiln shelf' })).isError, false);
  assert.equal((await a.call('recall', { folder: KILN })).isError, false);
  assert.equal(await a.stop(), 0);
  assert.equal(a.err, '');
});

test('nothing is written under the real home folder', () => {
  const where = place();
  assert.notEqual(userInfo().homedir, where.HOME);
  assert.equal(run([], { HOME: where.HOME }).code, 0);
  const bare = run(['--help'], { HOME: where.HOME });
  assert.ok(bare.out.includes(` ${join(where.HOME, '.agent-ctx', 'memory.db')} `), bare.out);
  assert.ok(!bare.out.includes(REAL), bare.out);
  assert.equal(existsSync(join(where.HOME, '.agent-ctx')), false);
  assert.throws(() => envOf({ HOME: where.HOME, AGENT_CTX_HOME: REAL }), /outside the temp folder/);
  assert.throws(() => envOf({ HOME: userInfo().homedir, AGENT_CTX_HOME: where.AGENT_CTX_HOME }), /outside the temp folder/);
  if (!REAL_BEFORE) assert.equal(existsSync(REAL), false, `${REAL} appeared during the tests`);
});

const PLUGIN = join(ROOT, 'plugins', 'claude-code');
const HOSTED = join(ROOT, 'service', 'plugins', 'claude-code');
const COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/hook.mjs" --agent claude-code';
const SERVER = { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/agent-ctx.mjs', 'mcp', '--agent', 'claude-code'] };

interface Hook { type?: string; command?: string; timeout?: number }
interface Group { matcher?: string; hooks: Hook[] }

const json = <T>(...path: string[]): T => JSON.parse(readFileSync(join(...path), 'utf8')) as T;
const groups = (folder: string): [string, Group][] => Object.entries(json<{ hooks: Record<string, Group[]> }>(folder, 'hooks', 'hooks.json').hooks).flatMap(([event, list]) => list.map((g): [string, Group] => [event, g]));

test('the plugin declares one stdio server that runs the main file with the label claude-code', () => {
  const manifest = json<{ name: string; version: string; mcpServers: Json }>(PLUGIN, '.claude-plugin', 'plugin.json');
  assert.deepEqual(manifest.mcpServers, { 'agent-ctx': SERVER });
  assert.deepEqual([manifest.name, manifest.version], ['agent-ctx', json<{ version: string }>(ROOT, 'package.json').version]);
  assert.equal(/https?:|privacy/i.test(JSON.stringify(manifest)), false);
  const market = json<{ plugins: { name: string; source: string }[] }>(ROOT, '.claude-plugin', 'marketplace.json');
  assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [['agent-ctx', './plugins/claude-code']]);
  assert.equal(/hosted/i.test(JSON.stringify(market)), false);
  assert.ok(readFileSync(join(PLUGIN, '.claude-plugin', 'icon.png')).equals(readFileSync(join(HOSTED, '.claude-plugin', 'icon.png'))));
});

test('every plugin hook is a command that runs the hook file on the events and matchers of the hosted plugin', () => {
  const shape = (folder: string) => groups(folder).map(([event, g]) => [event, g.matcher ?? '', g.hooks.map((h) => h.timeout)]);
  assert.deepEqual(shape(PLUGIN), shape(HOSTED));
  assert.equal(groups(PLUGIN).length, 9);
  for (const [event, g] of groups(PLUGIN)) {
    for (const h of g.hooks) assert.deepEqual(h, { type: 'command', command: COMMAND, timeout: h.timeout }, event);
  }
});

void plain('the plugin commands store an event and open the memory when run the way Claude Code runs them', { skip: process.platform === 'win32', timeout: 120000 }, async () => {
  const where = place();
  const env = { ...envOf(where), PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, CLAUDE_PLUGIN_ROOT: PLUGIN };
  const input = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's-1', cwd: KILN, prompt: 'Glaze the kiln shelf with the cone 6 mix' });
  const r = spawnSync('/bin/sh', ['-c', groups(PLUGIN)[0][1].hooks[0].command as string], { env, input, encoding: 'utf8' });
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
  assert.deepEqual(rows<{ t: string; text: string }>(where, 'SELECT t, text FROM events'), [{ t: 'prompt', text: 'Glaze the kiln shelf with the cone 6 mix' }]);
  const entry = json<{ mcpServers: Record<string, typeof SERVER> }>(PLUGIN, '.claude-plugin', 'plugin.json').mcpServers['agent-ctx'];
  const child = spawn(entry.command, entry.args.map((a) => a.replace('${CLAUDE_PLUGIN_ROOT}', PLUGIN)), { env, stdio: ['pipe', 'pipe', 'pipe'] });
  started.push(child);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'local-test', version: '1.0.0' } } })}\n`);
  const first = await new Promise<string>((done) => {
    child.stdout.once('data', (d) => done(String(d)));
    child.once('exit', () => done('{}'));
  });
  assert.equal((JSON.parse(first.split('\n')[0]) as { result?: { instructions: string } }).result?.instructions, INSTRUCTIONS);
  child.stdin.end();
  assert.equal(await new Promise((done) => (child.exitCode === null ? child.on('exit', done) : done(child.exitCode))), 0);
  assert.deepEqual(rows<{ id: string }>(where, 'SELECT id FROM agents'), [{ id: 'claude-code' }]);
});

test('the plugin note says what is saved, that everything saved stays on this computer and how to remove the plugin in 40 to 60 plain words', () => {
  const text = readFileSync(join(PLUGIN, 'README.md'), 'utf8');
  const words = text.replace(/^#.*$/m, '').split(/\s+/).filter(Boolean);
  assert.ok(words.length >= 40 && words.length <= 60, String(words.length));
  assert.equal(/\b(it|its|itself|it's|they|them)\b|[—–;:()]| - /i.exec(text), null);
  for (const need of ['prompts', 'working folder', 'file paths', 'commands', 'reply', 'compaction summaries', 'secrets removed', 'tool output are never saved', 'everything saved stays on this computer', '/plugin uninstall agent-ctx']) assert.ok(text.includes(need), need);
  assert.equal(/server|account|hosted|sent/i.exec(text), null);
});

test('the plugin folder holds the manifest, the icon, the note, the hooks file and the three built files', () => {
  const files = readdirSync(PLUGIN, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(PLUGIN.length + 1));
  assert.deepEqual(files.sort(), ['.claude-plugin/icon.png', '.claude-plugin/plugin.json', 'README.md', 'hooks/hooks.json', ...BUILT.map((name) => `scripts/${name}`)].sort());
});
