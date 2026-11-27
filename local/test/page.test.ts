import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test as plainTest } from 'node:test';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { opener } from '../src/page.ts';
import { BANNED, MAIN, ROOT, SCRIPTS, calls, envOf, hook, place, plain, put, rows, run, server, stub, tree, type Place } from './kit.ts';

interface Packed { path: string; size: number; sha256: string; files: string[] }
interface Packer { NAME: string; pack: (dir?: string, out?: string) => Packed }
interface Got { status: number; text: string; bytes: Buffer; headers: IncomingHttpHeaders }
interface Ask { method?: string; headers?: Record<string, string>; body?: unknown }
interface Started { child: ChildProcess; out: () => string; ended: Promise<number | null> }
interface Page extends Started { base: string; port: number; token: string; lines: string[] }
interface Item { id: string; kind: string; line?: string; body: { goal?: string; status?: string } }
interface Space { items: Item[]; projects: { key: string; name: string; items: number }[]; agents: { label: string }[] }
interface Plan { connected: boolean; lines: string[]; command: string | null; ready: boolean }

const TMP = mkdtempSync(join(tmpdir(), 'agent-ctx-page-'));
const FILES = join(TMP, 'files');
const OUTSIDE = 'a line that lies outside the page folder';
const KILN = '/work/kiln';
const GOAL = 'Glaze the kiln shelf with the cone 6 mix';
const RULE = { text: 'Indent Python with two spaces', words: 'from now on indent Python with two spaces', scope: 'all' };
const FILES_SERVER = { mcpServers: { files: { command: 'npx', args: ['-y', 'files-server'] } } };
const INSTALL = 'claude plugin install agent-ctx --marketplace sohan-bhat/agent-ctx';
const REFUSED = 'Type agent-ctx page in a terminal to open the memory page.';
const OPEN = /^The memory page is open at (http:\/\/127\.0\.0\.1:(\d+)\/([\w-]+)\/) and stays open until 30 seconds after you close the page\.$/m;
const POLICY = "default-src 'none'; script-src 'self'";

const { NAME, pack } = (await import(pathToFileURL(join(ROOT, 'web', 'pack.mjs')).href)) as Packer;

