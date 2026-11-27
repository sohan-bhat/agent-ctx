import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { describe, test, type TestContext } from 'node:test';
import { apply, detect, plan, unplan, type Agent, type Change, type Paths } from '../src/install.ts';

type Files = Record<string, unknown>;

interface Kit {
  agent: Agent;
  seed: Files;
  broken: Record<string, string>;
  ours(p: Paths, shown?: string): Files;
  both(p: Paths): Files;
}

const NODE = '/opt/node/bin/node';
const APP = '/opt/agent-ctx/app/agent-ctx.js';
const MOVED = '/opt/agent-ctx/next/agent-ctx.js';
const BACKUP = '.agent-ctx-backup';
const FILES = { command: 'npx', args: ['-y', 'files-server'] };

function make(t: TestContext, prefix = 'agent-ctx-home-'): Paths {
  const home = fs.mkdtempSync(join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, app: APP, node: NODE, platform: 'darwin' };
}

function put(file: string, value: unknown, mode = 0o640): void {
  fs.mkdirSync(dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  fs.chmodSync(file, mode);
}

const text = (file: string): string => fs.readFileSync(file, 'utf8');
const look = (file: string): unknown => (file.endsWith('.toml') ? text(file) : JSON.parse(text(file)));
const mode = (file: string): number => fs.statSync(file).mode & 0o777;
const linked = (file: string): boolean => fs.lstatSync(file).isSymbolicLink();

function tree(home: string, backups = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of fs.readdirSync(home, { recursive: true, withFileTypes: true })) {
    const file = join(entry.parentPath, entry.name);
    if (entry.isFile() && file.endsWith(BACKUP) === backups) out[relative(home, file)] = text(file);
  }
  return out;
}

function seed(kit: Kit, p: Paths): void {
  for (const [file, value] of Object.entries(kit.seed)) put(join(p.home, file), value);
}

function check(p: Paths, want: Files): void {
  for (const [file, value] of Object.entries(want)) assert.deepEqual(look(join(p.home, file)), value, file);
}

function connect(agent: Agent, p: Paths): Change[] {
  const changes = plan(agent, p);
  apply(changes);
  return changes;
}

function disconnect(agent: Agent, p: Paths): Change[] {
  const changes = unplan(agent, p);
  apply(changes);
  return changes;
}

function env<T>(name: string, value: string | undefined, body: () => T): T {
  const kept = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return body();
  } finally {
    if (kept === undefined) delete process.env[name];
    else process.env[name] = kept;
  }
}

