import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';
import { toolList } from '../../service/src/mcp.ts';

type Json = Record<string, unknown>;
interface Made { path: string; size: number; sha256: string }
interface Packer { ENTRY: string; ICON: string; pack: (entry?: string, out?: string) => Made }
interface Entry { data: Buffer; crc: number; size: number; method: number; time: number; date: number; made: number; mode: number }
interface Manifest {
  manifest_version: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: { name: string };
  repository: { type: string; url: string };
  icon: string;
  server: { type: string; entry_point: string; mcp_config: { command: string; args: string[] } };
  tools: { name: string; description: string }[];
  license: string;
  compatibility: { runtimes: { node: string } };
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'local', 'pack.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'agent-ctx-pack-'));
const REAL = join(userInfo().homedir, '.agent-ctx');
const REAL_BEFORE = existsSync(REAL);
const SLOW = { timeout: 120000 };

const { ENTRY, ICON, pack } = (await import(pathToFileURL(SCRIPT).href)) as Packer;

const started: ChildProcessWithoutNullStreams[] = [];

after(() => {
  for (const child of started) if (child.exitCode === null) child.kill();
  rmSync(TMP, { recursive: true, force: true });
});

function read(bytes: Buffer): Map<string, Entry> {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'the last 22 bytes are the end record');
  const files = new Map<string, Entry>();
  let at = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50, 'an index row starts with the index mark');
    const name = bytes.toString('utf8', at + 46, at + 46 + bytes.readUInt16LE(at + 28));
    const local = bytes.readUInt32LE(at + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const body = bytes.subarray(start, start + bytes.readUInt32LE(at + 20));
    const method = bytes.readUInt16LE(at + 10);
    files.set(name, {
      data: method === 8 ? inflateRawSync(body) : Buffer.from(body),
      crc: bytes.readUInt32LE(at + 16),
      size: bytes.readUInt32LE(at + 24),
      method,
      time: bytes.readUInt16LE(at + 12),
      date: bytes.readUInt16LE(at + 14),
      made: bytes.readUInt16LE(at + 4) >> 8,
      mode: bytes.readUInt32LE(at + 38) >>> 16,
    });
    at += 46 + bytes.readUInt16LE(at + 28) + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return files;
}

