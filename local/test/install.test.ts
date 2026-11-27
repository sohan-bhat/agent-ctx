import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { describe, test, type TestContext } from 'node:test';
import { apply, connected, detect, plan, unplan, type Agent, type Change, type Paths } from '../src/install.ts';

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
const beside = (app: string): string => join(dirname(app), 'hook.mjs');
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
      assert.equal(text(change.file).includes(APP) || text(change.file).includes(beside(APP)), false);
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
      assert.equal(change.what.includes(dirname(APP)), true, change.what);
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
    check(p, kit.ours(p, `"${beside(p.app)}"`));
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
const cursorHook = (p: Paths, shown = beside(p.app)): unknown => ({ command: `${p.node} ${shown} --agent cursor` });
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
    const other = { command: '/opt/other/hook.mjs --agent cursor' };
    put(join(p.home, '.cursor/hooks.json'), { version: 1, hooks: { stop: [other] } });
    connect('cursor', p);
    assert.deepEqual(look(join(p.home, '.cursor/hooks.json')), cursorHooks(cursorHook(p), [other, cursorHook(p)]));
    disconnect('cursor', p);
    assert.deepEqual(look(join(p.home, '.cursor/hooks.json')), { version: 1, hooks: { stop: [other] } });
  });

  test('cursor loses a hook of ours under an event outside the plan', (t) => {
    const p = make(t);
    put(join(p.home, '.cursor/mcp.json'), { mcpServers: { 'agent-ctx': { type: 'stdio', command: NODE, args: ['/old/agent-ctx.js', 'mcp', '--agent', 'cursor'] } } });
    const stale = { command: `${NODE} /old/hook.mjs --agent cursor` };
    put(join(p.home, '.cursor/hooks.json'), { version: 1, hooks: { preToolUse: [stale, AUDIT], afterFileEdit: [stale], stop: [AUDIT, stale, SHELL] } });
    connect('cursor', p);
    assert.deepEqual(look(join(p.home, '.cursor/hooks.json')), cursorHooks(cursorHook(p), [AUDIT, cursorHook(p), SHELL], { preToolUse: [AUDIT] }));
  });

  test('cursor on win32 keeps backslashes and takes double quotes around a spaced path', (t) => {
    const p: Paths = { ...make(t), platform: 'win32', node: 'C:\\Program Files\\nodejs\\node.exe', app: 'C:\\Tools\\agent-ctx\\app\\agent-ctx.js' };
    connect('cursor', p);
    check(p, {
      '.cursor/mcp.json': { mcpServers: { 'agent-ctx': cursorServer(p) } },
      '.cursor/hooks.json': cursorHooks({ command: `"${p.node}" C:\\Tools\\agent-ctx\\app\\hook.mjs --agent cursor` }),
    });
    assert.deepEqual(plan('cursor', p), []);
  });

  test('cursor commands with spaces and shell characters run with the right arguments', { skip: process.platform === 'win32' }, (t) => {
    const p = make(t, 'agent ctx home ');
    p.node = join(p.home, 'node bin', 'node');
    p.app = join(p.home, 'a $b `c` "d"', 'agent-ctx.js');
    fs.mkdirSync(dirname(p.node));
    fs.symlinkSync(process.execPath, p.node);
    for (const file of [p.app, beside(p.app)]) put(file, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    connect('cursor', p);
    const hooks = look(join(p.home, '.cursor/hooks.json')) as { hooks: { stop: { command: string }[] } };
    assert.equal(execFileSync('/bin/sh', ['-c', hooks.hooks.stop[0].command], { encoding: 'utf8' }), '["--agent","cursor"]');
    const servers = look(join(p.home, '.cursor/mcp.json')) as { mcpServers: Record<string, { command: string; args: string[] }> };
    const entry = servers.mcpServers['agent-ctx'];
    assert.equal(execFileSync(entry.command, entry.args, { encoding: 'utf8' }), '["mcp","--agent","cursor"]');
    assert.deepEqual(plan('cursor', p), []);
    assert.equal(disconnect('cursor', p).length, 2);
    assert.equal(fs.existsSync(join(p.home, '.cursor/hooks.json')), false);
  });
});