put(join(FILES, 'index.html'), '<!doctype html><title>agent-ctx</title><div id="root"></div><script type="module" src="./assets/app.js"></script>\n');
put(join(FILES, 'assets', 'app.js'), 'document.title = "ready";\n');
put(join(FILES, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
put(join(FILES, '_headers'), `/*\n  Content-Security-Policy: ${POLICY}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n`);
put(join(TMP, 'outside.txt'), OUTSIDE);

const running: ChildProcess[] = [];
const closing: (() => void)[] = [];

after(() => {
  for (const child of running) if (child.exitCode === null) child.kill();
  for (const close of closing) close();
  rmSync(TMP, { recursive: true, force: true });
});

function test(name: string, fn: () => void | Promise<void>): void {
  void plainTest(name, { timeout: 120000 }, fn);
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const app = (where: Place, ...more: string[]): string => join(where.AGENT_CTX_HOME, 'app', ...more);
const said = (out: string): string[] => out.trimEnd().split('\n').filter(Boolean);

function home(): Place {
  const where = place(TMP);
  stub(where);
  for (const name of ['open', 'xdg-open']) {
    writeFileSync(join(where.bin, name), `#!/bin/sh\necho "$*" >> "${join(where.root, 'open.log')}"\n`);
    chmodSync(join(where.bin, name), 0o755);
  }
  return where;
}

function launch(where: Place, more: Record<string, string> = {}, files: string | null = FILES): Started {
  const env = envOf(where, { AGENT_CTX_NO_OPEN: '1', ...(files ? { AGENT_CTX_PAGE_DIR: files } : {}), ...more });
  const child = spawn(process.execPath, [MAIN, 'page'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  running.push(child);
  let out = '';
  child.stdout?.on('data', (d) => (out += String(d)));
  child.stderr?.on('data', (d) => (out += String(d)));
  const ended = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
  return { child, out: () => out, ended };
}

async function start(where: Place, more: Record<string, string> = {}, files: string | null = FILES): Promise<Page> {
  const s = launch(where, more, files);
  for (let waited = 0; !OPEN.test(s.out()) && s.child.exitCode === null && waited < 20000; waited += 25) await sleep(25);
  const hit = OPEN.exec(s.out());
  assert.ok(hit, `no address was printed, the output was ${s.out()}`);
  return { ...s, base: hit[1], port: Number(hit[2]), token: hit[3], lines: said(s.out()) };
}

async function stop(p: Started): Promise<number | null> {
  if (p.child.exitCode === null) p.child.kill('SIGTERM');
  return p.ended;
}

function ask(port: number, path: string, o: Ask = {}, host = '127.0.0.1'): Promise<Got> {
  return new Promise((done, fail) => {
    const body = o.body === undefined ? undefined : JSON.stringify(o.body);
    const headers = { host: `127.0.0.1:${port}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...o.headers };
    const r = request({ host, port, path, method: o.method ?? 'GET', headers, timeout: 40000 }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (d: Buffer) => parts.push(d));
      res.on('end', () => {
        const bytes = Buffer.concat(parts);
        done({ status: res.statusCode ?? 0, text: bytes.toString('utf8'), bytes, headers: res.headers });
      });
    });
    r.on('error', fail);
    r.end(body);
  });
}

function call(p: Page, path: string, o: Ask = {}): Promise<Got> {
  const writes = o.method !== undefined && o.method !== 'GET';
  return ask(p.port, `/${p.token}/api${path}`, { ...o, headers: { ...(writes ? { origin: `http://127.0.0.1:${p.port}` } : {}), ...o.headers } });
}

const json = <T>(got: Got): T => JSON.parse(got.text) as T;

function reach(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host, port, timeout: 1500 });
    const end = (ok: boolean): void => {
      socket.destroy();
      done(ok);
    };
    socket.on('connect', () => end(true));
    socket.on('error', () => end(false));
    socket.on('timeout', () => end(false));
  });
}

function releases(files: Record<string, Buffer | string>): Promise<{ base: string; hits: string[] }> {
  return new Promise((done) => {
    const hits: string[] = [];
    const site = createServer((req, res) => {
      const name = (req.url ?? '').slice(1);
      hits.push(name);
      if (!Object.hasOwn(files, name)) return void res.writeHead(404).end('Not Found');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(files[name]);
    });
    site.listen(0, '127.0.0.1', () => {
      closing.push(() => site.close());
      done({ base: `http://127.0.0.1:${(site.address() as { port: number }).port}`, hits });
    });
  });
}

const sums = (bytes: Buffer): string => `${createHash('sha256').update(bytes).digest('hex')}  ${NAME}\n`;

function entry(name: string, text: string): Buffer {
  const head = Buffer.alloc(512);
  head.write(name, 0, 100, 'utf8');
  head.write('0000644\0', 100);
  head.write(`${Buffer.byteLength(text).toString(8).padStart(11, '0')}\0`, 124);
  head.write('        ', 148);
  head.write('0', 156);
  head.write('ustar\u000000', 257);
  head.write(`${head.reduce((sum, b) => sum + b, 0).toString(8).padStart(6, '0')}\0 `, 148);
  const body = Buffer.alloc(Math.ceil(Buffer.byteLength(text) / 512) * 512);
  body.write(text);
  return Buffer.concat([head, body]);
}

async function seed(where: Place): Promise<void> {
  const saved = await server(where, 'cursor', [
    ['checkpoint', { folder: KILN, goal: GOAL, decisions: ['use cone 6 because cone 10 warps the shelf'] }],
    ['handoff', { folder: KILN, goal: 'Fire the test tiles', next: 'Unload the kiln on Friday' }],
    ['rule', RULE],
  ]);
  assert.equal(saved.filter(Boolean).length, 3);
}

test('page prints the address in one plain line, serves the page files under the token and opens no browser', async () => {
  const where = home();
  const p = await start(where);
  assert.equal(p.lines.length, 1, p.out());
  const index = await ask(p.port, `/${p.token}/`);
  assert.deepEqual([index.status, index.text, index.headers['content-type']], [200, readFileSync(join(FILES, 'index.html'), 'utf8'), 'text/html; charset=utf-8']);
  assert.deepEqual(
    ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'cache-control'].map((name) => index.headers[name]),
    [POLICY, 'nosniff', 'no-referrer', 'DENY', 'no-store'],
  );
  const script = await ask(p.port, `/${p.token}/assets/app.js`);
  assert.deepEqual([script.status, script.text, script.headers['content-type']], [200, 'document.title = "ready";\n', 'text/javascript; charset=utf-8']);
  assert.equal((await ask(p.port, `/${p.token}/favicon.svg`)).headers['content-type'], 'image/svg+xml');
  const bare = await ask(p.port, `/${p.token}`);
  assert.deepEqual([bare.status, bare.headers.location], [308, `/${p.token}/`]);
  for (const path of ['_headers', 'missing.js', 'assets', 'assets/']) assert.equal((await ask(p.port, `/${p.token}/${path}`)).status, 404, path);
  assert.equal((await ask(p.port, `/${p.token}/`, { method: 'POST', headers: { origin: `http://127.0.0.1:${p.port}` } })).status, 405);
  assert.equal(existsSync(join(where.root, 'open.log')), false, 'a browser was opened');
  assert.equal(await stop(p), 0);
  assert.deepEqual(opener('darwin', p.base), ['open', p.base]);
  assert.deepEqual(opener('linux', p.base), ['xdg-open', p.base]);
  assert.deepEqual(opener('win32', p.base), ['cmd', '/c', 'start', '', p.base]);
});

test('only the loopback address 127.0.0.1 is bound', async () => {
  const p = await start(home());
  const others = Object.values(networkInterfaces()).flatMap((list) => list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => a.address);
  assert.equal(await reach('127.0.0.1', p.port), true);
  for (const host of [...others, '::1']) assert.equal(await reach(host, p.port), false, host);
  await stop(p);
});

test('the token has at least 128 bits, changes with every start and every call without the token is refused', async () => {
  const where = home();
  await seed(where);
  const p = await start(where);
  assert.ok(Buffer.from(p.token, 'base64url').length >= 16 && /^[\w-]+$/.test(p.token), p.token);
  const wrong = `${p.token.slice(0, -1)}${p.token.endsWith('A') ? 'B' : 'A'}`;
  for (const path of ['/', '/index.html', '/api/space', '/api/me', '/assets/app.js', `/${wrong}/`, `/${wrong}/api/space`, `/${p.token.slice(0, 8)}/api/space`, `//${p.token}/api/space`]) {
    const got = await ask(p.port, path);
    assert.deepEqual([got.status, got.text], [403, `${REFUSED}\n`], path);
  }
  const post = await ask(p.port, '/api/rules', { method: 'POST', body: { text: 'Keep notes short', scope: 'all' }, headers: { origin: `http://127.0.0.1:${p.port}` } });
  assert.equal(post.status, 403);
  assert.equal((await call(p, '/space')).status, 200);
  assert.equal(rows<{ n: number }>(where, "SELECT COUNT(*) AS n FROM items WHERE kind = 'rule'")[0].n, 1);
  await stop(p);
  const again = await start(where);
  assert.notEqual(again.token, p.token);
  assert.equal((await ask(again.port, `/${p.token}/api/space`)).status, 403);
  await stop(again);
});

test('a foreign Host and a foreign Origin are refused', async () => {
  const where = home();
  const p = await start(where);
  const path = `/${p.token}/api/space`;
  assert.equal((await ask(p.port, path)).status, 200);
  for (const host of ['evil.example', `evil.example:${p.port}`, `localhost:${p.port}`, `127.0.0.1:${p.port + 1}`, '127.0.0.1', `[::1]:${p.port}`, `127.0.0.1:${p.port}.evil.example`]) {
    const got = await ask(p.port, path, { headers: { host } });
    assert.deepEqual([got.status, got.text], [403, `${REFUSED}\n`], host);
    assert.equal((await ask(p.port, `/${p.token}/`, { headers: { host } })).status, 403, host);
  }
  for (const origin of ['https://evil.example', `http://localhost:${p.port}`, `http://127.0.0.1:${p.port + 1}`, 'null']) {
    assert.equal((await ask(p.port, path, { headers: { origin } })).status, 403, origin);
    assert.equal((await ask(p.port, `/${p.token}/api/rules`, { method: 'POST', body: { text: 'Keep notes short', scope: 'all' }, headers: { origin } })).status, 403, origin);
  }
  assert.equal((await ask(p.port, `/${p.token}/api/rules`, { method: 'POST', body: { text: 'Keep notes short', scope: 'all' } })).status, 403, 'a write with no Origin');
  assert.equal((await ask(p.port, path, { headers: { origin: `http://127.0.0.1:${p.port}` } })).status, 200);
  assert.equal(rows<{ n: number }>(where, 'SELECT COUNT(*) AS n FROM items')[0].n, 0);
  assert.equal((await call(p, '/rules', { method: 'POST', body: { text: 'Keep notes short', scope: 'all' } })).status, 201);
  await stop(p);
});

test('no file, no tool answer and no hook output carries the port or the token, and a start inside an agent session prints no address', async () => {
  const where = home();
  const p = await start(where);
  const secrets = [p.token, `127.0.0.1:${p.port}`, `localhost:${p.port}`];
  const answers = await server(where, 'cursor', [
    ['checkpoint', { folder: KILN, goal: GOAL }],
    ['rule', RULE],
    ['recall', { folder: KILN }],
  ]);
  assert.equal(answers[1], 'Rule saved as pending. The person turns the rule on in a terminal with agent-ctx rules.');
  const prompt = hook(where, 'claude-code', { hook_event_name: 'UserPromptSubmit', session_id: 's-1', cwd: KILN, prompt: 'carry on with the kiln shelf and the glaze' });
  assert.ok(prompt.out.includes(GOAL), prompt.out);
  assert.equal((await call(p, '/space')).status, 200);
  const files = Object.values(tree(where.root)).map((data) => Buffer.from(data, 'base64').toString('latin1'));
  assert.ok(files.length > 3, 'the home folders hold files');
  for (const secret of secrets) for (const text of [...answers, prompt.out, prompt.err, ...files]) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(readdirSync(where.AGENT_CTX_HOME).filter((name) => !name.startsWith('memory.db')), []);
  await stop(p);
  for (const sign of ['CLAUDECODE', 'CURSOR_AGENT', 'CODEX_SANDBOX', 'GEMINI_CLI']) {
    const inside = launch(where, { [sign]: '1' });
    assert.equal(await inside.ended, 1, sign);
    assert.deepEqual(said(inside.out()), ['The memory page is opened by a person at a terminal, so type npx -y github:sohan-bhat/agent-ctx page in a terminal of your own.'], sign);
  }
});

test('the page calls give the memory in the shape of the hosted calls, and Accept by a call turns a pending rule on', async () => {
  const where = home();
  await seed(where);
  const p = await start(where);
  const me = json<{ person: unknown; limits: Record<string, number>; toolChars: number }>(await call(p, '/me'));
  assert.deepEqual(Object.keys(me).sort(), ['limits', 'person', 'toolChars']);
  assert.deepEqual(Object.keys(me.limits).sort(), ['bytes', 'callsToday', 'max', 'storedToday']);
  assert.deepEqual([me.limits.max, me.limits.bytes > 0, me.toolChars > 1000], [100 * 1024 * 1024, true, true]);
  const space = json<Space & Record<string, unknown>>(await call(p, '/space'));
  assert.deepEqual(Object.keys(space).sort(), ['agents', 'items', 'now', 'projects', 'queue', 'reads']);
  assert.deepEqual(space.projects, [{ key: 'folder:kiln', name: 'kiln', items: 2 }]);
  assert.deepEqual(space.agents.map((a) => a.label), ['cursor']);
  assert.deepEqual(space.items.map((i) => i.kind).sort(), ['card', 'handoff', 'rule']);
  const card = space.items.find((i) => i.kind === 'card') as Item;
  const rule = space.items.find((i) => i.kind === 'rule') as Item;
  assert.deepEqual([card.body.goal, rule.body.status, rule.line], [GOAL, 'pending', `"${RULE.words}"`]);
  assert.equal((await call(p, `/items/${card.id}/pin`, { method: 'POST', body: { on: true } })).status, 200);
  assert.equal((await call(p, `/items/${card.id}/pin`, { method: 'POST', body: { on: 'yes' } })).status, 400);
  assert.equal(rows<{ pinned: number }>(where, 'SELECT pinned FROM items WHERE id = ?', card.id)[0].pinned, 1);
  assert.equal((await call(p, `/rules/${rule.id}`, { method: 'POST', body: { status: 'active', line: '"some other words"' } })).status, 409);
  assert.equal((await call(p, `/rules/${rule.id}`, { method: 'POST', body: { status: 'active', line: rule.line } })).status, 200);
  const stored = rows<{ status: string; proof: string }>(where, "SELECT json_extract(body, '$.status') AS status, json_extract(body, '$.proof') AS proof FROM items WHERE kind = 'rule'");
  assert.deepEqual(stored, [{ status: 'active', proof: 'page' }]);
  const next = hook(where, 'claude-code', { hook_event_name: 'UserPromptSubmit', session_id: 's-2', cwd: KILN, prompt: 'continue' });
  assert.match(next.out, /\nRULES\n> "from now on indent Python with two spaces" proposed in cursor, accepted by the person on \d{4}-\d{2}-\d{2}, all projects\n/);
  const zip = await call(p, '/export');
  assert.deepEqual([zip.status, zip.headers['content-type']], [200, 'application/zip']);
  writeFileSync(join(where.root, 'export.zip'), zip.bytes);
  const listed = spawnSync('unzip', ['-Z1', join(where.root, 'export.zip')], { encoding: 'utf8' }).stdout.trim().split('\n').sort();
  assert.deepEqual(listed, ['agent-ctx/README.md', 'agent-ctx/agents.jsonl', 'agent-ctx/projects/kiln/handoff.md', 'agent-ctx/projects/kiln/items.jsonl', 'agent-ctx/rules.jsonl']);
  const lines = spawnSync('unzip', ['-p', join(where.root, 'export.zip'), 'agent-ctx/projects/kiln/items.jsonl'], { encoding: 'utf8' }).stdout;
  assert.ok(lines.includes(GOAL) && lines.includes('Unload the kiln on Friday'), lines);
  assert.equal((await call(p, '/agents/cursor', { method: 'DELETE' })).status, 404);
  assert.equal((await call(p, '/nothing')).status, 404);
  await stop(p);
});

test('the long call returns as soon as another process writes to the memory', async () => {
  const where = home();
  await seed(where);
  const p = await start(where);
  const first = json<{ v: number }>(await call(p, '/live?v=-1')).v;
  const began = Date.now();
  const waiting = call(p, `/live?v=${first}`);
  await sleep(400);
  assert.equal(hook(where, 'claude-code', { hook_event_name: 'UserPromptSubmit', session_id: 's-3', cwd: KILN, prompt: 'look at the glaze recipe table once more' }).code, 0);
  const next = json<{ v: number }>(await waiting).v;
  assert.notEqual(next, first);
  assert.ok(Date.now() - began >= 400 && Date.now() - began < 6000, `${Date.now() - began} ms`);
  await stop(p);
});

test('delete empties the memory and no saved text stays in the memory files', async () => {
  const where = home();
  await seed(where);
  const p = await start(where);
  const bytes = (): string => readdirSync(where.AGENT_CTX_HOME).filter((name) => name.startsWith('memory.db')).map((name) => readFileSync(join(where.AGENT_CTX_HOME, name)).toString('latin1')).join('');
  assert.ok(bytes().includes(GOAL));
  assert.equal((await call(p, '/account', { method: 'DELETE', headers: { origin: 'https://evil.example' } })).status, 403);
  assert.ok(bytes().includes(GOAL));
  const gone = await call(p, '/account', { method: 'DELETE' });
  assert.deepEqual([gone.status, gone.text], [200, '{"ok":true}']);
  for (const table of ['items', 'events', 'sessions', 'projects', 'paths', 'aliases', 'agents', 'queue']) assert.equal(rows<{ n: number }>(where, `SELECT COUNT(*) AS n FROM ${table}`)[0].n, 0, table);
  for (const text of [GOAL, 'Unload the kiln', RULE.words]) assert.equal(bytes().includes(text), false, text);
  assert.deepEqual(json<Space>(await call(p, '/space')).items, []);
  assert.equal((await server(where, 'cursor', [['checkpoint', { folder: KILN, goal: 'Mix a new glaze batch' }]]))[0].startsWith('Checkpoint saved.'), true);
  assert.deepEqual(json<Space>(await call(p, '/space')).items.map((i) => i.body.goal), ['Mix a new glaze batch']);
  await stop(p);
});

test('Connect shows the plain lines first and writes on the second call, and Disconnect puts every file back', async () => {
  const where = home();
  for (const folder of ['.claude', '.cursor']) mkdirSync(join(where.HOME, folder), { recursive: true });
  const mcp = join(where.HOME, '.cursor', 'mcp.json');
  const hooks = join(where.HOME, '.cursor', 'hooks.json');
  put(mcp, FILES_SERVER);
  const before = tree(where.HOME);
  const p = await start(where);
  const agents = (): Promise<{ agents: { id: string; connected: boolean }[] }> => call(p, '/agents').then((got) => json(got));
  assert.deepEqual(await agents(), { agents: [{ id: 'claude-code', connected: false }, { id: 'cursor', connected: false }] });
  const on = json<Plan>(await call(p, '/agents/cursor/plan'));
  assert.deepEqual(on, {
    connected: false,
    command: null,
    ready: true,
    lines: [
      `The program is copied to ${app(where)}.`,
      `The server agent-ctx is added to ${mcp}.`,
      `${hooks} is created with the agent-ctx hooks for sessionStart, beforeSubmitPrompt, postToolUse, afterAgentResponse and stop.`,
    ],
  });
  assert.deepEqual([tree(where.HOME), existsSync(app(where))], [before, false]);
  for (const line of on.lines) assert.equal(BANNED.exec(plain(line, where)), null, line);
  assert.equal((await call(p, '/agents/cursor', { method: 'POST', body: { on: true, lines: on.lines.slice(1) } })).status, 409);
  assert.equal((await call(p, '/agents/cursor', { method: 'POST', body: { on: false, lines: on.lines } })).status, 409);
  assert.equal((await call(p, '/agents/cursor', { method: 'POST', body: { on: true, lines: on.lines }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.deepEqual([tree(where.HOME), existsSync(app(where))], [before, false]);
  const wrote = await call(p, '/agents/cursor', { method: 'POST', body: { on: true, lines: on.lines } });
  assert.deepEqual([wrote.status, wrote.text], [200, '{"connected":true}']);
  const doc = JSON.parse(readFileSync(mcp, 'utf8')) as { mcpServers: Record<string, { args: string[] }> };
  assert.deepEqual([Object.keys(doc.mcpServers), doc.mcpServers['agent-ctx'].args], [['files', 'agent-ctx'], [app(where, 'agent-ctx.mjs'), 'mcp', '--agent', 'cursor']]);
  assert.ok(readFileSync(hooks, 'utf8').includes(`${app(where, 'hook.mjs')} --agent cursor`));
  for (const name of ['agent-ctx.mjs', 'hook.mjs', 'LICENSES.txt']) assert.ok(readFileSync(app(where, name)).equals(readFileSync(join(SCRIPTS, name))), name);
  assert.deepEqual(await agents(), { agents: [{ id: 'claude-code', connected: false }, { id: 'cursor', connected: true }] });
  assert.ok(said(run(MAIN, ['status'], where).out).includes('Cursor is connected.'));
  const off = json<Plan>(await call(p, '/agents/cursor/plan'));
  assert.deepEqual(off, {
    connected: true,
    command: null,
    ready: true,
    lines: [
      `The server agent-ctx is removed from ${mcp}.`,
      `${hooks} contained only agent-ctx entries and is removed.`,
      `${mcp}.agent-ctx-backup is removed, because ${mcp} is back to the text from before the install.`,
    ],
  });
  assert.equal((await call(p, '/agents/cursor', { method: 'POST', body: { on: false, lines: off.lines } })).text, '{"connected":false}');
  assert.deepEqual(tree(where.HOME), before);
  assert.deepEqual(await agents(), { agents: [{ id: 'claude-code', connected: false }, { id: 'cursor', connected: false }] });
  for (const path of ['/agents/codex/plan', '/agents/vim/plan', '/agents/__proto__/plan']) assert.equal((await call(p, path)).status, 404, path);
  assert.equal((await call(p, '/agents/codex', { method: 'POST', body: { on: true, lines: [] } })).status, 404);
  await stop(p);
});

test('Claude Code gets the command to type and no command is run from the page', async () => {
  const where = home();
  mkdirSync(join(where.HOME, '.claude'), { recursive: true });
  const before = tree(where.HOME);
  const p = await start(where);
  assert.deepEqual(json<Plan>(await call(p, '/agents/claude-code/plan')), { connected: false, command: INSTALL, lines: [], ready: false });
  const refused = await call(p, '/agents/claude-code', { method: 'POST', body: { on: true, lines: [] } });
  assert.deepEqual([refused.status, json<{ error: string }>(refused).error], [400, 'Type the command in a terminal.']);
  assert.deepEqual([calls(where), tree(where.HOME), existsSync(app(where))], [[], before, false]);
  put(join(where.HOME, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'agent-ctx@agent-ctx': [{ scope: 'user' }] } });
  assert.deepEqual(json<Plan>(await call(p, '/agents/claude-code/plan')), { connected: true, command: 'claude plugin uninstall agent-ctx', lines: [], ready: false });
  assert.deepEqual(calls(where), []);
  await stop(p);
});

test('the page files are fetched once from the release address, checked against the hash and kept in the app folder', async () => {
  const where = home();
  const made = pack(FILES, join(TMP, 'good', NAME));
  const bytes = readFileSync(made.path);
  assert.deepEqual(made.files, ['_headers', 'assets/app.js', 'favicon.svg', 'index.html']);
  const site = await releases({ [NAME]: bytes, SHA256SUMS: `${'0'.repeat(64)}  agent-ctx.mcpb\n${sums(bytes)}` });
  const p = await start(where, { AGENT_CTX_RELEASES: site.base }, null);
  assert.equal(p.lines.length, 2, p.out());
  assert.equal(p.lines[0], `The page files were fetched once and are kept in ${app(where, 'page')}.`);
  assert.equal(BANNED.exec(plain(p.lines[0], where)), null, p.lines[0]);
  assert.deepEqual(tree(app(where, 'page')), tree(FILES));
  assert.deepEqual(readdirSync(app(where)), ['page']);
  assert.equal((await ask(p.port, `/${p.token}/assets/app.js`)).text, 'document.title = "ready";\n');
  assert.deepEqual(site.hits.sort(), ['SHA256SUMS', NAME]);
  await stop(p);
  const again = await start(where, { AGENT_CTX_RELEASES: site.base }, null);
  assert.deepEqual([again.lines.length, site.hits.length], [1, 2]);
  await stop(again);
  assert.equal(run(MAIN, ['install', '--yes'], where).code, 0);
  const out = run(MAIN, ['uninstall', '--yes'], where);
  assert.deepEqual([out.code, existsSync(app(where)), out.out.includes('stays in place')], [0, false, false], out.out);
});

test('two packs of the same files give identical bytes with fixed dates', () => {
  const copy = join(TMP, 'copy');
  for (const [name, data] of Object.entries(tree(FILES))) if (!name.endsWith('/')) put(join(copy, name), Buffer.from(data, 'base64').toString('utf8'));
  const a = pack(FILES, join(TMP, 'a', NAME));
  const b = pack(copy, join(copy, NAME));
  assert.ok(readFileSync(a.path).equals(readFileSync(b.path)), 'the two packs differ');
  assert.equal(a.sha256, createHash('sha256').update(readFileSync(b.path)).digest('hex'));
  assert.ok(pack(copy, join(copy, NAME)).files.every((name) => name !== NAME));
  const listed = spawnSync('tar', ['-tvzf', a.path], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', TZ: 'UTC' } });
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.stdout.trim().split('\n').length, 4);
  for (const row of listed.stdout.trim().split('\n')) assert.match(row, /^-rw-r--r--\s.*\bJan\s+1\s+1970\b/, row);
});

test('a wrong hash, a missing file and an entry that points outside the folder each end in one plain line and change nothing', async () => {
  const good = readFileSync(pack(FILES, join(TMP, 'plain', NAME)).path);
  const outside = gzipSync(Buffer.concat([entry('index.html', 'inside'), entry('../outside.txt', 'overwritten'), Buffer.alloc(1024)]));
  const cases: [Record<string, Buffer | string>, RegExp][] = [
    [{ [NAME]: good, SHA256SUMS: `${'0'.repeat(64)}  ${NAME}\n` }, /^The fetched page files do not match the hash in SHA256SUMS, so nothing was kept\.$/],
    [{ [NAME]: good, SHA256SUMS: sums(good).replace(NAME, 'agent-ctx.mcpb') }, /^The fetched page files do not match the hash in SHA256SUMS, so nothing was kept\.$/],
    [{ [NAME]: good }, /^The page files could not be fetched from http:\/\/127\.0\.0\.1:\d+, so nothing was changed\.$/],
    [{ SHA256SUMS: sums(good) }, /^The page files could not be fetched from http:\/\/127\.0\.0\.1:\d+, so nothing was changed\.$/],
    [{ [NAME]: outside, SHA256SUMS: sums(outside) }, /^The fetched page files could not be unpacked, so nothing was kept\.$/],
    [{ [NAME]: Buffer.from('not a packed folder'), SHA256SUMS: sums(Buffer.from('not a packed folder')) }, /^The fetched page files could not be unpacked, so nothing was kept\.$/],
  ];
  for (const [files, line] of cases) {
    const where = home();
    const site = await releases(files);
    const s = launch(where, { AGENT_CTX_RELEASES: site.base }, null);
    assert.equal(await s.ended, 1, s.out());
    assert.equal(said(s.out()).length, 1, s.out());
    assert.match(said(s.out())[0], line);
    assert.equal(BANNED.exec(said(s.out())[0].replace(/http:\S+/, 'ADDRESS')), null, s.out());
    assert.equal(existsSync(where.AGENT_CTX_HOME), false, s.out());
  }
  assert.equal(readFileSync(join(TMP, 'outside.txt'), 'utf8'), OUTSIDE);
  const where = home();
  const down = launch(where, { AGENT_CTX_RELEASES: 'http://127.0.0.1:9' }, null);
  assert.deepEqual([await down.ended, said(down.out())], [1, ['The page files could not be fetched from http://127.0.0.1:9, so nothing was changed.']]);
  assert.equal(existsSync(where.AGENT_CTX_HOME), false);
  const empty = launch(home(), { AGENT_CTX_PAGE_DIR: join(TMP, 'nowhere') });
  assert.deepEqual([await empty.ended, said(empty.out())], [1, [`No page files were found in ${join(TMP, 'nowhere')}, so nothing was started.`]]);
});

test('a path that points outside the page folder is never served', async () => {
  const p = await start(home());
  for (const path of ['../outside.txt', '..%2foutside.txt', '%2e%2e/outside.txt', 'assets/../../outside.txt', 'assets/..%2f..%2foutside.txt', '.%2e/outside.txt', '%2e%2e%5coutside.txt', 'assets%2f..%2f..%2foutside.txt', '/etc/hosts', 'assets/%00', 'index.html%00.js']) {
    const got = await ask(p.port, `/${p.token}/${path}`);
    assert.ok(got.status === 404 || got.status === 403, `${path} gave ${got.status}`);
    assert.equal(got.text.includes(OUTSIDE), false, path);
    assert.equal(got.text.includes('localhost'), false, path);
  }
  await stop(p);
});

test('every line that page prints passes the wording rules', async () => {
  const where = home();
  const p = await start(where);
  await stop(p);
  const inside = launch(where, { CODEX_SANDBOX: '1' });
  await inside.ended;
  for (const line of [...p.lines, ...said(inside.out()), REFUSED]) {
    assert.equal(BANNED.exec(plain(line.replace(/http:\S+/, 'ADDRESS').replace(/npx -y \S+/, 'COMMAND'), where)), null, line);
  }
  const older = run(MAIN, ['page'], where, '', { AGENT_CTX_NO_OPEN: '1', AGENT_CTX_PAGE_DIR: join(TMP, 'nowhere') });
  assert.equal(BANNED.exec(plain(older.out, where).replace(TMP, '')), null, older.out);
});

test('the server ends by itself 30 seconds after the last call', async () => {
  const p = await start(home());
  assert.equal((await call(p, '/me')).status, 200);
  const began = Date.now();
  assert.equal(await p.ended, 0);
  const waited = Date.now() - began;
  assert.ok(waited > 27000 && waited < 40000, `${waited} ms`);
  assert.equal(await reach('127.0.0.1', p.port), false);
});
