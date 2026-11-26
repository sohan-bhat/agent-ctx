import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { Person } from '../src/person.ts';
import { TABLES } from '../src/store.ts';
import { ORIGIN, call, connect, devSignIn, mcp, send } from './flow.ts';

let seed = 77;
function chars(n: number, set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    s += set[seed % set.length];
  }
  return s;
}

function fakeKeys(): { text: string; secret: string }[] {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ234567';
  const out: { text: string; secret: string }[] = [];
  const add = (text: string, secret = text) => out.push({ text, secret });
  add(['sk', 'live', chars(24)].join('_'));
  add(`sk-${chars(40)}`);
  add(`gh${'p'}_${chars(36)}`);
  add(`github_${'pat'}_${chars(40)}`);
  add(`glpat-${chars(22)}`);
  add(`xox${'b'}-${chars(30)}`);
  add(`AK${'IA'}${chars(16, upper)}`);
  add(`AI${'za'}${chars(35)}`);
  add(`npm_${chars(36)}`);
  add(`hf_${chars(34)}`);
  add(`SG.${chars(22)}.${chars(43)}`);
  add(`ey${'J'}${chars(20)}.${chars(30)}.${chars(30)}`);
  const pw = chars(14);
  add(`postgres://admin:${pw}@db.internal/app`, pw);
  const pem = chars(64);
  add(`-----BEGIN RSA ${'PRIVATE'} KEY-----\n${pem}\n-----END RSA ${'PRIVATE'} KEY-----`, pem);
  const pass = chars(14);
  add(`password=${pass}`, pass);
  const bearer = chars(40);
  add(`Authorization: Bearer ${bearer}`, bearer);
  return out;
}

const KEYS = fakeKeys();
const ALL = KEYS.map((k) => k.text).join(' and ');

function leaks(text: string): string[] {
  return KEYS.filter((k) => text.includes(k.secret)).map((k) => k.secret.slice(0, 12));
}

const logs: string[] = [];
beforeEach(() => {
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

describe('redaction', () => {
  it('fake keys in every text field never reach a row, an export, an API answer, a socket message or a log line', async () => {
    const jar = await devSignIn('redact-one');
    const client = await mcp((await connect(jar, 'dcr', ['read', 'write'], 'Codex')).access);
    const live = await send('/api/live', { headers: { Cookie: jar.header(), Upgrade: 'websocket' } });
    const ws = live.webSocket!;
    ws.accept();
    const messages: string[] = [];
    ws.addEventListener('message', (e) => messages.push(String(e.data)));

    const folder = `/work/kiln ${KEYS[1].text}`;
    const repo = `https://deploy:${KEYS[2].text}@github.com/acme/kiln.git`;
    const results: string[] = [];
    const run = async (name: string, args: Record<string, unknown>) => results.push(JSON.stringify(await call(client, name, args)));
    await run('checkpoint', { repo, folder, goal: `Goal ${ALL}`, changed: [`src/${KEYS[0].text}.ts`, ALL], decisions: [ALL], commands: [`export TOKEN=${KEYS[3].text} && ${ALL}`], dead_ends: [ALL], open: [ALL], key: ALL });
    await run('handoff', { repo, folder, goal: ALL, done: ALL, next: ALL, blockers: [ALL], files: [ALL], check: ALL, question: ALL, key: ALL });
    await run('rule', { repo, folder, text: ALL, words: ALL, scope: 'project', key: ALL });
    const hook = (event: string, more: Record<string, unknown>) => run('event', { host: 'claude-code', event, session: 'red-1', cwd: folder, model: `model ${KEYS[4].text}`, ...more });
    await hook('UserPromptSubmit', { prompt: `Please deploy with ${ALL}` });
    await hook('PostToolUse', { tool: 'Bash', command: `curl -H "Authorization: Bearer ${KEYS[15].secret}" ${ALL}`, file: `/tmp/${KEYS[5].text}.env` });
    await hook('PostToolUseFailure', { tool: 'Bash', command: `psql ${KEYS[12].text} ${ALL}` });
    await hook('Stop', { message: `Done. ${ALL}` });
    await hook('PostCompact', { summary: `Summary ${ALL}` });
    await hook('UserPromptSubmit', { prompt: `Second prompt about ${ALL}` });
    await run('recall', { repo, folder, query: `deploy ${ALL}` });
    await run('recall', { repo, folder, dropped: true });
    await send('/api/rules', { method: 'POST', headers: { Cookie: jar.header(), Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `Page rule ${ALL}`, scope: 'all' }) });

    expect(results.slice(0, 3).map((r) => JSON.parse(r).isError)).toEqual([false, false, false]);
    const stub = env.PERSON.getByName('dev-redact-one');
    const rows = await runInDurableObject(stub, (p: Person) => TABLES.map((t) => JSON.stringify(p.store.q(`SELECT * FROM ${t}`))).join('\n'));
    expect(rows).toContain('[secret dropped]');
    const zip = unzipSync(new Uint8Array(await (await send('/api/export', { headers: { Cookie: jar.header() } })).arrayBuffer()));
    const exported = Object.values(zip).map((v) => strFromU8(v)).join('\n');
    const answers = [await (await send('/api/space', { headers: { Cookie: jar.header() } })).text(), await (await send('/api/me', { headers: { Cookie: jar.header() } })).text()].join('\n');
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    const kv: string[] = [];
    for (const k of (await env.OAUTH_KV.list()).keys) kv.push(k.name, (await env.OAUTH_KV.get(k.name)) ?? '', JSON.stringify(k.metadata ?? null));

    expect(messages.length).toBeGreaterThan(3);
    expect({ rows: leaks(rows), exported: leaks(exported), answers: leaks(answers), results: leaks(results.join('\n')), messages: leaks(messages.join('\n')), logs: leaks(logs.join('\n')), kv: leaks(kv.join('\n')) }).toEqual({ rows: [], exported: [], answers: [], results: [], messages: [], logs: [], kv: [] });
  });
});
