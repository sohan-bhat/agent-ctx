import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMIT, fits, read, write, type EventArgs, type Host } from '../src/hook.ts';

type Json = Record<string, unknown>;
type Sample = [name: string, host: Host, stdin: Json, want: EventArgs];

const HOSTS: Host[] = ['claude-code', 'codex', 'cursor', 'gemini'];
const DIR = '/work/app';
const LOG = '/work/log/turns.jsonl';
const SRC = '/work/app/src/mixer.ts';
const BOOK = '/work/app/notes/plot.ipynb';
const CMD = 'npm test';
const ASK = 'Add the gust filter to the mixer';
const REPLY = 'The gust filter is in place and the suite is green.';
const SECRET = 'leak-7f3a-tool-result';

const claude = (name: string, more: Json = {}): Json => ({ session_id: 's-1', prompt_id: 'p-1', transcript_path: LOG, cwd: DIR, permission_mode: 'default', hook_event_name: name, ...more });
const codex = (name: string, more: Json = {}): Json => ({ session_id: 's-2', transcript_path: LOG, cwd: DIR, hook_event_name: name, model: 'model-b', permission_mode: 'default', turn_id: 't-1', ...more });
const cursor = (name: string, more: Json = {}): Json => ({ conversation_id: 'c-3', generation_id: 'g-1', model: 'model-c', hook_event_name: name, cursor_version: '3.2.0', workspace_roots: [DIR], user_email: 'dev@example.test', transcript_path: LOG, ...more });
const gemini = (name: string, more: Json = {}): Json => ({ session_id: 's-4', transcript_path: LOG, cwd: DIR, hook_event_name: name, timestamp: '2026-11-14T08:00:00Z', ...more });
const made = (name: string, input: Json, more: Json = {}): Json => ({ tool_name: name, tool_input: input, tool_use_id: 'use-1', ...more });

const A = { host: 'claude-code', session: 's-1', cwd: DIR };
const B = { host: 'codex', session: 's-2', cwd: DIR };
const C = { host: 'cursor', session: 'c-3', cwd: DIR, model: 'model-c' };
const G = { host: 'gemini', session: 's-4', cwd: DIR };