const geminiServer = (p: Paths): unknown => ({ command: p.node, args: [p.app, 'mcp', '--agent', 'gemini'] });
const geminiHook = (p: Paths, shown = beside(p.app)): unknown => ({ hooks: [{ name: 'agent-ctx', type: 'command', command: `${p.node} ${shown} --agent gemini` }] });
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
    const mine = { name: 'agent-ctx', type: 'command', command: `${NODE} ${beside(APP)} --agent gemini` };
    const lint = LINT.hooks[0];
    put(join(p.home, SETTINGS), { mcpServers: { 'agent-ctx': geminiServer(p) }, hooks: { enabled: true, AfterTool: [{ matcher: 'write_file', hooks: [lint, mine] }] } });
    disconnect('gemini', p);
    assert.deepEqual(look(join(p.home, SETTINGS)), { hooks: { enabled: true, AfterTool: [LINT] } });
  });
});

const TOML = 'model = "o5"\n\n[mcp_servers.files]\ncommand = "npx"\nargs = ["-y", "files-server"]\n';
const CONFIG = '.codex/config.toml';
const table = (p: Paths): string => `[mcp_servers.agent-ctx]\ncommand = "${p.node}"\nargs = ["${p.app}", "mcp", "--agent", "codex"]\n`;
const codexHook = (p: Paths, shown = beside(p.app)): unknown => ({ hooks: [{ type: 'command', command: `${p.node} ${shown} --agent codex` }] });
const NOTIFY = { hooks: [{ type: 'command', command: './notify.sh' }] };
const GUARD = { matcher: 'Bash', hooks: [{ type: 'command', command: './guard.sh' }] };
const codexKit: Kit = {
  agent: 'codex',
  seed: { [CONFIG]: TOML, '.codex/hooks.json': { hooks: { Stop: [NOTIFY], PreToolUse: [GUARD] } } },
  broken: { [CONFIG]: '[mcp_servers]\nagent-ctx = { command = "node" }\n', '.codex/hooks.json': '{ "hooks": ' },
  ours: (p, shown) => {
    const hook = codexHook(p, shown);
    return { [CONFIG]: table(p), '.codex/hooks.json': { hooks: { UserPromptSubmit: [hook], PostToolUse: [hook], Stop: [hook] } } };
  },
  both: (p) => {
    const hook = codexHook(p);
    return { [CONFIG]: `${TOML}\n${table(p)}`, '.codex/hooks.json': { hooks: { Stop: [NOTIFY, hook], PreToolUse: [GUARD], UserPromptSubmit: [hook], PostToolUse: [hook] } } };
  },
};