function only(value: object, allowed: string[], where: string): void {
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${where} has the field ${key}, which the specification does not list`);
}

function talk(child: ChildProcessWithoutNullStreams): (id: number, method: string, params: Json) => Promise<Json> {
  const pending = new Map<number, { done: (message: Json) => void; fail: (error: Error) => void }>();
  let text = '';
  let errors = '';
  let closed = false;
  const stopped = () => new Error(`The server stopped before an answer arrived. ${errors}`);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdin.on('error', () => undefined);
  child.stderr.on('data', (chunk: string) => { errors += chunk; });
  child.stdout.on('data', (chunk: string) => {
    const rows = (text + chunk).split('\n');
    text = rows.pop() ?? '';
    for (const row of rows.filter((r) => r.trim())) {
      const message = JSON.parse(row) as Json;
      const wait = pending.get(message.id as number);
      pending.delete(message.id as number);
      wait?.done(message);
    }
  });
  child.on('close', () => {
    closed = true;
    for (const wait of pending.values()) wait.fail(stopped());
    pending.clear();
  });
  return (id, method, params) =>
    new Promise<Json>((done, fail) => {
      if (closed) return fail(stopped());
      pending.set(id, { done, fail });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
}

const BUILT = pack(ENTRY, join(TMP, 'agent-ctx.mcpb'));
const BYTES = readFileSync(BUILT.path);
const FILES = read(BYTES);
const MANIFEST = JSON.parse(FILES.get('manifest.json')?.data.toString('utf8') ?? 'null') as Manifest;
const VERSION = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

test('two builds from the same input give identical bytes with fixed dates', (t) => {
  const first = join(TMP, 'first.js');
  const second = join(TMP, 'second.js');
  copyFileSync(ENTRY, first);
  copyFileSync(ENTRY, second);
  utimesSync(first, 990000000, 990000000);
  utimesSync(second, 1940000000, 1940000000);
  chmodSync(first, 0o600);
  chmodSync(second, 0o755);
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2001, 4, 16, 8, 0, 0) });
  const a = pack(first, join(TMP, 'first.mcpb'));
  t.mock.timers.setTime(Date.UTC(2031, 10, 9, 13, 14, 15));
  const b = pack(second, join(TMP, 'deep', 'second.mcpb'));
  t.mock.timers.reset();
  assert.ok(readFileSync(a.path).equals(readFileSync(b.path)), 'the two bundles differ');
  assert.equal(a.sha256, b.sha256);
  assert.ok(readFileSync(a.path).equals(BYTES), 'a build from a copy differs from a build from the entry file');
  for (const [name, entry] of read(readFileSync(b.path))) {
    assert.deepEqual([name, entry.date, entry.time], [name, 0x21, 0], 'every entry carries 1980-01-01 00:00:00');
  }
});

test('the bundle is a valid zip for the reader in this file and for unzip', SLOW, () => {
  const end = BYTES.length - 22;
  assert.equal(BYTES.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), end);
  assert.equal(BYTES.readUInt16LE(end + 8), BYTES.readUInt16LE(end + 10));
  assert.equal(BYTES.readUInt32LE(end + 16) + BYTES.readUInt32LE(end + 12), end, 'the index ends where the end record starts');
  assert.equal(BYTES.readUInt32LE(0), 0x04034b50, 'the file starts with a local header');
  assert.deepEqual([...FILES.keys()], ['manifest.json', 'README.md', 'icon.png', MANIFEST.server.entry_point]);
  for (const [name, entry] of FILES) {
    assert.equal(entry.data.length, entry.size, `${name} has the stated size`);
    assert.equal(crc32(entry.data), entry.crc, `${name} has the stated checksum`);
    assert.ok(entry.method === 8 || entry.method === 0, `${name} is deflated or stored`);
    assert.deepEqual([entry.made, entry.mode], [3, 0o100644], `${name} is a plain file with Unix rights`);
  }
  const tested = spawnSync('unzip', ['-t', BUILT.path], { encoding: 'utf8' });
  if ((tested.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return;
  assert.equal(tested.status, 0, tested.stdout + tested.stderr);
  assert.match(tested.stdout, /No errors detected/);
});

test('the manifest holds every required field and names an entry file inside the bundle', () => {
  only(MANIFEST, ['$schema', 'dxt_version', 'manifest_version', 'name', 'display_name', 'version', 'description', 'long_description', 'author', 'repository', 'homepage', 'documentation', 'support', 'icon', 'icons', 'screenshots', 'localization', 'server', 'tools', 'tools_generated', 'prompts', 'prompts_generated', 'keywords', 'license', 'privacy_policies', 'compatibility', 'user_config', '_meta'], 'the manifest');
  only(MANIFEST.author, ['name', 'email', 'url'], 'author');
  only(MANIFEST.repository, ['type', 'url'], 'repository');
  only(MANIFEST.server, ['type', 'entry_point', 'mcp_config'], 'server');
  only(MANIFEST.server.mcp_config, ['command', 'args', 'env', 'platform_overrides'], 'mcp_config');
  only(MANIFEST.compatibility, ['claude_desktop', 'platforms', 'runtimes'], 'compatibility');
  only(MANIFEST.compatibility.runtimes, ['python', 'node'], 'runtimes');
  for (const tool of MANIFEST.tools) only(tool, ['name', 'description'], `the tool ${tool.name}`);
  assert.equal(MANIFEST.manifest_version, '0.3');
  assert.equal(MANIFEST.name, 'agent-ctx');
  assert.match(MANIFEST.display_name, /\S/);
  assert.match(MANIFEST.version, /^\d+\.\d+\.\d+$/);
  assert.ok(MANIFEST.description.length > 0 && MANIFEST.description.length <= 100, `the description has ${MANIFEST.description.length} characters`);
  assert.match(MANIFEST.author.name, /\S/);
  assert.equal(MANIFEST.license, 'MIT');
  assert.equal(MANIFEST.repository.type, 'git');
  assert.match(MANIFEST.repository.url, /^https:\/\/github\.com\/[\w-]+\/agent-ctx$/);
  assert.equal(MANIFEST.server.type, 'node');
  assert.match(MANIFEST.server.entry_point, /^server\/[\w.-]+\.(?:js|mjs|cjs)$/);
  assert.equal(MANIFEST.server.mcp_config.command, 'node');
  assert.deepEqual(MANIFEST.server.mcp_config.args, ['${__dirname}/' + MANIFEST.server.entry_point, 'mcp', '--agent', 'claude-desktop']);
  assert.equal(MANIFEST.compatibility.runtimes.node, '>=22.16.0');
  assert.equal('user_config' in MANIFEST, false);
  const entry = FILES.get(MANIFEST.server.entry_point);
  assert.ok(entry, `${MANIFEST.server.entry_point} is missing from the bundle`);
  assert.ok(entry.data.equals(readFileSync(ENTRY)), 'the entry file in the bundle differs from the built program');
});

test('the icon named in the manifest is the plugin icon and meets the size rules', () => {
  const icon = FILES.get(MANIFEST.icon)?.data;
  assert.ok(icon, `${MANIFEST.icon} is missing from the bundle`);
  assert.equal(MANIFEST.icon, 'icon.png');
  assert.ok(icon.equals(readFileSync(ICON)));
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(icon.toString('latin1', 12, 16), 'IHDR');
  assert.equal(icon.readUInt32BE(16), icon.readUInt32BE(20), 'the icon is square');
  assert.ok(icon.readUInt32BE(16) >= 256, `the icon is ${icon.readUInt32BE(16)} pixels wide`);
  assert.ok([4, 6].includes(icon[25]), 'the icon has an alpha channel');
});

test('the tool names in the manifest equal the names in the exported tool list', () => {
  assert.deepEqual(MANIFEST.tools.map((tool) => tool.name), toolList().map((tool) => tool.name));
  assert.equal(MANIFEST.tools.length, 5);
  for (const tool of MANIFEST.tools) assert.match(tool.description, /^\S[^\n]*\S$/, `${tool.name} has one line`);
});

test('the version in the manifest equals package.json', () => {
  assert.equal(MANIFEST.version, VERSION);
});

test('the entry file of an unpacked bundle answers initialize over stdio', SLOW, async () => {
  const folder = join(TMP, 'unpacked');
  const home = join(TMP, 'home');
  mkdirSync(home);
  for (const [name, entry] of FILES) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    writeFileSync(join(folder, name), entry.data);
  }
  assert.equal(MANIFEST.server.mcp_config.command, 'node');
  const args = MANIFEST.server.mcp_config.args.map((arg) => arg.replace('${__dirname}', folder));
  const child = spawn(process.execPath, args, { cwd: home, env: { PATH: process.env.PATH, HOME: home, AGENT_CTX_HOME: join(home, 'memory') } });
  started.push(child);
  const call = talk(child);
  const hello = await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pack-test', version: '0' } });
  const result = hello.result as { protocolVersion: string; serverInfo: { name: string }; capabilities: { tools?: unknown } };
  assert.equal(result.serverInfo.name, 'agent-ctx');
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.ok(result.capabilities.tools);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const listed = await call(2, 'tools/list', {});
  const served = (listed.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
  assert.deepEqual(MANIFEST.tools.map((tool) => tool.name), served);
  const ended = new Promise<number | null>((done) => child.on('close', done));
  child.stdin.end();
  assert.equal(await ended, 0);
  assert.equal(existsSync(REAL), REAL_BEFORE, 'the real memory folder was touched');
});

test('the README and every description in the manifest pass the wording rules', () => {
  const readme = FILES.get('README.md')?.data.toString('utf8') ?? '';
  assert.match(readme, /stored/);
  assert.match(readme, /stays on this computer/);
  assert.ok(readme.trim().split('\n').filter((line) => line.trim()).length <= 6, 'the README has a few lines');
  const texts = [readme, MANIFEST.description, MANIFEST.display_name, ...MANIFEST.tools.map((tool) => tool.description)];
  assert.equal(texts.length, 8);
  for (const text of texts) {
    assert.match(text, /\S/);
    assert.equal(/\b(?:it|its|itself|it's|them|they)\b|[‒-―;()]| - |:(?:\s|$)/im.exec(text), null, text);
  }
});

test('the script prints the path, the size and the SHA-256 of the bundle', SLOW, () => {
  const out = join(TMP, 'printed', 'agent-ctx.mcpb');
  const run = spawnSync(process.execPath, [SCRIPT, ENTRY, out], { encoding: 'utf8', cwd: TMP });
  assert.equal(run.status, 0, run.stderr);
  const bytes = readFileSync(out);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(run.stdout.split('\n'), [`Bundle written to ${out}`, `Size ${statSync(out).size} bytes`, `SHA-256 ${sha256}`, '']);
  assert.equal(sha256, BUILT.sha256);
  assert.equal(bytes.length, BUILT.size);
  assert.ok(bytes.equals(BYTES), 'a build in a second process differs');
});

test('a missing entry file ends in one plain line and no bundle', SLOW, () => {
  const out = join(TMP, 'none', 'agent-ctx.mcpb');
  const missing = join(TMP, 'absent.js');
  const run = spawnSync(process.execPath, [SCRIPT, missing, out], { encoding: 'utf8', cwd: TMP });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr, `No built program was found at ${missing}. Run npm run build first.\n`);
  assert.equal(existsSync(out), false);
});