const SAMPLES: Sample[] = [
  ['claude-code UserPromptSubmit', 'claude-code', claude('UserPromptSubmit', { prompt: ASK }), { ...A, event: 'UserPromptSubmit', prompt: ASK }],
  ['claude-code PostToolUse Write', 'claude-code', claude('PostToolUse', made('Write', { file_path: SRC, content: 'let gust = 0;' }, { tool_response: { filePath: SRC, type: 'create' }, duration_ms: 12 })), { ...A, event: 'PostToolUse', tool: 'Write', file: SRC }],
  ['claude-code PostToolUse Edit', 'claude-code', claude('PostToolUse', made('Edit', { file_path: SRC, old_string: 'a', new_string: 'b' }, { tool_response: { filePath: SRC } })), { ...A, event: 'PostToolUse', tool: 'Edit', file: SRC }],
  ['claude-code PostToolUse MultiEdit', 'claude-code', claude('PostToolUse', made('MultiEdit', { file_path: SRC, edits: [] }, { tool_response: { filePath: SRC } })), { ...A, event: 'PostToolUse', tool: 'MultiEdit', file: SRC }],
  ['claude-code PostToolUse NotebookEdit', 'claude-code', claude('PostToolUse', made('NotebookEdit', { notebook_path: BOOK, new_source: 'plot()' }, { tool_response: { ok: true } })), { ...A, event: 'PostToolUse', tool: 'NotebookEdit', file: BOOK }],
  ['claude-code PostToolUse Bash', 'claude-code', claude('PostToolUse', made('Bash', { command: CMD, description: 'Run the suite' }, { tool_response: { stdout: 'ok' }, duration_ms: 4187 })), { ...A, event: 'PostToolUse', tool: 'Bash', command: CMD }],
  ['claude-code PostToolUseFailure Bash', 'claude-code', claude('PostToolUseFailure', made('Bash', { command: CMD }, { error: 'Exit code 1', is_interrupt: false, duration_ms: 4187 })), { ...A, event: 'PostToolUseFailure', tool: 'Bash', command: CMD }],
  ['claude-code Stop', 'claude-code', claude('Stop', { stop_hook_active: false, last_assistant_message: REPLY, background_tasks: [], session_crons: [] }), { ...A, event: 'Stop', message: REPLY }],
  ['claude-code StopFailure', 'claude-code', claude('StopFailure', { error: 'rate_limit', last_assistant_message: 'API Error' }), { ...A, event: 'StopFailure', reason: 'rate_limit' }],
  ['claude-code PostCompact', 'claude-code', claude('PostCompact', { trigger: 'auto', compact_summary: 'The mixer work so far.' }), { ...A, event: 'PostCompact', summary: 'The mixer work so far.' }],
  ['claude-code SessionStart clear', 'claude-code', claude('SessionStart', { source: 'clear' }), { ...A, event: 'SessionStart', source: 'clear' }],
  ['claude-code SessionStart compact', 'claude-code', claude('SessionStart', { source: 'compact', model: 'model-a' }), { ...A, event: 'SessionStart', source: 'compact' }],
  ['codex UserPromptSubmit', 'codex', codex('UserPromptSubmit', { prompt: ASK }), { ...B, event: 'UserPromptSubmit', prompt: ASK }],
  ['codex PostToolUse Bash', 'codex', codex('PostToolUse', made('Bash', { command: CMD }, { tool_response: 'ok' })), { ...B, event: 'PostToolUse', tool: 'Bash', command: CMD }],
  ['codex Stop', 'codex', codex('Stop', { stop_hook_active: false, last_assistant_message: REPLY }), { ...B, event: 'Stop', message: REPLY }],
  ['cursor sessionStart', 'cursor', cursor('sessionStart'), { ...C, event: 'SessionStart' }],
  ['cursor beforeSubmitPrompt', 'cursor', cursor('beforeSubmitPrompt', { prompt: ASK, attachments: [] }), { ...C, event: 'UserPromptSubmit', prompt: ASK }],
  ['cursor postToolUse Write', 'cursor', cursor('postToolUse', made('Write', { file_path: SRC }, { tool_output: 'written', cwd: '/work/app/pkg', duration: 12 })), { ...C, cwd: '/work/app/pkg', event: 'PostToolUse', tool: 'Write', file: SRC }],
  ['cursor postToolUse Shell', 'cursor', cursor('postToolUse', made('Shell', { command: CMD }, { tool_output: 'ok', cwd: DIR, duration: 900 })), { ...C, event: 'PostToolUse', tool: 'Shell', command: CMD }],
  ['cursor afterAgentResponse', 'cursor', cursor('afterAgentResponse', { text: REPLY }), { ...C, event: 'Stop', message: REPLY }],
  ['cursor stop completed', 'cursor', cursor('stop', { status: 'completed', loop_count: 0 }), { ...C, event: 'Stop' }],
  ['cursor stop error', 'cursor', cursor('stop', { status: 'error', loop_count: 0 }), { ...C, event: 'StopFailure', reason: 'error' }],
  ['cursor stop aborted', 'cursor', cursor('stop', { status: 'aborted', loop_count: 1 }), { ...C, event: 'Stop' }],
  ['gemini BeforeAgent', 'gemini', gemini('BeforeAgent', { prompt: ASK }), { ...G, event: 'UserPromptSubmit', prompt: ASK }],
  ['gemini AfterTool write_file', 'gemini', gemini('AfterTool', made('write_file', { file_path: SRC, content: 'let gust = 0;' }, { tool_response: { llmContent: 'written' }, mcp_context: null })), { ...G, event: 'PostToolUse', tool: 'write_file', file: SRC }],
  ['gemini AfterTool replace', 'gemini', gemini('AfterTool', made('replace', { file_path: SRC, old_string: 'a', new_string: 'b' }, { tool_response: { llmContent: 'done' } })), { ...G, event: 'PostToolUse', tool: 'replace', file: SRC }],
  ['gemini AfterTool run_shell_command', 'gemini', gemini('AfterTool', made('run_shell_command', { command: CMD }, { tool_response: { llmContent: 'ok' } })), { ...G, event: 'PostToolUse', tool: 'run_shell_command', command: CMD }],
  ['gemini AfterAgent', 'gemini', gemini('AfterAgent', { prompt: ASK, prompt_response: REPLY, stop_hook_active: false }), { ...G, event: 'Stop', message: REPLY }],
];

for (const [name, host, stdin, want] of SAMPLES) {
  test(`${name} gives the expected event`, () => {
    assert.deepEqual(read(host, JSON.stringify(stdin)), want);
  });
}

test('a Cursor session with no conversation id falls back to the session id', () => {
  const stdin = { ...cursor('sessionStart'), conversation_id: undefined, session_id: 'c-9' };
  assert.deepEqual(read('cursor', JSON.stringify(stdin)), { ...C, session: 'c-9', event: 'SessionStart' });
});

