import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanOrigin, currentOrigin, NAMES, PLUGINS, stamp } from '../plugins/stamp.mjs';
import { MAX } from '../src/limits.ts';
import { ITEM_BYTES, STORE_BYTES } from '../../core/src/index.ts';
import { PAGE, PLUGINS_OUT, SAY, SERVICE } from '../deploy.mjs';
import { BASELINE, REVISIONS, withToken } from './conformance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Json = Record<string, unknown>;
interface Handler { type?: string; server?: string; tool?: string; input?: Record<string, string>; [k: string]: unknown }
interface Group { matcher?: string; hooks: Handler[] }

const COMMITTED = PLUGINS;
const SERVER = { 'claude-code': 'plugin:agent-ctx:agent-ctx', codex: 'agent-ctx' } as const;
const HOOKS = { 'claude-code': join('claude-code', 'hooks', 'hooks.json'), codex: join('codex', 'hooks.json') } as const;
const FIELDS = new Set(['session_id', 'cwd', 'prompt', 'tool_name', 'tool_input.file_path', 'tool_input.notebook_path', 'tool_input.command', 'last_assistant_message', 'error', 'compact_summary', 'source']);
const URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.sort();
}

function plugins(dir: string): string[] {
  return walk(dir).filter((f) => NAMES.some((n: string) => relative(dir, f).startsWith(`${n}/`)));
}

function read(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}

function groups(dir: string, plugin: keyof typeof HOOKS): [string, Group][] {
  const hooks = read(join(dir, HOOKS[plugin])).hooks as Record<string, Group[]>;
  return Object.entries(hooks).flatMap(([event, list]) => list.map((g) => [event, g] as [string, Group]));
}

function fresh(origin: string, bearer?: string): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'stamp-'));
  stamp(origin, dir, bearer);
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const ORIGINS = ['http://localhost:8790', 'https://agent-ctx.invalid'];

function eachCopy(fn: (dir: string, origin: string) => void): void {
  for (const origin of ORIGINS) {
    const s = fresh(origin);
    try {
      fn(s.dir, origin);
    } finally {
      s.done();
    }
  }
  fn(COMMITTED, 'https://agent-ctx.invalid');
}

test('every address in a stamped copy has the one origin', () => {
  eachCopy((dir, origin) => {
    let found = 0;
    for (const f of plugins(dir)) {
      const text = readFileSync(f, 'utf8');
      assert.equal(text.includes('__ORIGIN__'), false, f);
      for (const m of text.matchAll(URL_RE)) {
        found++;
        assert.equal(new URL(m[0]).origin, origin, `${f} names ${m[0]}`);
      }
    }
    assert.ok(found >= 2, `${dir} names ${found} addresses`);
  });
});

test('each plugin in a stamped copy holds only JSON, one README and at most one icon', () => {
  eachCopy((dir) => {
    const files = plugins(dir).map((f) => relative(dir, f));
    const extra: Record<string, string[]> = { 'claude-code': [join('claude-code', '.claude-plugin', 'icon.png')], codex: [] };
    for (const plugin of ['claude-code', 'codex']) {
      const other = files.filter((f) => f.startsWith(`${plugin}/`) && !f.endsWith('.json'));
      assert.deepEqual(other.sort(), [...extra[plugin], `${plugin}/README.md`].sort(), files.join(' '));
    }
    for (const f of files.filter((x) => x.endsWith('.json'))) assert.doesNotThrow(() => read(join(dir, f)), f);
  });
});