describe('codex', () => {
  suite(codexKit);

  test('codex keeps other keys of the table and removes the whole table with every sub table', (t) => {
    const p = make(t);
    const rest = 'startup_timeout_sec = 20\n\n[mcp_servers."agent-ctx".env]\nLEVEL = "debug"\n\n[profiles.fast]\nmodel = "o5"\n';
    put(join(p.home, CONFIG), `[mcp_servers."agent-ctx"]\ncommand = 'node'\nargs = ['/old/agent-ctx.js', "mcp", "--agent", "codex"]\n${rest}`);
    put(join(p.home, '.codex/hooks.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node /old/hook.mjs --agent codex' }] }] } });
    connect('codex', p);
    assert.equal(text(join(p.home, CONFIG)), `[mcp_servers."agent-ctx"]\ncommand = "${NODE}"\nargs = ["${APP}", "mcp", "--agent", "codex"]\n${rest}`);
    check(p, { '.codex/hooks.json': codexKit.ours(p)['.codex/hooks.json'] });
    assert.deepEqual(plan('codex', p), []);
    disconnect('codex', p);
    assert.equal(text(join(p.home, CONFIG)), '\n[profiles.fast]\nmodel = "o5"\n');
  });

  test('codex replaces a table of another kind and keeps the line ends of the file', (t) => {
    const p = make(t);
    const head = 'model = "o5"\r\n';
    put(join(p.home, CONFIG), `${head}\r\n[mcp_servers.agent-ctx]\r\nurl = "https://agent-ctx.invalid/mcp"\r\n\r\n[mcp_servers.agent-ctx.http_headers]\r\nKind = "plain"\r\n`);
    connect('codex', p);
    assert.equal(text(join(p.home, CONFIG)), `${head}\r\n${table(p).replaceAll('\n', '\r\n')}`);
    disconnect('codex', p);
    assert.equal(text(join(p.home, CONFIG)), head);
  });

  test('codex reads no table header inside a string over several lines', (t) => {
    const p = make(t);
    const note = 'tip = \'"""\' # a """ mark\nnotes = """\nAdd these lines by hand.\n\n[mcp_servers.agent-ctx]\ncommand = "node"\n"""\n';
    put(join(p.home, CONFIG), note);
    connect('codex', p);
    assert.equal(text(join(p.home, CONFIG)), `${note}\n${table(p)}`);
    assert.deepEqual(plan('codex', p), []);
    disconnect('codex', p);
    assert.equal(text(join(p.home, CONFIG)), note);
  });

  test('codex leaves a table with values over several lines alone', (t) => {
    const p = make(t);
    const body = '[mcp_servers.agent-ctx]\ncommand = "node"\nargs = [\n  "/old/agent-ctx.js",\n]\n';
    put(join(p.home, CONFIG), body);
    const [change] = plan('codex', p);
    assert.equal(change.after, body);
    assert.match(change.what, / has agent-ctx in a form unsafe for a text edit and was left alone\. To connect by hand, add the table \[mcp_servers\.agent-ctx\] with command = /);
  });
});

