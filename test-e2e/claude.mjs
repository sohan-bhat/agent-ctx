import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stamp } from '../scripts/stamp.mjs';
import { ORIGIN } from './service.mjs';

export const BIN = process.env.E2E_CLAUDE_BIN ?? join(homedir(), '.local', 'bin', 'claude');
export const MAX_RUNS = 25;
const HERE = fileURLToPath(import.meta.url);

export function paths(tmp, proofs) {
  return { tmp, proofs, secrets: join(tmp, 'secrets.json'), ledger: join(proofs, 'runs.jsonl') };
}

export function runsSoFar(ledger) {
  return existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).length : 0;
}

export function scrub(text, secrets, tmp) {
  let out = String(text);
  for (const v of secrets) if (v) out = out.split(v).join('REDACTED');
  out = out.replace(/Bearer [A-Za-z0-9._~+/:=-]+/g, 'Bearer REDACTED');
  out = out.split(tmp).join('/scratch');
  const me = userInfo().username;
  if (me.length > 2) out = out.split(me).join('owner');
  return out.replace(/\/private\/tmp\/claude-\d+\/[^\s"'\\]+?\/scratchpad/g, '/scratchpad').replace(/\/Users\/[^/\s"'\\]+/g, '/home');
}

export const SCOPED = 'plugin:agent-ctx:agent-ctx';

function setup(p, side, layout) {
  const settings = join(p.tmp, 'settings.json');
  writeFileSync(settings, JSON.stringify({ autoMemoryEnabled: false }));
  if (side === 'none') {
    const empty = join(p.tmp, 'mcp-empty.json');
    if (!existsSync(empty)) writeFileSync(empty, JSON.stringify({ mcpServers: {} }));
    return { mcp: empty, settings, plugin: null };
  }
  const s = JSON.parse(readFileSync(p.secrets, 'utf8'));
  const dir = join(p.tmp, 'plugin');
  if (!existsSync(join(dir, 'claude-code'))) stamp(ORIGIN, dir);
  const plugin = join(dir, 'claude-code');
  const server = (name) => ({ mcpServers: { [name]: { type: 'http', url: `${ORIGIN}/mcp`, headers: { Authorization: `Bearer ${s[side].access}` } } } });
  const mcp = join(p.tmp, `mcp-${side}-${layout}.json`);
  if (layout === 'settings') {
    writeFileSync(mcp, JSON.stringify(server('agent-ctx')));
    const hooks = readFileSync(join(plugin, 'hooks', 'hooks.json'), 'utf8').split(SCOPED).join('agent-ctx');
    const file = join(p.tmp, 'settings-hooks.json');
    writeFileSync(file, JSON.stringify({ autoMemoryEnabled: false, hooks: JSON.parse(hooks).hooks }));
    return { mcp, settings: file, plugin: null };
  }
  writeFileSync(mcp, JSON.stringify(server(SCOPED)));
  return { mcp, settings, plugin };
}

function userLine(text) {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;
}

export async function runClaude(p, o) {
  const used = runsSoFar(p.ledger);
  if (used >= MAX_RUNS) throw new Error(`The budget of ${MAX_RUNS} runs is spent.`);
  const layout = o.layout ?? 'scoped';
  const c = setup(p, o.side, layout);
  const debug = join(p.tmp, `${o.name}.debug.log`);
  const multi = o.prompts.length > 1;
  const args = ['-p'];
  if (!multi) args.push(o.prompts[0]);
  args.push('--model', 'haiku', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--no-session-persistence');
  args.push('--strict-mcp-config', '--mcp-config', c.mcp, '--settings', c.settings, '--setting-sources', 'project', '--debug-file', debug);
  if (multi) args.push('--input-format', 'stream-json');
  if (c.plugin) args.push('--plugin-dir', c.plugin);
  if (o.tools?.length) args.push('--allowedTools', o.tools.join(','));
  const env = { ...process.env, DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
  const started = Date.now();
  const child = spawn(BIN, args, { cwd: o.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let err = '';
  let buf = '';
  let sent = 1;
  if (multi) child.stdin.write(userLine(o.prompts[0]));
  else child.stdin.end();
  const timer = setTimeout(() => child.kill('SIGTERM'), o.timeout ?? 240000);
  child.stderr.on('data', (d) => (err += d));
  child.stdout.on('data', (d) => {
    buf += d;
    let at;
    while ((at = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, at);
      buf = buf.slice(at + 1);
      if (!line.trim()) continue;
      lines.push(line);
      if (!multi) continue;
      try {
        if (JSON.parse(line).type === 'result') {
          if (sent < o.prompts.length) child.stdin.write(userLine(o.prompts[sent++]));
          else child.stdin.end();
        }
      } catch {
        continue;
      }
    }
  });
  const code = await new Promise((r) => child.on('close', r));
  clearTimeout(timer);
  if (buf.trim()) lines.push(buf);
  const events = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { type: 'raw', text: l };
    }
  });
  const results = events.filter((e) => e.type === 'result');
  const secrets = existsSync(p.secrets) ? Object.values(JSON.parse(readFileSync(p.secrets, 'utf8'))).flatMap((v) => (typeof v === 'object' ? [v.access, v.clientId] : [v])) : [];
  mkdirSync(p.proofs, { recursive: true });
  writeFileSync(join(p.proofs, `${o.name}.jsonl`), scrub(lines.join('\n') + '\n', secrets, p.tmp));
  if (existsSync(debug)) writeFileSync(join(p.proofs, `${o.name}.debug.log`), scrub(readFileSync(debug, 'utf8').split('\n').filter((l) => /hook|mcp|agent-ctx|plugin/i.test(l)).join('\n') + '\n', secrets, p.tmp));
  const cost = results.reduce((n, r) => n + (r.total_cost_usd ?? 0), 0);
  const row = {
    n: used + 1,
    name: o.name,
    side: o.side,
    label: o.side === 'A' ? 'Claude Code' : o.side === 'B' ? 'Codex' : 'none',
    layout: o.side === 'none' ? 'none' : layout,
    cwd: scrub(o.cwd, secrets, p.tmp),
    prompts: o.prompts,
    code,
    start: started,
    end: Date.now(),
    seconds: Math.round((Date.now() - started) / 100) / 10,
    cost,
    usage: results.map((r) => r.usage ?? null),
    turns: results.map((r) => r.num_turns ?? null),
    result: results.map((r) => String(r.result ?? '').slice(0, 400)),
    denied: results.flatMap((r) => r.permission_denials ?? []),
  };
  appendFileSync(p.ledger, scrub(JSON.stringify(row), secrets, p.tmp) + '\n');
  return { row, events, stderr: scrub(err, secrets, p.tmp) };
}

export function summary(events) {
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const hooks = events.filter((e) => e.type === 'system' && /hook/.test(String(e.subtype)));
  const tools = events.flatMap((e) => (e.type === 'assistant' ? (e.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => ({ name: c.name, input: c.input })) : []));
  return {
    mcp: init?.mcp_servers ?? null,
    plugins: init?.plugins ?? null,
    hooks: hooks.map((h) => ({ subtype: h.subtype, name: h.hook_name ?? h.hook_event ?? h.name, outcome: h.outcome ?? h.exit_code ?? null, output: String(h.output ?? h.stdout ?? '').slice(0, 200) })),
    tools,
  };
}

const main = process.argv[1] && resolve(process.argv[1]) === HERE;

if (main) {
  const [name, side, cwd, ...rest] = process.argv.slice(2);
  const tmp = process.env.E2E_TMP;
  const proofs = process.env.E2E_PROOFS;
  const flag = (f) => {
    const i = rest.indexOf(f);
    if (i < 0) return undefined;
    const v = rest[i + 1];
    rest.splice(i, 2);
    return v;
  };
  const tools = (flag('--tools') ?? '').split(',').filter(Boolean);
  const layout = flag('--layout') ?? 'scoped';
  const prompts = rest;
  if (!name || !['A', 'B', 'none'].includes(side) || !cwd || !prompts.length || !tmp || !proofs) {
    console.log('Set E2E_TMP and E2E_PROOFS, then give a name, a side of A, B or none, a project folder and one or more prompts, with --tools LIST to allow tools.');
    process.exit(name ? 1 : 0);
  }
  const p = paths(tmp, proofs);
  const r = await runClaude(p, { name, side, cwd, prompts, tools, layout });
  console.log(JSON.stringify(r.row, null, 1));
  console.log(JSON.stringify(summary(r.events), null, 1).slice(0, 6000));
  if (r.stderr.trim()) console.log('stderr', r.stderr.slice(0, 1500));
}
