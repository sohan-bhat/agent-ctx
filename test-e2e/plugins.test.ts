import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanOrigin, stamp } from '../scripts/stamp.mjs';

type Json = Record<string, unknown>;
interface Handler { type?: string; server?: string; tool?: string; input?: Record<string, string>; [k: string]: unknown }
interface Group { matcher?: string; hooks: Handler[] }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMMITTED = join(ROOT, 'plugins');
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
  return walk(dir).filter((f) => !relative(dir, f).startsWith(`src`));
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

test('each plugin in a stamped copy holds only JSON and one README', () => {
  eachCopy((dir) => {
    const files = plugins(dir).map((f) => relative(dir, f));
    for (const plugin of ['claude-code', 'codex']) {
      const other = files.filter((f) => f.startsWith(`${plugin}/`) && !f.endsWith('.json'));
      assert.deepEqual(other, [`${plugin}/README.md`], files.join(' '));
    }
    for (const f of files.filter((x) => x.endsWith('.json'))) assert.doesNotThrow(() => read(join(dir, f)), f);
  });
});

test('the Claude Code README says what leaves the machine and how to remove the plugin in 40 to 60 plain words', () => {
  eachCopy((dir) => {
    const text = readFileSync(join(dir, 'claude-code', 'README.md'), 'utf8');
    const words = text.replace(/^#.*$/m, '').split(/\s+/).filter(Boolean);
    assert.ok(words.length >= 40 && words.length <= 60, String(words.length));
    assert.equal(/[\u2013\u2014;()]|\w: /.test(text), false, text);
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

test('the committed copy is a fresh stamp of the invalid origin', () => {
  const s = fresh('https://agent-ctx.invalid');
  try {
    const want = plugins(s.dir).map((f) => relative(s.dir, f));
    const have = plugins(COMMITTED).map((f) => relative(COMMITTED, f));
    assert.deepEqual(have, want);
    for (const f of want) assert.equal(readFileSync(join(COMMITTED, f), 'utf8'), readFileSync(join(s.dir, f), 'utf8'), f);
  } finally {
    s.done();
  }
});

test('the stamp takes an origin alone', () => {
  assert.equal(cleanOrigin('https://agent-ctx.invalid/'), 'https://agent-ctx.invalid');
  for (const bad of ['https://agent-ctx.invalid/mcp', 'ftp://agent-ctx.invalid', 'agent-ctx.invalid', 'https://a:b@agent-ctx.invalid', '']) assert.throws(() => cleanOrigin(bad), bad);
  const dir = mkdtempSync(join(tmpdir(), 'stamp-'));
  try {
    assert.throws(() => stamp('https://agent-ctx.invalid', dir, 'two words'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