test('a field that is absent or not text is left out', () => {
  assert.deepEqual(read('claude-code', JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 7, cwd: DIR, prompt: '' })), { host: 'claude-code', event: 'UserPromptSubmit', cwd: DIR });
  assert.deepEqual(read('claude-code', JSON.stringify(claude('PostToolUse', { tool_name: 'Write', tool_input: 'none' }))), { ...A, event: 'PostToolUse', tool: 'Write' });
});

interface Group { matcher?: string; hooks: { input: Record<string, string> }[] }
const SUBJECT: Record<string, string> = { PostToolUse: 'tool_name', PostToolUseFailure: 'tool_name', SessionStart: 'source' };
const OTHER: Record<string, string[]> = { tool_name: ['Read', 'Grep', 'Glob', 'Task', 'WebFetch', 'TodoWrite', 'write', 'Bash2', 'mcp__agent-ctx__event'], source: ['startup', 'resume', 'fork'] };
const plugin = (path: string): Record<string, Group[]> => (JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { hooks: Record<string, Group[]> }).hooks;

function put(into: Json, path: string, value: string): void {
  const keys = path.split('.');
  let node = into;
  for (const key of keys.slice(0, -1)) node = (node[key] ??= {}) as Json;
  node[keys[keys.length - 1] as string] = value;
}

function cover(host: Host, path: string): { cases: number; names: string[]; matchers: Record<string, string[]> } {
  const hooks = plugin(path);
  const matchers: Record<string, string[]> = {};
  let cases = 0;
  for (const [name, groups] of Object.entries(hooks)) {
    for (const group of groups) {
      const values = group.matcher ? group.matcher.split('|') : [undefined];
      if (group.matcher) (matchers[name] ??= []).push(...group.matcher.split('|'));
      for (const value of values) {
        for (const hook of group.hooks) {
          const stdin: Json = { hook_event_name: name, transcript_path: LOG, tool_response: SECRET };
          const want: Json = {};
          for (const [field, template] of Object.entries(hook.input)) {
            const slot = /^\$\{(.+)\}$/.exec(template)?.[1];
            if (!slot) {
              want[field] = template;
              continue;
            }
            const sample = value && slot === SUBJECT[name] ? value : `value of ${slot}`;
            put(stdin, slot, sample);
            want[field] = sample;
          }
          assert.equal(want.host, host);
          assert.equal(want.event, name);
          if (value) assert.equal(stdin[SUBJECT[name] as string], value, `${name} has a matcher and no subject field`);
          assert.deepEqual(read(host, JSON.stringify(stdin)), want, `${name} ${value ?? ''}`);
          cases++;
        }
      }
    }
  }
  return { cases, names: Object.keys(hooks), matchers };
}