describe('files', () => {
  test('apply stops before any write when a file changed after the plan', (t) => {
    const p = make(t);
    seed(cursorKit, p);
    const changes = plan('cursor', p);
    put(join(p.home, '.cursor/hooks.json'), { version: 1, hooks: {} });
    const before = tree(p.home);
    assert.throws(() => apply(changes), /hooks\.json changed after the plan was made, so nothing was written\.$/);
    assert.deepEqual(tree(p.home), before);
    assert.deepEqual(tree(p.home, true), {});
  });

  test('a link to a file inside the home is followed and stays a link', (t) => {
    const p = make(t);
    const real = join(fs.realpathSync(p.home), 'dotfiles', 'mcp.json');
    const link = join(p.home, '.cursor', 'mcp.json');
    put(real, cursorKit.seed['.cursor/mcp.json']);
    fs.mkdirSync(dirname(link));
    fs.symlinkSync(real, link);
    const changes = connect('cursor', p);
    assert.equal(changes[0].file, real);
    assert.equal(linked(link), true);
    assert.deepEqual(look(real), cursorKit.both(p)['.cursor/mcp.json']);
    assert.deepEqual(plan('cursor', p), []);
    disconnect('cursor', p);
    assert.equal(linked(link), true);
    assert.deepEqual(look(real), cursorKit.seed['.cursor/mcp.json']);
  });

  test('a link to a file outside the home is left alone', (t) => {
    const p = make(t);
    const away = join(make(t).home, 'mcp.json');
    const link = join(p.home, '.cursor', 'mcp.json');
    put(away, cursorKit.seed['.cursor/mcp.json']);
    fs.mkdirSync(dirname(link));
    fs.symlinkSync(away, link);
    const changes = connect('cursor', p);
    assert.deepEqual(changes[0], {
      file: link,
      what: `${link} is a link to a place outside the home folder and was left alone. To connect by hand, add "agent-ctx": ${JSON.stringify(cursorServer(p))} under mcpServers.`,
      before: null,
      after: null,
    });
    assert.equal(linked(link), true);
    assert.deepEqual(look(away), cursorKit.seed['.cursor/mcp.json']);
    check(p, { '.cursor/hooks.json': cursorKit.ours(p)['.cursor/hooks.json'] });
  });

  test('empty parts of a file that were there before stay after unplan', (t) => {
    const rows: [Agent, string, unknown][] = [
      ['claude-desktop', DESKTOP, { mcpServers: {} }],
      ['cursor', '.cursor/hooks.json', { version: 1, hooks: { stop: [] } }],
      ['cursor', '.cursor/hooks.json', { hooks: { stop: [AUDIT] } }],
      ['gemini', SETTINGS, { hooks: {}, mcpServers: {} }],
      ['codex', '.codex/hooks.json', {}],
    ];
    for (const [agent, file, value] of rows) {
      const p = make(t);
      put(join(p.home, file), value);
      connect(agent, p);
      assert.notDeepEqual(look(join(p.home, file)), value);
      disconnect(agent, p);
      assert.deepEqual(look(join(p.home, file)), value, file);
    }
  });

  test('the indent and the line ends of a file are kept', (t) => {
    const p = make(t);
    const body = '{\r\n\t"mcpServers": {\r\n\t\t"files": {}\r\n\t}\r\n}\r\n';
    put(join(p.home, DESKTOP), body);
    connect('claude-desktop', p);
    assert.equal(text(join(p.home, DESKTOP)).startsWith('{\r\n\t"mcpServers": {\r\n\t\t"files": {},\r\n\t\t"agent-ctx": {\r\n\t\t\t"command": '), true);
    disconnect('claude-desktop', p);
    assert.equal(text(join(p.home, DESKTOP)), body);
  });

  test('a file of another layout is left alone', (t) => {
    const rows: [Agent, string, unknown][] = [
      ['claude-desktop', DESKTOP, { mcpServers: [] }],
      ['claude-desktop', DESKTOP, []],
      ['gemini', SETTINGS, { hooks: { AfterTool: 'lint' } }],
      ['cursor', '.cursor/hooks.json', { version: 1, hooks: null }],
    ];
    for (const [agent, file, value] of rows) {
      const p = make(t);
      put(join(p.home, file), value);
      const change = plan(agent, p).find((one) => one.file === join(p.home, file));
      assert.equal(change?.after, change?.before);
      assert.match(change?.what ?? '', / has an unexpected layout and was left alone\. To connect by hand, add /);
    }
  });

  test('a file with numbers that a rewrite would change is left alone', (t) => {
    const rows: [Agent, string, unknown, boolean][] = [
      ['claude-desktop', DESKTOP, '{"mcpServers": {}, "serial": 12345678901234567890}\n', true],
      ['gemini', SETTINGS, '{"limit": 1e999}\n', true],
      ['cursor', '.cursor/mcp.json', { mcpServers: { '8080': FILES, files: FILES } }, true],
      ['claude-desktop', DESKTOP, '{"serial": 1234567890123456, "ratio": 0.12345678901234567890, "note": "12345678901234567890"}\n', false],
    ];
    for (const [agent, file, value, left] of rows) {
      const p = make(t);
      put(join(p.home, file), value);
      const change = plan(agent, p).find((one) => one.file === join(p.home, file));
      assert.equal(change?.after === change?.before, left, file);
      assert.equal(/ has numbers unsafe for a rewrite and was left alone\. To connect by hand, add /.test(change?.what ?? ''), left, change?.what);
    }
  });

  test('every line for a person is one line without the banned words and marks', (t) => {
    const lines: string[] = [];
    for (const kit of [desktopKit, cursorKit, geminiKit, codexKit]) {
      const p = make(t);
      for (const [file, value] of Object.entries(kit.broken)) put(join(p.home, file), value);
      lines.push(...plan(kit.agent, p).map((change) => change.what), ...unplan(kit.agent, p).map((change) => change.what));
      const q = make(t);
      seed(kit, q);
      lines.push(...connect(kit.agent, q).map((change) => change.what), ...connect(kit.agent, { ...q, app: MOVED }).map((change) => change.what));
      lines.push(...disconnect(kit.agent, q).map((change) => change.what), ...connect(kit.agent, make(t)).map((change) => change.what));
    }
    lines.push(...plan('claude-code', make(t)).map((change) => change.what), ...unplan('claude-code', make(t)).map((change) => change.what));
    assert.equal(lines.length > 30, true);
    for (const line of lines) {
      assert.doesNotMatch(line, /\n|\b(it|its|itself|them|they|this|that|those)\b|[\u2013\u2014;()]| - /i, line);
      assert.match(line, /\.$/, line);
    }
  });
});