function suite(kit: Kit): void {
  const { agent } = kit;
  const count = Object.keys(kit.seed).length;

  test(`${agent} in a fresh home gets exactly the planned entries`, (t) => {
    const p = make(t);
    const want = kit.ours(p);
    const changes = connect(agent, p);
    assert.deepEqual(changes.map((change) => change.file).sort(), Object.keys(want).map((file) => join(p.home, file)).sort());
    check(p, want);
    for (const change of changes) {
      assert.equal(change.before, null);
      assert.equal(change.after, text(change.file));
      assert.equal(change.what.startsWith(`${change.file} is created with the `), true, change.what);
      assert.equal(mode(change.file), 0o600);
    }
  });

  test(`${agent} leaves other servers and other hooks as they were`, (t) => {
    const p = make(t);
    seed(kit, p);
    const changes = connect(agent, p);
    assert.equal(changes.length, count);
    check(p, kit.both(p));
    for (const change of changes) {
      assert.equal(change.what.endsWith(` added to ${change.file}.`), true, change.what);
      assert.equal(mode(change.file), 0o640);
    }
  });

  test(`${agent} gets no change from a second plan`, (t) => {
    for (const seeded of [false, true]) {
      const p = make(t);
      if (seeded) seed(kit, p);
      connect(agent, p);
      const once = tree(p.home);
      assert.deepEqual(plan(agent, p), []);
      apply(plan(agent, p));
      assert.deepEqual(tree(p.home), once);
    }
  });

  test(`${agent} gets the new path after the program moved`, (t) => {
    const p = make(t);
    seed(kit, p);
    connect(agent, p);
    const moved = { ...p, app: MOVED };
    const changes = connect(agent, moved);
    assert.equal(changes.length, count);
    check(moved, kit.both(moved));
    for (const change of changes) {
      assert.equal(change.what.endsWith(` updated in ${change.file} for the program path ${MOVED}.`), true, change.what);
      assert.equal(text(change.file).includes(APP), false);
    }
    assert.deepEqual(plan(agent, moved), []);
  });

  test(`${agent} is back in the earlier state after unplan`, (t) => {
    for (const [seeded, stale] of [[false, false], [false, true], [true, false], [true, true]]) {
      const p = make(t);
      if (seeded) seed(kit, p);
      const before = tree(p.home);
      connect(agent, p);
      if (stale) connect(agent, { ...p, app: MOVED });
      const changes = disconnect(agent, p);
      assert.equal(changes.length, count);
      assert.deepEqual(tree(p.home), before);
      for (const change of changes) {
        const want = seeded ? ` removed from ${change.file}.` : `${change.file} contained only agent-ctx entries and is removed.`;
        assert.equal(change.what.endsWith(want), true, change.what);
      }
      assert.deepEqual(unplan(agent, p), []);
    }
  });

  test(`${agent} leaves an unparseable file untouched`, (t) => {
    const p = make(t);
    for (const [file, value] of Object.entries(kit.broken)) put(join(p.home, file), value);
    const before = tree(p.home);
    const changes = plan(agent, p);
    assert.deepEqual(changes.map((change) => change.file).sort(), Object.keys(kit.broken).map((file) => join(p.home, file)).sort());
    for (const change of changes) {
      assert.equal(change.after, change.before);
      assert.equal(change.what.startsWith(`${change.file} `), true, change.what);
      assert.match(change.what, / and was left alone\. To connect by hand, add /);
      assert.equal(change.what.includes(APP), true, change.what);
    }
    apply(changes);
    apply(unplan(agent, p));
    assert.deepEqual(tree(p.home), before);
    assert.deepEqual(tree(p.home, true), {});
  });

  test(`${agent} gets one backup of each earlier file and only one`, (t) => {
    const p = make(t);
    seed(kit, p);
    const first = Object.fromEntries(Object.entries(tree(p.home)).map(([file, value]) => [file + BACKUP, value]));
    connect(agent, p);
    assert.deepEqual(tree(p.home, true), first);
    for (const file of Object.keys(first)) assert.equal(mode(join(p.home, file)), 0o640);
    connect(agent, { ...p, app: MOVED });
    assert.deepEqual(tree(p.home, true), first);
    disconnect(agent, p);
    assert.deepEqual(tree(p.home, true), first);
    for (const file of Object.keys(kit.seed)) put(join(p.home, file), file.endsWith('.toml') ? '' : {});
    connect(agent, p);
    assert.deepEqual(tree(p.home, true), first);
    const fresh = make(t);
    connect(agent, fresh);
    connect(agent, { ...fresh, app: MOVED });
    assert.deepEqual(tree(fresh.home, true), {});
  });

  test(`${agent} works in a home path with a space`, (t) => {
    const p = make(t, 'agent ctx home ');
    p.app = join(p.home, '.agent-ctx', 'app', 'agent-ctx.js');
    connect(agent, p);
    check(p, kit.ours(p, `"${p.app}"`));
    assert.deepEqual(plan(agent, p), []);
    disconnect(agent, p);
    assert.deepEqual(tree(p.home), {});
  });
}

describe('detect', () => {
  test('an empty home has no agent', (t) => {
    assert.deepEqual(detect(make(t)), []);
  });

  test('a home with all five lists every agent', (t) => {
    const p = make(t);
    for (const folder of ['.claude', '.cursor', '.codex', 'Library/Application Support/Claude']) fs.mkdirSync(join(p.home, folder), { recursive: true });
    put(join(p.home, '.gemini/settings.json'), {});
    assert.deepEqual(detect(p), ['claude-code', 'cursor', 'codex', 'gemini', 'claude-desktop']);
  });

  test('each agent is judged by the folder or file of that product', (t) => {
    const rows: [string, Paths['platform'], Agent[]][] = [
      ['.claude.json', 'darwin', ['claude-code']],
      ['.gemini/config/mcp_config.json', 'darwin', []],
      ['.config/Claude/claude_desktop_config.json', 'linux', ['claude-desktop']],
      ['.config/Claude/claude_desktop_config.json', 'darwin', []],
      ['AppData/Roaming/Claude/claude_desktop_config.json', 'win32', ['claude-desktop']],
    ];
    for (const [file, platform, want] of rows) {
      const p = { ...make(t), platform };
      put(join(p.home, file), {});
      assert.deepEqual(env('APPDATA', undefined, () => detect(p)), want, file);
    }
  });
});