test('every event and matcher of the Claude Code plugin file gives the fields of that file', () => {
  const { cases, names, matchers } = cover('claude-code', '../../service/plugins/claude-code/hooks/hooks.json');
  assert.equal(cases, 12);
  assert.deepEqual(names.sort(), ['PostCompact', 'PostToolUse', 'PostToolUseFailure', 'SessionStart', 'Stop', 'StopFailure', 'UserPromptSubmit']);
  assert.deepEqual(matchers, { PostToolUse: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'], PostToolUseFailure: ['Bash'], SessionStart: ['clear', 'compact'] });
});

test('a Claude Code event or matcher value outside the plugin file gives null', () => {
  const { names, matchers } = cover('claude-code', '../../service/plugins/claude-code/hooks/hooks.json');
  for (const name of ['PreToolUse', 'SessionEnd', 'SubagentStop', 'PreCompact', 'Notification', 'UserPromptExpansion', 'PostToolBatch', 'PermissionRequest', 'Setup']) {
    assert.ok(!names.includes(name));
    assert.equal(read('claude-code', JSON.stringify(claude(name, { prompt: ASK, source: 'clear', ...made('Bash', { command: CMD }) }))), null, name);
  }
  for (const [name, kept] of Object.entries(matchers)) {
    const subject = SUBJECT[name] as string;
    const others = [...(OTHER[subject] as string[]), ...Object.values(matchers).flat().filter((v) => !kept.includes(v))];
    assert.ok(others.length > 3);
    for (const value of others) {
      const stdin = claude(name, { ...made('Bash', { command: CMD, file_path: SRC, notebook_path: BOOK }), source: 'clear', [subject]: value });
      assert.equal(read('claude-code', JSON.stringify(stdin)), null, `${name} ${value}`);
    }
  }
});

test('every event and matcher of the Codex plugin file gives the fields of that file', () => {
  const { cases, names, matchers } = cover('codex', '../../service/plugins/codex/hooks.json');
  assert.equal(cases, 3);
  assert.deepEqual(names.sort(), ['PostToolUse', 'Stop', 'UserPromptSubmit']);
  assert.deepEqual(matchers, { PostToolUse: ['Bash'] });
  for (const name of ['Write', 'Edit', 'apply_patch', 'shell']) assert.equal(read('codex', JSON.stringify(codex('PostToolUse', made(name, { command: CMD, file_path: SRC })))), null, name);
  for (const name of ['PostToolUseFailure', 'StopFailure', 'PostCompact', 'SessionStart', 'PreToolUse']) assert.equal(read('codex', JSON.stringify(codex(name, { source: 'clear', ...made('Bash', { command: CMD }) }))), null, name);
});

const TOOL_EVENT: Record<Host, [string, (name: string, more?: Json) => Json]> = { 'claude-code': ['PostToolUse', claude], codex: ['PostToolUse', codex], cursor: ['postToolUse', cursor], gemini: ['AfterTool', gemini] };
const DROPPED: Record<Host, string[]> = {
  'claude-code': ['Read', 'Grep', 'Glob', 'Task', 'WebFetch', 'Shell', 'write_file', 'bash'],
  codex: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read', 'Shell', 'run_shell_command'],
  cursor: ['Read', 'Grep', 'Delete', 'Task', 'MCP', 'write_file', 'shell'],
  gemini: ['read_file', 'glob', 'search_file_content', 'list_directory', 'web_fetch', 'Write', 'Bash'],
};

for (const host of HOSTS) {
  test(`${host} tools outside the kept list give null`, () => {
    const [name, base] = TOOL_EVENT[host];
    for (const tool of DROPPED[host]) assert.equal(read(host, JSON.stringify(base(name, made(tool, { command: CMD, file_path: SRC, notebook_path: BOOK })))), null, tool);
    assert.equal(read(host, JSON.stringify(base(name, { tool_input: { command: CMD } }))), null);
  });
}

const UNKNOWN: Record<Host, string[]> = {
  'claude-code': ['sessionStart', 'BeforeAgent', 'Elsewhere', ''],
  codex: ['beforeSubmitPrompt', 'AfterAgent', 'Elsewhere', ''],
  cursor: ['UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionStart', 'afterFileEdit', 'preToolUse', 'sessionEnd', 'BeforeAgent'],
  gemini: ['UserPromptSubmit', 'PostToolUse', 'Stop', 'BeforeTool', 'SessionStart', 'beforeSubmitPrompt'],
};

for (const host of HOSTS) {
  test(`${host} unknown events give null`, () => {
    const base = TOOL_EVENT[host][1];
    for (const name of UNKNOWN[host]) assert.equal(read(host, JSON.stringify(base(name, { prompt: ASK, text: REPLY, source: 'clear', status: 'completed', ...made('Bash', { command: CMD }) }))), null, name);
    assert.equal(read(host, JSON.stringify({ session_id: 's-1', cwd: DIR, prompt: ASK })), null);
    assert.equal(read(host, JSON.stringify({ hook_event_name: 7, session_id: 's-1', cwd: DIR })), null);
  });
}

test('names that every object carries are not read as events or tools', () => {
  for (const host of HOSTS) {
    const [name, base] = TOOL_EVENT[host];
    for (const odd of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      assert.equal(read(host, JSON.stringify(base(odd, made('Bash', { command: CMD })))), null, odd);
      assert.equal(read(host, JSON.stringify(base(name, made(odd, { command: CMD })))), null, odd);
    }
  }
  assert.equal(read('claude-code', JSON.stringify(claude('SessionStart', { source: 'constructor' }))), null);
  assert.deepEqual(read('cursor', JSON.stringify(cursor('stop', { status: 'constructor' }))), { ...C, event: 'Stop' });
});

test('broken JSON, an empty string and values that are no object give null', () => {
  for (const host of HOSTS) {
    for (const stdin of ['', ' ', '{', '{"hook_event_name":"Stop"', 'not json', '[]', '[{"hook_event_name":"Stop","session_id":"s-1"}]', 'null', 'true', '7', '"Stop"', '{}']) {
      assert.doesNotThrow(() => read(host, stdin));
      assert.equal(read(host, stdin), null, stdin);
    }
  }
});

test('a host name outside the four gives null and an empty string', () => {
  const odd = 'elsewhere' as Host;
  assert.equal(read(odd, JSON.stringify(claude('Stop', { last_assistant_message: REPLY }))), null);
  assert.equal(read('constructor' as Host, JSON.stringify(claude('Stop'))), null);
  assert.equal(write(odd, 'UserPromptSubmit', 'Memory'), '');
});

test('a tool response or tool output never reaches the result', () => {
  const shapes: Json[] = [
    { tool_response: SECRET, tool_output: SECRET },
    { tool_response: { stdout: SECRET, file_path: SECRET, command: SECRET, nested: [SECRET] }, tool_output: { text: SECRET, command: SECRET } },
    { tool_response: [SECRET], tool_output: [SECRET] },
  ];
  let kept = 0;
  for (const [name, host, stdin, want] of SAMPLES) {
    for (const shape of shapes) {
      const got = read(host, JSON.stringify({ ...stdin, ...shape }));
      assert.deepEqual(got, want, name);
      assert.ok(!JSON.stringify(got).includes(SECRET), name);
      kept++;
    }
  }
  assert.equal(kept, SAMPLES.length * shapes.length);
  const failed = read('claude-code', JSON.stringify(claude('PostToolUseFailure', made('Bash', { command: CMD }, { error: SECRET, tool_response: SECRET }))));
  assert.deepEqual(failed, { ...A, event: 'PostToolUseFailure', tool: 'Bash', command: CMD });
});

const TEXT = 'Memory\n- one';
const CAMEL = '{"hookSpecificOutput":{"hookEventName":"BeforeAgent","additionalContext":"Memory\\n- one"}}';
const SNAKE = '{"additional_context":"Memory\\n- one"}';
const WRITES: [host: Host, event: string, want: string][] = [
  ['claude-code', 'UserPromptSubmit', TEXT],
  ['claude-code', 'SessionStart', TEXT],
  ['claude-code', 'PostToolUse', ''],
  ['claude-code', 'PostToolUseFailure', ''],
  ['claude-code', 'Stop', ''],
  ['claude-code', 'StopFailure', ''],
  ['claude-code', 'PostCompact', ''],
  ['codex', 'UserPromptSubmit', TEXT],
  ['codex', 'SessionStart', ''],
  ['codex', 'PostToolUse', ''],
  ['codex', 'Stop', ''],
  ['gemini', 'UserPromptSubmit', CAMEL],
  ['gemini', 'BeforeAgent', CAMEL],
  ['gemini', 'PostToolUse', ''],
  ['gemini', 'AfterTool', ''],
  ['gemini', 'Stop', ''],
  ['gemini', 'AfterAgent', ''],
  ['gemini', 'SessionStart', ''],
  ['cursor', 'SessionStart', SNAKE],
  ['cursor', 'sessionStart', SNAKE],
  ['cursor', 'PostToolUse', SNAKE],
  ['cursor', 'postToolUse', SNAKE],
  ['cursor', 'UserPromptSubmit', ''],
  ['cursor', 'beforeSubmitPrompt', ''],
  ['cursor', 'Stop', ''],
  ['cursor', 'StopFailure', ''],
  ['cursor', 'afterAgentResponse', ''],
  ['cursor', 'stop', ''],
];

for (const [host, event, want] of WRITES) {
  test(`${host} on ${event} writes ${want ? 'the exact text' : 'nothing'}`, () => {
    assert.equal(write(host, event, TEXT), want);
  });
}

test('an empty text always gives an empty string', () => {
  for (const [host, event] of WRITES) {
    assert.equal(write(host, event, ''), '');
    assert.equal(write(host, event, ' \n\t\n'), '');
  }
});

test('the limits are the figures taken from the research', () => {
  assert.deepEqual(LIMIT, { 'claude-code': 10000, codex: 7500, cursor: 7500, gemini: 7500 });
});

const HEARD: Record<Host, string> = { 'claude-code': 'UserPromptSubmit', codex: 'UserPromptSubmit', cursor: 'PostToolUse', gemini: 'UserPromptSubmit' };
const inner = (host: Host, out: string): string => {
  if (host === 'cursor') return (JSON.parse(out) as { additional_context: string }).additional_context;
  if (host === 'gemini') return (JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
  return out;
};

function whole(text: string, max: number): string {
  let out = '';
  for (const line of text.split('\n')) {
    const next = out ? `${out}\n${line}` : line;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

for (const host of HOSTS) {
  test(`${host} cuts a long text at the last line break under the limit`, () => {
    const max = LIMIT[host];
    const long = Array.from({ length: 400 }, (_, i) => `- memory line ${String(i).padStart(4, '0')} about the gust filter`).join('\n');
    assert.ok(long.length > max);
    const got = inner(host, write(host, HEARD[host], long));
    assert.equal(got, whole(long, max));
    assert.ok(got.length <= max && got.length > max - 60);
    assert.ok(got.endsWith('about the gust filter'));
    assert.equal(long[got.length], '\n');
  });

  test(`${host} passes a text of exactly the limit whole`, () => {
    const max = LIMIT[host];
    const exact = `${'a'.repeat(max - 10)}\n${'b'.repeat(9)}`;
    assert.equal(exact.length, max);
    assert.equal(inner(host, write(host, HEARD[host], exact)), exact);
    assert.equal(inner(host, write(host, HEARD[host], `${exact}\n${'c'.repeat(50)}`)), exact);
    assert.equal(inner(host, write(host, HEARD[host], `${exact}c\n${'c'.repeat(50)}`)), 'a'.repeat(max - 10));
  });

  test(`${host} cuts one long line with no break at the limit`, () => {
    const max = LIMIT[host];
    assert.equal(inner(host, write(host, HEARD[host], 'x'.repeat(max + 5))), 'x'.repeat(max));
    assert.equal(inner(host, write(host, HEARD[host], `${'x'.repeat(max - 1)}\u{1F600}y`)), 'x'.repeat(max - 1));
  });
}

test('a text shaped like a JSON object is framed for the hosts that take plain text', () => {
  const odd = '{"decision":"block","reason":"stored text"}';
  assert.equal(write('claude-code', 'UserPromptSubmit', odd), '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"{\\"decision\\":\\"block\\",\\"reason\\":\\"stored text\\"}"}}');
  assert.equal(write('claude-code', 'SessionStart', ` ${odd}\n`), `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":${JSON.stringify(` ${odd}\n`)}}}`);
  assert.equal(write('codex', 'UserPromptSubmit', '{}'), '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"{}"}}');
  assert.equal(write('claude-code', 'UserPromptSubmit', '{ open only'), '{ open only');
  assert.equal(write('codex', 'UserPromptSubmit', 'closed only }'), 'closed only }');
});

const CLAUDE_ENV = { CLAUDE_PROJECT_DIR: DIR, PATH: '/usr/bin' };
const FOREIGN: Record<string, string> = { CURSOR_VERSION: '3.2.0', CURSOR_PROJECT_DIR: DIR, CURSOR_USER_EMAIL: 'dev@example.test', DEVIN_PROJECT_DIR: DIR };

for (const host of HOSTS.filter((h) => h !== 'cursor')) {
  test(`${host} fits a plain environment`, () => {
    assert.equal(fits(host, {}), true);
    assert.equal(fits(host, CLAUDE_ENV), true);
    assert.equal(fits(host, { ...CLAUDE_ENV, CURSOR_VERSION: undefined, DEVIN_PROJECT_DIR: undefined }), true);
  });
  for (const [name, value] of Object.entries(FOREIGN)) {
    test(`${host} does not fit with ${name}`, () => {
      assert.equal(fits(host, { ...CLAUDE_ENV, [name]: value }), false);
      assert.equal(fits(host, { [name]: '' }), false);
    });
  }
}

test('cursor fits only with CURSOR_VERSION', () => {
  assert.equal(fits('cursor', {}), false);
  assert.equal(fits('cursor', CLAUDE_ENV), false);
  assert.equal(fits('cursor', { ...CLAUDE_ENV, CURSOR_PROJECT_DIR: DIR, CURSOR_USER_EMAIL: 'dev@example.test' }), false);
  assert.equal(fits('cursor', { CURSOR_VERSION: '3.2.0' }), true);
  assert.equal(fits('cursor', { ...CLAUDE_ENV, CURSOR_VERSION: '3.2.0', CURSOR_PROJECT_DIR: DIR, CURSOR_USER_EMAIL: 'dev@example.test' }), true);
});

test('cursor does not fit with DEVIN_PROJECT_DIR', () => {
  assert.equal(fits('cursor', { CURSOR_VERSION: '3.2.0', DEVIN_PROJECT_DIR: DIR }), false);
});