describe('guard', () => {
  test('no read and no write lands outside the temp home', (t) => {
    const p = make(t);
    const seen: { name: string; path: string }[] = [];
    const two = new Set(['renameSync', 'copyFileSync', 'linkSync', 'symlinkSync']);
    const names = ['readFileSync', 'existsSync', 'statSync', 'lstatSync', 'realpathSync', 'readdirSync', 'openSync', 'writeFileSync', 'appendFileSync', 'renameSync', 'copyFileSync', 'mkdirSync', 'chmodSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'linkSync', 'symlinkSync', 'truncateSync', 'cpSync'];
    const real = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of names) {
      const original = real[name];
      t.mock.method(real, name, (...args: unknown[]) => {
        for (const arg of args.slice(0, two.has(name) ? 2 : 1)) seen.push({ name, path: String(arg) });
        return original.apply(fs, args);
      });
    }
    env('APPDATA', undefined, () => {
      for (const seeded of [false, true]) {
        for (const platform of ['darwin', 'linux', 'win32'] as const) {
          for (const kit of [desktopKit, cursorKit, geminiKit, codexKit]) {
            const q = { ...p, platform };
            if (seeded) seed(kit, q);
            detect(q);
            connect(kit.agent, q);
            connect(kit.agent, { ...q, app: MOVED });
            disconnect(kit.agent, q);
          }
          connect('claude-code', { ...p, platform });
          disconnect('claude-code', { ...p, platform });
        }
      }
    });
    t.mock.restoreAll();
    const inside = ({ path }: { path: string }): boolean => path === p.home || path.startsWith(p.home + sep);
    assert.deepEqual(seen.filter((one) => !inside(one)), []);
    for (const name of ['readFileSync', 'writeFileSync', 'renameSync', 'copyFileSync', 'mkdirSync', 'unlinkSync']) assert.equal(seen.some((one) => one.name === name), true, name);
    assert.equal(fs.existsSync(join(p.home, 'AppData', 'Roaming', 'Claude')), true);
  });
});