describe('claude-code', () => {
  const RECORD = '.claude/plugins/installed_plugins.json';
  const record = (...names: string[]): unknown => ({ version: 2, plugins: Object.fromEntries(names.map((name) => [name, [{ scope: 'user' }]])) });
  const install: Change = {
    file: '',
    what: 'The plugin agent-ctx is installed in Claude Code with the command claude plugin install agent-ctx --marketplace sohan-bhat/agent-ctx.',
    before: null,
    after: null,
    run: ['claude', 'plugin', 'install', 'agent-ctx', '--marketplace', 'sohan-bhat/agent-ctx'],
  };
  const uninstall: Change = {
    file: '',
    what: 'The plugin agent-ctx is removed from Claude Code with the command claude plugin uninstall agent-ctx.',
    before: null,
    after: null,
    run: ['claude', 'plugin', 'uninstall', 'agent-ctx'],
  };

  test('claude-code in a fresh home gets one command and no file', (t) => {
    const p = make(t);
    const changes = connect('claude-code', p);
    assert.deepEqual(changes, [install]);
    assert.deepEqual(tree(p.home), {});
  });

  test('claude-code with other plugins still gets the install command', (t) => {
    const p = make(t);
    put(join(p.home, RECORD), record('formatter@tools'));
    const before = tree(p.home);
    assert.deepEqual(connect('claude-code', p), [install]);
    assert.deepEqual(unplan('claude-code', p), []);
    assert.deepEqual(tree(p.home), before);
  });

  test('claude-code gets no change from a second plan once the plugin is recorded', (t) => {
    const p = make(t);
    put(join(p.home, RECORD), record('formatter@tools', 'agent-ctx@agent-ctx'));
    assert.deepEqual(plan('claude-code', p), []);
  });

  test('claude-code gets the same command after the program moved', (t) => {
    const p = make(t);
    assert.deepEqual(plan('claude-code', { ...p, app: MOVED }), [install]);
    put(join(p.home, RECORD), record('agent-ctx@agent-ctx'));
    assert.deepEqual(plan('claude-code', { ...p, app: MOVED }), []);
  });

  test('claude-code is taken out with one command by unplan', (t) => {
    const p = make(t);
    assert.deepEqual(unplan('claude-code', p), [uninstall]);
    put(join(p.home, RECORD), record('formatter@tools', 'agent-ctx@agent-ctx'));
    const before = tree(p.home);
    assert.deepEqual(disconnect('claude-code', p), [uninstall]);
    assert.deepEqual(tree(p.home), before);
  });

  test('claude-code leaves an unparseable plugin record untouched', (t) => {
    const p = make(t);
    put(join(p.home, RECORD), '{ "plugins": {');
    const before = tree(p.home);
    assert.deepEqual(connect('claude-code', p), [install]);
    assert.deepEqual(disconnect('claude-code', p), [uninstall]);
    assert.deepEqual(tree(p.home), before);
  });

  test('claude-code gets no backup because no file is written', (t) => {
    const p = make(t);
    put(join(p.home, RECORD), record('formatter@tools'));
    put(join(p.home, '.claude/settings.json'), { hooks: {} });
    const before = tree(p.home);
    connect('claude-code', p);
    disconnect('claude-code', p);
    assert.deepEqual(tree(p.home), before);
    assert.deepEqual(tree(p.home, true), {});
  });

  test('claude-code works in a home path with a space', (t) => {
    const p = make(t, 'agent ctx home ');
    assert.deepEqual(plan('claude-code', p), [install]);
    put(join(p.home, RECORD), record('agent-ctx@agent-ctx'));
    assert.deepEqual(plan('claude-code', p), []);
    assert.deepEqual(detect(p), ['claude-code']);
  });
});

const DESKTOP = 'Library/Application Support/Claude/claude_desktop_config.json';
const desktopServer = (p: Paths): unknown => ({ command: p.node, args: [p.app, 'mcp', '--agent', 'claude-desktop'] });
const desktopKit: Kit = {
  agent: 'claude-desktop',
  seed: { [DESKTOP]: { preferences: { quickEntry: true }, mcpServers: { files: FILES } } },
  broken: { [DESKTOP]: '{ "mcpServers": { "files": {} }, }\n' },
  ours: (p) => ({ [DESKTOP]: { mcpServers: { 'agent-ctx': desktopServer(p) } } }),
  both: (p) => ({ [DESKTOP]: { preferences: { quickEntry: true }, mcpServers: { files: FILES, 'agent-ctx': desktopServer(p) } } }),
};

