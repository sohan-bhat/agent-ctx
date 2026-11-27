import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCRIPTS = join(ROOT, 'plugins', 'claude-code', 'scripts');
export const MAIN = join(SCRIPTS, 'agent-ctx.mjs');
export const HOOK = join(SCRIPTS, 'hook.mjs');
export const BANNED = /\b(it|its|itself|it's|they|them)\b|[—–;:()]| - /i;

export interface Place { root: string; HOME: string; AGENT_CTX_HOME: string; bin: string; log: string }
export interface Ran { code: number | null; out: string; err: string; ms: number }
export type Json = Record<string, unknown>;

let places = 0;

export function place(tmp: string): Place {
  const root = join(tmp, `place-${++places}`);
  const where = { root, HOME: join(root, 'home'), AGENT_CTX_HOME: join(root, 'memory'), bin: join(root, 'bin'), log: join(root, 'claude.log') };
  for (const dir of [where.HOME, where.bin]) mkdirSync(dir, { recursive: true });
  return where;
}

export function envOf(where: Place, more: Record<string, string> = {}): Record<string, string> {
  for (const path of Object.values(where)) assert.ok(path.startsWith(`${dirname(where.root)}${sep}`) && /agent-ctx-[a-z]+-/.test(path), `${path} lies outside the temp folder`);
  return { PATH: `${where.bin}:/usr/bin:/bin`, HOME: where.HOME, AGENT_CTX_HOME: where.AGENT_CTX_HOME, STUB_LOG: where.log, ...more };
}

export function run(file: string, args: string[], where: Place, input = '', more: Record<string, string> = {}): Ran {
  const started = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', env: envOf(where, more), input });
  return { code: r.status, out: r.stdout, err: r.stderr, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

export function hook(where: Place, agent: string, event: Json, more: Record<string, string> = {}): Ran {
  return run(HOOK, ['--agent', agent], where, JSON.stringify(event), more);
}

const WAIT = ['set timeout 60', 'expect eof', 'catch wait result', 'exit [lindex $result 3]'];
const WHOLE = [WAIT[0], 'spawn -noecho {*}$argv', ...WAIT.slice(1)].join('\n');
const PAUSED = [
  WAIT[0],
  'spawn -noecho {*}[lrange $argv 2 end]',
  'expect [lindex $argv 1]',
  'close [open [lindex $argv 0]/seen w]',
  'while {![file exists [lindex $argv 0]/go]} { after 50 }',
  'send "\\r"',
  ...WAIT.slice(1),
].join('\n');

export const PTY = spawnSync('expect', ['-v'], { env: { PATH: '/usr/bin:/bin' } }).status === 0;

function script(where: Place, text: string): string {
  const file = join(where.root, 'terminal.exp');
  writeFileSync(file, `${text}\n`);
  return file;
}

export function terminal(args: string[], where: Place, more: Record<string, string> = {}): Ran {
  const started = process.hrtime.bigint();
  const r = spawnSync('expect', [script(where, WHOLE), process.execPath, MAIN, ...args], { encoding: 'utf8', env: envOf(where, more), stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, out: r.stdout.replaceAll('\r', ''), err: r.stderr, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

export function typing(args: string[], until: string, where: Place): ChildProcessWithoutNullStreams {
  return spawn('expect', [script(where, PAUSED), where.root, until, process.execPath, MAIN, ...args], { env: envOf(where), stdio: ['pipe', 'pipe', 'pipe'] });
}

export function stub(where: Place): void {
  const file = join(where.bin, 'claude');
  const record = '"$HOME/.claude/plugins/installed_plugins.json"';
  writeFileSync(
    file,
    [
      '#!/bin/sh',
      'echo "$*" >> "$STUB_LOG"',
      '[ -n "$STUB_FAIL" ] && exit 1',
      `if [ "$1 $2" = "plugin install" ]; then mkdir -p "$HOME/.claude/plugins"; printf '{"version":2,"plugins":{"agent-ctx@agent-ctx":[{"scope":"user"}]}}\\n' > ${record}; fi`,
      `if [ "$1 $2" = "plugin uninstall" ]; then rm -f ${record}; rmdir "$HOME/.claude/plugins" 2>/dev/null; fi`,
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(file, 0o755);
}

export function calls(where: Place): string[] {
  return existsSync(where.log) ? readFileSync(where.log, 'utf8').trim().split('\n') : [];
}

export function put(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

export function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const file = join(entry.parentPath, entry.name);
    const name = relative(dir, file);
    if (lstatSync(file).isDirectory()) out[`${name}/`] = '';
    else out[name] = readFileSync(file).toString('base64');
  }
  return out;
}

export function rows<T>(where: Place, query: string, ...args: (string | number)[]): T[] {
  const emit = process.emitWarning;
  process.emitWarning = () => undefined;
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(join(where.AGENT_CTX_HOME, 'memory.db'));
    try {
      return db.prepare(query).all(...args).map((r) => ({ ...r })) as T[];
    } finally {
      db.close();
    }
  } finally {
    process.emitWarning = emit;
  }
}

export function plain(out: string, where: Place): string {
  return out.split(where.root).join('').replace(/\S*\/node\b/g, 'node').replace(/npx -y github:\S+/g, 'COMMAND').replace(/"[^"\n]*"/g, 'WORDS');
}

export async function server(where: Place, agent: string, calls: [string, Json][]): Promise<string[]> {
  const child = spawn(process.execPath, [MAIN, 'mcp', '--agent', agent], { env: envOf(where), stdio: ['pipe', 'pipe', 'pipe'] });
  const answers = new Map<number, string>();
  let buffer = '';
  let done: () => void = () => undefined;
  const all = new Promise<void>((resolve) => (done = resolve));
  child.stdout.on('data', (d) => {
    buffer += String(d);
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const m = JSON.parse(buffer.slice(0, at)) as { id?: number; result?: { content?: { text?: string }[] } };
      buffer = buffer.slice(at + 1);
      if (typeof m.id === 'number') answers.set(m.id, (m.result?.content ?? []).map((c) => c.text ?? '').join(''));
      if (answers.size === calls.length + 1) done();
    }
  });
  const send = (m: Json): void => void child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  send({ id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'kit', version: '1' } } });
  send({ method: 'notifications/initialized' });
  calls.forEach(([name, args], k) => send({ id: k + 1, method: 'tools/call', params: { name, arguments: args } }));
  await all;
  child.stdin.end();
  await new Promise((resolve) => child.on('exit', resolve));
  return calls.map((_, k) => answers.get(k + 1) ?? '');
}