describe('one program', () => {
  const ONE = '/opt/agent-ctx/app/agent-ctx';
  const CLAUDE = '.claude/settings.json';
  const LISTED = '.claude.json';
  const RECORD = '.claude/plugins/installed_plugins.json';
  const OTHERS: Agent[] = ['cursor', 'codex', 'gemini', 'claude-desktop'];
  const EVENTS = 'UserPromptSubmit, PostToolUse, PostToolUseFailure, Stop, StopFailure, PostCompact and SessionStart';
  const add = ['claude', 'mcp', 'add', '--scope', 'user', 'agent-ctx', '--', ONE, 'mcp', '--agent', 'claude-code'];
  const remove = ['claude', 'mcp', 'remove', '--scope', 'user', 'agent-ctx'];
  const note: Change = { file: '', what: 'The plugin agent-ctx is already installed in Claude Code and stays the one connection.', before: null, after: null };
  const one = (t: TestContext): Paths => ({ ...make(t), app: ONE, node: '' });
  const server = (agent: string): { command: string; args: string[] } => ({ command: ONE, args: ['mcp', '--agent', agent] });
  const listed = (command = ONE): unknown => ({ numStartups: 3, mcpServers: { files: FILES, 'agent-ctx': { type: 'stdio', ...server('claude-code'), command, env: {} } } });
  const plugged = (p: Paths): void => put(join(p.home, RECORD), { version: 2, plugins: { 'agent-ctx@agent-ctx': [{ scope: 'user' }] } });
  const steps = (changes: Change[]): unknown[] => changes.map((change) => change.run ?? change.file);

  test('one program is the command of every server and every hook with no node in front', (t) => {
    const p = one(t);
    for (const agent of OTHERS) connect(agent, p);
    const hook = (agent: string, more: Files = {}): unknown => ({ hooks: [{ ...more, type: 'command', command: `${ONE} hook --agent ${agent}` }] });
    check(p, {
      '.cursor/mcp.json': { mcpServers: { 'agent-ctx': { type: 'stdio', ...server('cursor') } } },
      '.cursor/hooks.json': cursorHooks({ command: `${ONE} hook --agent cursor` }),
      '.codex/hooks.json': { hooks: { UserPromptSubmit: [hook('codex')], PostToolUse: [hook('codex')], Stop: [hook('codex')] } },
      [SETTINGS]: { mcpServers: { 'agent-ctx': server('gemini') }, hooks: { BeforeAgent: [hook('gemini', { name: 'agent-ctx' })], AfterTool: [hook('gemini', { name: 'agent-ctx' })], AfterAgent: [hook('gemini', { name: 'agent-ctx' })] } },
      [DESKTOP]: { mcpServers: { 'agent-ctx': server('claude-desktop') } },
    });
    assert.equal(text(join(p.home, CONFIG)), `[mcp_servers.agent-ctx]\ncommand = "${ONE}"\nargs = ["mcp", "--agent", "codex"]\n`);
    for (const body of Object.values(tree(p.home))) assert.equal(/node|\.mjs/.test(body), false, body);
    for (const agent of OTHERS) assert.deepEqual([plan(agent, p), connected(agent, p)], [[], true], agent);
    for (const agent of OTHERS) disconnect(agent, p);
    assert.deepEqual(tree(p.home), {});
  });

  test('a move between the script form and one program replaces every entry of the other form', (t) => {
    for (const first of ['script', 'program']) {
      const home = make(t);
      const script = { ...home, app: MOVED };
      const program = { ...home, app: ONE, node: '' };
      const [from, to] = first === 'script' ? [script, program] : [program, script];
      for (const agent of OTHERS) connect(agent, from);
      for (const agent of OTHERS) {
        for (const change of connect(agent, to)) assert.equal(change.what.endsWith(` updated in ${change.file} for the program path ${to.app}.`), true, change.what);
        assert.deepEqual(plan(agent, to), [], agent);
      }
      const all = Object.values(tree(home.home)).join('\n');
      assert.equal(all.includes(first === 'script' ? 'hook.mjs' : `${ONE} hook`), false, all);
      assert.equal(all.split(first === 'script' ? `${ONE} hook` : beside(MOVED)).length - 1, 5 + 3 + 3, all);
      for (const agent of OTHERS) disconnect(agent, from);
      assert.deepEqual(tree(home.home), {});
    }
  });

  test('claude-code as one program gets the add command and the hooks of the plugin file in the settings file', (t) => {
    const p = one(t);
    const changes = connect('claude-code', p);
    assert.deepEqual(steps(changes), [add, join(p.home, CLAUDE)]);
    assert.equal(changes[0].what, `The server agent-ctx is added to Claude Code with the command ${add.join(' ')}.`);
    assert.equal(changes[1].what, `${join(p.home, CLAUDE)} is created with the agent-ctx hooks for ${EVENTS}.`);
    const shipped = JSON.parse(text(join(import.meta.dirname, '..', '..', 'plugins', 'claude-code', 'hooks', 'hooks.json'))) as { hooks: Record<string, { matcher?: string; hooks: { command: string; timeout: number }[] }[]> };
    const written = look(join(p.home, CLAUDE)) as typeof shipped;
    assert.deepEqual(Object.keys(written), ['hooks']);
    assert.deepEqual(Object.keys(written.hooks), Object.keys(shipped.hooks));
    for (const [event, groups] of Object.entries(shipped.hooks)) {
      assert.deepEqual(written.hooks[event].map((group) => [group.matcher, group.hooks.map((hook) => hook.timeout)]), groups.map((group) => [group.matcher, group.hooks.map((hook) => hook.timeout)]), event);
      for (const group of written.hooks[event]) assert.deepEqual(group.hooks.map((hook) => hook.command), [`${ONE} hook --agent claude-code`], event);
    }
    assert.equal(mode(join(p.home, CLAUDE)), 0o600);
  });

  test('claude-code as one program gets no change once the server is listed and a server at another path is replaced', (t) => {
    const p = one(t);
    connect('claude-code', p);
    assert.equal(connected('claude-code', p), false);
    put(join(p.home, LISTED), listed());
    assert.deepEqual([plan('claude-code', p), connected('claude-code', p)], [[], true]);
    put(join(p.home, LISTED), listed('/old/agent-ctx'));
    assert.deepEqual(steps(plan('claude-code', p)), [remove, add]);
    assert.equal(connected('claude-code', p), false);
  });

  test('claude-code as one program leaves an installed plugin as the one connection', (t) => {
    const p = one(t);
    plugged(p);
    const before = tree(p.home);
    assert.deepEqual(connect('claude-code', p), [note]);
    assert.deepEqual(tree(p.home), before);
    assert.equal(connected('claude-code', p), true);
    const q = one(t);
    connect('claude-code', q);
    put(join(q.home, LISTED), listed());
    plugged(q);
    assert.deepEqual(steps(plan('claude-code', q)), ['', remove, join(q.home, CLAUDE)]);
    assert.deepEqual(steps(plan('claude-code', { ...q, app: APP, node: NODE })), [remove, join(q.home, CLAUDE)]);
    assert.equal(connected('claude-code', q), false);
    connect('claude-code', q);
    assert.equal(fs.existsSync(join(q.home, CLAUDE)), false);
  });

  test('claude-code is taken out of the settings file and the server list by unplan in both forms', (t) => {
    for (const script of [false, true]) {
      const p = one(t);
      const kept = { permissions: { allow: ['Bash(npm test)'] }, hooks: { PostToolUse: [GUARD], Notification: [NOTIFY] } };
      put(join(p.home, CLAUDE), kept);
      put(join(p.home, RECORD), { version: 2, plugins: { 'formatter@tools': [{ scope: 'user' }] } });
      connect('claude-code', p);
      put(join(p.home, LISTED), listed());
      const wired = look(join(p.home, CLAUDE)) as { hooks: Record<string, unknown[]> };
      assert.deepEqual([wired.hooks.PostToolUse.length, wired.hooks.PostToolUse[0], wired.hooks.Notification], [4, GUARD, [NOTIFY]]);
      const changes = disconnect('claude-code', script ? { ...p, app: APP, node: NODE } : p);
      assert.deepEqual(steps(changes), [remove, join(p.home, CLAUDE)]);
      assert.equal(changes[0].what, `The server agent-ctx is removed from Claude Code with the command ${remove.join(' ')}.`);
      assert.equal(changes[1].what, `The agent-ctx hooks for ${EVENTS} are removed from ${join(p.home, CLAUDE)}.`);
      assert.deepEqual(look(join(p.home, CLAUDE)), kept);
      assert.deepEqual(look(join(p.home, CLAUDE + BACKUP)), kept);
    }
  });

  test('every line about one program is one line without the banned words and marks', (t) => {
    const p = one(t);
    const lines = connect('claude-code', p).map((change) => change.what);
    put(join(p.home, LISTED), listed('/old/agent-ctx'));
    lines.push(...plan('claude-code', p).map((change) => change.what));
    plugged(p);
    lines.push(...plan('claude-code', p).map((change) => change.what), ...unplan('claude-code', p).map((change) => change.what));
    const q = one(t);
    put(join(q.home, CLAUDE), '{ "hooks": {');
    lines.push(...plan('claude-code', q).map((change) => change.what));
    for (const agent of OTHERS) lines.push(...connect(agent, q).map((change) => change.what), ...disconnect(agent, q).map((change) => change.what));
    assert.equal(lines.length > 20, true, String(lines.length));
    assert.equal(lines.includes(note.what), true);
    assert.equal(lines.some((line) => line.includes(' is not strict JSON and was left alone. To connect by hand, add ')), true);
    for (const line of lines) {
      assert.doesNotMatch(line, /\n|\b(it|its|itself|them|they|this|that|those)\b|[\u2013\u2014;()]| - /i, line);
      assert.match(line, /\.$/, line);
    }
  });
});