describe('claude-desktop', () => {
  suite(desktopKit);

  test('claude-desktop has the config file of each platform', (t) => {
    const p = make(t);
    const file = (platform: Paths['platform']): string => plan('claude-desktop', { ...p, platform })[0].file;
    assert.equal(file('linux'), join(p.home, '.config', 'Claude', 'claude_desktop_config.json'));
    assert.equal(env('APPDATA', undefined, () => file('win32')), join(p.home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'));
    assert.equal(env('APPDATA', join(p.home, 'Roam'), () => file('win32')), join(p.home, 'Roam', 'Claude', 'claude_desktop_config.json'));
    assert.equal(env('APPDATA', join(p.home, 'Roam'), () => file('darwin')), join(p.home, DESKTOP));
  });

  test('claude-desktop keeps extra keys of a stdio entry and replaces an entry of another kind', (t) => {
    const p = make(t);
    put(join(p.home, DESKTOP), { mcpServers: { 'agent-ctx': { command: 'node', args: ['/old/agent-ctx.js'], env: { LEVEL: 'debug' } } } });
    connect('claude-desktop', p);
    assert.deepEqual(look(join(p.home, DESKTOP)), { mcpServers: { 'agent-ctx': { command: NODE, args: [APP, 'mcp', '--agent', 'claude-desktop'], env: { LEVEL: 'debug' } } } });
    put(join(p.home, DESKTOP), { mcpServers: { 'agent-ctx': { type: 'http', url: 'https://agent-ctx.invalid/mcp' } } });
    connect('claude-desktop', p);
    check(p, desktopKit.ours(p));
  });
});

const cursorServer = (p: Paths): unknown => ({ type: 'stdio', command: p.node, args: [p.app, 'mcp', '--agent', 'cursor'] });
const cursorHook = (p: Paths, shown = p.app): unknown => ({ command: `${p.node} ${shown} hook --agent cursor` });
const AUDIT = { command: './audit.sh' };
const SHELL = { command: './check.sh', matcher: 'curl' };
const cursorHooks = (hook: unknown, stop: unknown[] = [hook], more: Files = {}): unknown => ({
  version: 1,
  hooks: { ...more, sessionStart: [hook], beforeSubmitPrompt: [hook], postToolUse: [hook], afterAgentResponse: [hook], stop },
});
const cursorKit: Kit = {
  agent: 'cursor',
  seed: {
    '.cursor/mcp.json': { mcpServers: { files: FILES } },
    '.cursor/hooks.json': { version: 1, hooks: { stop: [AUDIT], beforeShellExecution: [SHELL] } },
  },
  broken: { '.cursor/mcp.json': '{ "mcpServers": {', '.cursor/hooks.json': '{ "version": 1, "hooks": {}, }' },
  ours: (p, shown) => ({
    '.cursor/mcp.json': { mcpServers: { 'agent-ctx': cursorServer(p) } },
    '.cursor/hooks.json': cursorHooks(cursorHook(p, shown)),
  }),
  both: (p) => ({
    '.cursor/mcp.json': { mcpServers: { files: FILES, 'agent-ctx': cursorServer(p) } },
    '.cursor/hooks.json': cursorHooks(cursorHook(p), [AUDIT, cursorHook(p)], { beforeShellExecution: [SHELL] }),
  }),
};

describe('cursor', () => {
  suite(cursorKit);

  test('cursor keeps a hook of another tool with the same words', (t) => {
    const p = make(t);
    const other = { command: '/opt/other/tool.js hook --agent cursor' };
    put(join(p.home, '.cursor/hooks.json'), { version: 1, hooks: { stop: [other] } });
    connect('cursor', p);
    assert.deepEqual(look(join(p.home, '.cursor/hooks.json')), cursorHooks(cursorHook(p), [other, cursorHook(p)]));
    disconnect('cursor', p);
    assert.deepEqual(look(join(p.home, '.cursor/hooks.json')), { version: 1, hooks: { stop: [other] } });
  });

  test('cursor loses a hook of ours under an event outside the plan', (t) => {
    const p = make(t);
    put(join(p.home, '.cursor/mcp.json'), { mcpServers: { 'agent-ctx': { type: 'stdio', command: NODE, args: ['/old/agent-ctx.js', 'mcp', '--agent', 'cursor'] } } });
    const stale = { command: `${NODE} /old/agent-ctx.js hook --agent cursor` };
    put(join(p.home, '.cursor/hooks.json'), { version: 1, hooks: { preToolUse: [stale, AUDIT], afterFileEdit: [stale], stop: [AUDIT, stale, SHELL] } });
    connect('cursor', p);
    assert.deepEqual(look(join(p.home, '.cursor/hooks.json')), cursorHooks(cursorHook(p), [AUDIT, cursorHook(p), SHELL], { preToolUse: [AUDIT] }));
  });

  test('cursor on win32 keeps backslashes and takes double quotes around a spaced path', (t) => {
    const p: Paths = { ...make(t), platform: 'win32', node: 'C:\\Program Files\\nodejs\\node.exe', app: 'C:\\Tools\\agent-ctx\\app\\agent-ctx.js' };
    connect('cursor', p);
    check(p, {
      '.cursor/mcp.json': { mcpServers: { 'agent-ctx': cursorServer(p) } },
      '.cursor/hooks.json': cursorHooks({ command: `"${p.node}" ${p.app} hook --agent cursor` }),
    });
    assert.deepEqual(plan('cursor', p), []);
  });

  test('cursor commands with spaces and shell characters run with the right arguments', { skip: process.platform === 'win32' }, (t) => {
    const p = make(t, 'agent ctx home ');
    p.node = join(p.home, 'node bin', 'node');
    p.app = join(p.home, 'a $b `c` "d"', 'agent-ctx.js');
    fs.mkdirSync(dirname(p.node));
    fs.symlinkSync(process.execPath, p.node);
    put(p.app, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    connect('cursor', p);
    const hooks = look(join(p.home, '.cursor/hooks.json')) as { hooks: { stop: { command: string }[] } };
    assert.equal(execFileSync('/bin/sh', ['-c', hooks.hooks.stop[0].command], { encoding: 'utf8' }), '["hook","--agent","cursor"]');
    const servers = look(join(p.home, '.cursor/mcp.json')) as { mcpServers: Record<string, { command: string; args: string[] }> };
    const entry = servers.mcpServers['agent-ctx'];
    assert.equal(execFileSync(entry.command, entry.args, { encoding: 'utf8' }), '["mcp","--agent","cursor"]');
    assert.deepEqual(plan('cursor', p), []);
    assert.equal(disconnect('cursor', p).length, 2);
    assert.equal(fs.existsSync(join(p.home, '.cursor/hooks.json')), false);
  });
});

const geminiServer = (p: Paths): unknown => ({ command: p.node, args: [p.app, 'mcp', '--agent', 'gemini'] });
const geminiHook = (p: Paths, shown = p.app): unknown => ({ hooks: [{ name: 'agent-ctx', type: 'command', command: `${p.node} ${shown} hook --agent gemini` }] });
const LINT = { matcher: 'write_file', hooks: [{ name: 'lint', type: 'command', command: './lint.sh' }] };
const SETTINGS = '.gemini/settings.json';
const geminiKit: Kit = {
  agent: 'gemini',
  seed: { [SETTINGS]: { theme: 'plain', mcpServers: { files: FILES }, hooks: { AfterTool: [LINT], BeforeTool: [LINT] } } },
  broken: { [SETTINGS]: '{\n  "theme": "plain",\n}\n' },
  ours: (p, shown) => {
    const hook = geminiHook(p, shown);
    return { [SETTINGS]: { mcpServers: { 'agent-ctx': geminiServer(p) }, hooks: { BeforeAgent: [hook], AfterTool: [hook], AfterAgent: [hook] } } };
  },
  both: (p) => {
    const hook = geminiHook(p);
    return {
      [SETTINGS]: {
        theme: 'plain',
        mcpServers: { files: FILES, 'agent-ctx': geminiServer(p) },
        hooks: { AfterTool: [LINT, hook], BeforeTool: [LINT], BeforeAgent: [hook], AfterAgent: [hook] },
      },
    };
  },
};

describe('gemini', () => {
  suite(geminiKit);

  test('gemini keeps other handlers that share a group with ours and keeps settings under hooks', (t) => {
    const p = make(t);
    const mine = { name: 'agent-ctx', type: 'command', command: `${NODE} ${APP} hook --agent gemini` };
    const lint = LINT.hooks[0];
    put(join(p.home, SETTINGS), { mcpServers: { 'agent-ctx': geminiServer(p) }, hooks: { enabled: true, AfterTool: [{ matcher: 'write_file', hooks: [lint, mine] }] } });
    disconnect('gemini', p);
    assert.deepEqual(look(join(p.home, SETTINGS)), { hooks: { enabled: true, AfterTool: [LINT] } });
  });
});