test('the Claude Code README says what leaves the machine and how to remove the plugin in 40 to 60 plain words', () => {
  eachCopy((dir) => {
    const text = readFileSync(join(dir, 'claude-code', 'README.md'), 'utf8');
    const words = text.replace(/^#.*$/m, '').split(/\s+/).filter(Boolean);
    assert.ok(words.length >= 40 && words.length <= 60, String(words.length));
    assert.equal(/[\u2013\u2014;()]|\w: |\bit(?:s|self|'s)?\b/i.test(text), false, text);
    for (const need of ['prompts', 'file paths', 'commands', 'reply', 'tool output', '/plugin uninstall agent-ctx']) assert.ok(text.includes(need), need);
  });
});

test('the Claude Code manifest names the privacy page of the one origin', () => {
  eachCopy((dir, origin) => {
    assert.equal(read(join(dir, 'claude-code', '.claude-plugin', 'plugin.json')).privacyPolicyUrl, `${origin}/privacy`);
  });
});

test('every hook is of type mcp_tool, names no command and calls the event tool', () => {
  eachCopy((dir) => {
    for (const plugin of ['claude-code', 'codex'] as const) {
      const all = groups(dir, plugin);
      assert.ok(all.length >= 3, plugin);
      for (const [event, g] of all) {
        assert.ok(g.hooks.length >= 1, `${plugin} ${event}`);
        for (const h of g.hooks) {
          assert.equal(h.type, 'mcp_tool', `${plugin} ${event}`);
          for (const k of ['command', 'args', 'url', 'prompt', 'shell', 'headers', 'async']) assert.equal(k in h, false, `${plugin} ${event} has ${k}`);
          assert.equal(h.tool, 'event', `${plugin} ${event}`);
          assert.equal(h.input?.host, plugin, `${plugin} ${event}`);
          assert.equal(h.input?.event, event, `${plugin} ${event}`);
        }
      }
    }
  });
});

test('every Claude Code hook calls the server the plugin bundles', () => {
  eachCopy((dir) => {
    const manifest = read(join(dir, 'claude-code', '.claude-plugin', 'plugin.json'));
    const servers = manifest.mcpServers as Record<string, { type: string; url: string }>;
    assert.equal(manifest.name, 'agent-ctx');
    assert.deepEqual(Object.keys(servers), ['agent-ctx']);
    assert.equal(servers['agent-ctx'].type, 'http');
    assert.equal(`plugin:${manifest.name}:${Object.keys(servers)[0]}`, SERVER['claude-code']);
    for (const [event, g] of groups(dir, 'claude-code')) for (const h of g.hooks) assert.equal(h.server, SERVER['claude-code'], event);
    const codex = read(join(dir, 'codex', 'mcp.json')).mcpServers as Record<string, unknown>;
    assert.deepEqual(Object.keys(codex), [SERVER.codex]);
    for (const [event, g] of groups(dir, 'codex')) for (const h of g.hooks) assert.equal(h.server, SERVER.codex, event);
  });
});

test('hook inputs read only the documented fields and never tool output', () => {
  eachCopy((dir) => {
    for (const plugin of ['claude-code', 'codex'] as const) {
      for (const [event, g] of groups(dir, plugin)) {
        for (const h of g.hooks) {
          for (const [k, v] of Object.entries(h.input ?? {})) {
            if (k === 'host' || k === 'event') continue;
            const m = /^\$\{([^}]+)\}$/.exec(v);
            assert.ok(m, `${plugin} ${event} ${k} is ${v}`);
            assert.ok(FIELDS.has(m[1]), `${plugin} ${event} ${k} reads ${m[1]}`);
          }
        }
      }
    }
  });
});

test('the Claude Code hooks cover the planned events and nothing else', () => {
  eachCopy((dir) => {
    const all = groups(dir, 'claude-code');
    const events = [...new Set(all.map(([e]) => e))].sort();
    assert.deepEqual(events, ['PostCompact', 'PostToolUse', 'PostToolUseFailure', 'SessionStart', 'Stop', 'StopFailure', 'UserPromptSubmit']);
    const matchers = all.filter(([e]) => e === 'PostToolUse').map(([, g]) => g.matcher ?? '');
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']) assert.equal(matchers.filter((m) => m.split('|').includes(tool)).length, 1, tool);
    for (const [, g] of all) assert.equal(/agent.?ctx|mcp__/i.test(g.matcher ?? ''), false, g.matcher);
    assert.deepEqual(all.find(([e]) => e === 'SessionStart')?.[1].matcher, 'clear|compact');
  });
});

test('the Codex manifest names the hooks file that the other tests read', () => {
  eachCopy((dir) => {
    const folder = join(dir, 'codex');
    const ext = read(join(folder, 'plugin.json')).extensions as Record<string, { hooks?: unknown }> | undefined;
    const path = ext?.['com.openai']?.hooks;
    assert.equal(typeof path, 'string', JSON.stringify(ext));
    const named = path as string;
    assert.ok(named.startsWith('./'), named);
    assert.equal(named.split(/[\\/]/).includes('..'), false, named);
    const file = resolve(folder, named);
    assert.ok(file.startsWith(folder + sep), named);
    assert.ok(existsSync(file) && statSync(file).isFile(), named);
    assert.equal(file, join(dir, HOOKS.codex), named);
  });
});

test('the bearer flag puts a header on the server entries and nowhere else', () => {
  const s = fresh('http://localhost:8790', 'fake-test-token-1');
  try {
    const cc = (read(join(s.dir, 'claude-code', '.claude-plugin', 'plugin.json')).mcpServers as Record<string, { headers?: Record<string, string> }>)['agent-ctx'];
    assert.deepEqual(cc.headers, { Authorization: 'Bearer fake-test-token-1' });
    for (const [, g] of groups(s.dir, 'claude-code')) for (const h of g.hooks) assert.equal(JSON.stringify(h).includes('fake-test-token-1'), false);
  } finally {
    s.done();
  }
  eachCopy((dir) => {
    for (const f of plugins(dir)) assert.equal(readFileSync(f, 'utf8').includes('Bearer'), false, f);
  });
});

test('the stamp copies the icon byte for byte', () => {
  eachCopy((dir) => {
    const icon = join('claude-code', '.claude-plugin', 'icon.png');
    const source = readFileSync(join(COMMITTED, icon));
    assert.equal(source.subarray(1, 4).toString('latin1'), 'PNG');
    assert.ok(readFileSync(join(dir, icon)).equals(source));
  });
});

test('the committed copy is a fresh stamp of the invalid origin', () => {
  assert.equal(currentOrigin(), 'https://agent-ctx.invalid');
  const s = fresh('https://agent-ctx.invalid');
  const round = fresh('http://localhost:8790');
  try {
    const want = plugins(s.dir).map((f) => relative(s.dir, f));
    const have = plugins(COMMITTED).map((f) => relative(COMMITTED, f));
    assert.deepEqual(have, want);
    for (const f of want) assert.ok(readFileSync(join(COMMITTED, f)).equals(readFileSync(join(s.dir, f))), f);
    assert.equal(currentOrigin(round.dir), 'http://localhost:8790');
    stamp('https://agent-ctx.invalid', undefined, undefined, round.dir);
    for (const f of want) assert.ok(readFileSync(join(COMMITTED, f)).equals(readFileSync(join(round.dir, f))), `round trip ${f}`);
  } finally {
    s.done();
    round.done();
  }
});

test('the stamp takes an origin alone', () => {
  assert.equal(cleanOrigin('https://agent-ctx.invalid/'), 'https://agent-ctx.invalid');
  for (const bad of ['https://agent-ctx.invalid/mcp', 'ftp://agent-ctx.invalid', 'agent-ctx.invalid', 'https://a:b@agent-ctx.invalid', '']) assert.throws(() => cleanOrigin(bad), bad);
  const dir = mkdtempSync(join(tmpdir(), 'stamp-'));
  try {
    assert.throws(() => stamp('https://agent-ctx.invalid', dir, 'two words'));
    stamp('https://agent-ctx.invalid', dir);
    assert.throws(() => stamp('https://agent-ctx.invalid', undefined, 'tok-1', dir), /another folder/);
    assert.equal(readFileSync(join(dir, 'codex', 'mcp.json'), 'utf8').includes('Bearer'), false);
    writeFileSync(join(dir, 'codex', 'mcp.json'), readFileSync(join(dir, 'codex', 'mcp.json'), 'utf8').replace('https://agent-ctx.invalid', 'https://other.invalid'));
    assert.throws(() => stamp('http://localhost:8790', undefined, undefined, dir), /2 origins/);
    assert.throws(() => stamp('https://agent-ctx.invalid', join(PLUGINS, 'codex', 'copy')), /outside the plugin folders/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the stamp never deletes a folder that an earlier stamp did not write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stamp-'));
  try {
    mkdirSync(join(dir, 'claude-code'));
    writeFileSync(join(dir, 'claude-code', 'notes.txt'), 'mine');
    writeFileSync(join(dir, 'other.txt'), 'mine too');
    stamp('https://agent-ctx.invalid', dir);
    stamp('http://localhost:8790', dir);
    assert.equal(readFileSync(join(dir, 'claude-code', 'notes.txt'), 'utf8'), 'mine');
    assert.equal(readFileSync(join(dir, 'other.txt'), 'utf8'), 'mine too');
    assert.ok(readFileSync(join(dir, 'claude-code', '.claude-plugin', 'plugin.json'), 'utf8').includes('http://localhost:8790'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const doc = readFileSync(new URL('../../docs/cost.md', import.meta.url), 'utf8');
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

const SCRIPT = join(ROOT, 'service', 'deploy.mjs');
const WRANGLER = join(SERVICE, 'node_modules', '.bin', 'wrangler');
const KV = '0123456789abcdef0123456789abcdef';
const ORIGIN = 'https://agent-ctx.example';

function deploy(args: string[]): { status: number | null; out: string } {
  const home = mkdtempSync(join(tmpdir(), 'deploy-home-'));
  try {
    const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: home };
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8', timeout: 180000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function withPage(fn: () => void): void {
  const made = !existsSync(PAGE);
  if (made) {
    mkdirSync(dirname(PAGE), { recursive: true });
    writeFileSync(PAGE, '<!doctype html><title>agent-ctx</title>\n');
  }
  try {
    fn();
  } finally {
    if (made) rmSync(dirname(PAGE), { recursive: true, force: true });
    rmSync(join(ROOT, 'out'), { recursive: true, force: true });
  }
}

test('the deploy script refuses a missing page, a local or plain origin and a bad KV id', { skip: !existsSync(WRANGLER) }, () => {
  if (!existsSync(PAGE)) {
    const r = deploy(['--origin', ORIGIN, '--kv', KV, '--dry-run']);
    assert.equal(r.status, 1);
    assert.equal(r.out.trim(), SAY.page);
    assert.equal(existsSync(PLUGINS_OUT), false);
  }
  withPage(() => {
    for (const origin of ['http://agent-ctx.example', 'https://localhost:8790', 'https://127.0.0.1', 'https://agent-ctx.example/mcp']) {
      const r = deploy(['--origin', origin, '--kv', KV, '--dry-run']);
      assert.equal(r.status, 1, origin);
      assert.equal(r.out.trim(), SAY.https, origin);
    }
    const bad = deploy(['--origin', ORIGIN, '--kv', 'replace-with-the-oauth-kv-namespace-id', '--dry-run']);
    assert.equal(bad.out.trim(), SAY.kv);
    assert.equal(deploy(['--origin', ORIGIN]).out.trim(), SAY.usage);
  });
});

test('a dry run stamps the plugins and bundles the production Worker with no account', { skip: !existsSync(WRANGLER) }, () => {
  withPage(() => {
    const r = deploy(['--origin', ORIGIN, '--kv', KV, '--dry-run']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /--dry-run: exiting now/);
    assert.ok(r.out.includes(`Running wrangler deploy --config wrangler.deploy.jsonc --env production --var MCP_RESOURCE:${ORIGIN}/mcp --dry-run`), r.out);
    assert.ok(r.out.includes(KV), r.out);
    assert.equal(r.out.includes('localhost'), false, r.out);
    const manifest = JSON.parse(readFileSync(join(PLUGINS_OUT, 'claude-code', '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.equal(manifest.mcpServers['agent-ctx'].url, `${ORIGIN}/mcp`);
    assert.equal(manifest.privacyPolicyUrl, `${ORIGIN}/privacy`);
    assert.equal(existsSync(join(SERVICE, 'wrangler.deploy.jsonc')), false);
  });
});

test('production keeps logs on and traces off, since raw text crosses the object call before redaction', () => {
  const cfg = JSON.parse(readFileSync(join(SERVICE, 'wrangler.jsonc'), 'utf8')) as { observability: unknown; env: { production: { observability: unknown; vars: Record<string, string> } } };
  const want = { enabled: true, logs: { enabled: true }, traces: { enabled: false } };
  assert.deepEqual(cfg.env.production.observability, want);
  assert.deepEqual(cfg.observability, want);
  assert.equal(cfg.env.production.vars.REGISTRATIONS_PER_DAY, '150');
});

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

test('every vendor fixture has one row that names the fixture document, the fixture file and every redirect the fixture lists', () => {
  const saved = JSON.parse(readFileSync(join(ROOT, 'service', 'test', 'vendors.json'), 'utf8')) as Record<string, string>;
  const docs = new Map(Object.entries(saved).map(([key, text]) => [String(JSON.parse(text).client_id), { key, doc: JSON.parse(text) as Record<string, unknown> }]));
  assert.equal(docs.size, 4);
  for (const [clientId, v] of docs) {
    const row = rows().filter((r) => r[1].includes(clientId));
    assert.equal(row.length, 1, clientId);
    assert.ok(row[0][1].includes(`under the key ${v.key}`), `${clientId} names ${v.key}`);
    for (const uri of v.doc.redirect_uris as string[]) assert.ok(row[0][2].includes(redirectForm(uri)), `${clientId} lists ${uri}`);
    assert.match(v.key, /^[a-z]+(?:-[a-z]+)*\.\d{4}-\d{2}-\d{2}$/);
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
  'plugins/claude-code/README.md',
  'service/plugins/codex/README.md',
];

function proseLines(text: string): string[] {
  return text
    .replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, '')
    .split('\n')
    .filter((l) => !/^(?: {4}|\t)/.test(l) && !/^\|(?:\s*:?-+:?\s*\|)+$/.test(l))
    .map((l) => l.replace(/`[^`\n]*`/g, ''));
}

test('the seven documents have no neuter pronoun, dashes, semicolons or parentheses in prose', () => {
  for (const file of COPY) {
    for (const line of proseLines(readFileSync(join(ROOT, file), 'utf8'))) {
      assert.doesNotMatch(line, /\bit(?:s|self|'s)?\b|[–—;()]/i, `${file} ${line}`);
    }
  }
});

function upstream(): Promise<{ port: number; seen: IncomingHttpHeaders[]; close: () => void }> {
  return new Promise((done) => {
    const seen: IncomingHttpHeaders[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers);
      res.end('ok');
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      done({ port, seen, close: () => server.close() });
    });
  });
}

function hit(port: number, host: string): Promise<number> {
  return new Promise((done, fail) => {
    const r = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { host, origin: 'http://evil.example' } }, (res) => {
      res.resume();
      res.on('end', () => done(res.statusCode ?? 0));
    });
    r.on('error', fail);
    r.end('{}');
  });
}

test('the relay adds the bearer token and passes a foreign Host and Origin through unchanged', async () => {
  const up = await upstream();
  const gate = await withToken('tok-123', { host: '127.0.0.1', port: up.port });
  try {
    assert.equal(await hit(gate.port, `localhost:${gate.port}`), 200);
    assert.equal(await hit(gate.port, 'evil.example'), 200);
    assert.equal(up.seen[0].authorization, 'Bearer tok-123');
    assert.equal(up.seen[0].host, `127.0.0.1:${up.port}`);
    assert.equal(up.seen[1].host, 'evil.example');
    assert.equal(up.seen[1].origin, 'http://evil.example');
  } finally {
    await gate.close();
    up.close();
  }
});

test('the baseline gives one reason for every entry and runs both requirement sets', () => {
  assert.deepEqual(REVISIONS, ['2025-11-25', '2026-07-28']);
  const lines = readFileSync(BASELINE, 'utf8').trim().split('\n');
  assert.equal(lines[0], 'server:');
  for (const l of lines.slice(1)) assert.match(l, /^  - [a-z0-9-]+(?::[a-z0-9-]+)? # \S.+$/, l);
});
