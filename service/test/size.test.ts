import { describe, expect, it } from 'vitest';
import type { EventArgs } from '../src/person.ts';
import { MAX, SAY } from '../src/limits.ts';
import { BODY_MAX, fitEvent } from '../src/mcp.ts';
import { RESOURCE, call, connect, devSignIn, mcp, send } from './flow.ts';
import { caller, open, person, sql } from './helpers.ts';

const CC = caller('Claude Code', 'grant-cc');
const OTHER = caller('Codex', 'grant-other');
const KEY = 'sk-proj-Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv';

function ev(session: string, event: string, more: Partial<EventArgs> = {}): EventArgs {
  return { host: 'claude-code', event, session, cwd: '/work/pantry', ...more };
}

async function rows(p: ReturnType<typeof person>): Promise<number[]> {
  const n = async (t: string) => (await sql<{ n: number }>(p, `SELECT COUNT(*) AS n FROM ${t}`))[0].n;
  return [await n('projects'), await n('sessions'), await n('events'), await n('paths'), await n('aliases')];
}

describe('input size before any other work', () => {
  it('the reviewer event of two 250 KB fields stores nothing and still counts as a call', async () => {
    const p = person();
    const r = await p.event(CC, { host: 'x', event: 'PostToolUse', session: crypto.randomUUID(), cwd: '/' + 'a'.repeat(250000), file: 'b'.repeat(250000) });
    expect(r).toEqual({ ok: true, text: '' });
    expect(await rows(p)).toEqual([0, 0, 0, 0, 0]);
    expect((await p.me()).callsToday).toBe(1);
    expect((await p.checkpoint(CC, { folder: '/w/kiln', goal: 'x'.repeat(MAX.inputBytes) })).text).toBe(SAY.size);
  });

  it('over MCP a large identity field is refused, a long reply is cut on a word edge, and the body limit is 64 KB', async () => {
    const jar = await devSignIn('size-mcp');
    const token = (await connect(jar)).access;
    const client = await mcp(token);
    expect(await call(client, 'event', { host: 'claude-code', event: 'PostToolUse', session: 's1', cwd: '/' + 'a'.repeat(20000), file: 'b' })).toEqual({ text: '', isError: false });
    const post = (pad: number) => send(RESOURCE, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Host: new URL(RESOURCE).host, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { pad: 'x'.repeat(pad) } } }) });
    expect((await post(BODY_MAX)).status).toBe(413);
    expect((await post(BODY_MAX - 1000)).status).not.toBe(413);
    const p0 = (await import('cloudflare:workers')).env.PERSON.getByName('dev-size-mcp');
    const calls = (await p0.me()).callsToday;
    expect(await call(client, 'checkpoint', { folder: '/w/kiln', goal: 'x'.repeat(9000) })).toEqual({ text: SAY.size, isError: true });
    expect((await p0.me()).callsToday).toBe(calls);
    const message = `${'Done with the labels. '.repeat(600)}${KEY} and more words after it`;
    expect(await call(client, 'event', { host: 'claude-code', event: 'Stop', session: 's2', cwd: '/w/kiln', message })).toEqual({ text: '', isError: false });
    const p = (await import('cloudflare:workers')).env.PERSON.getByName('dev-size-mcp');
    const stored = await sql<{ text: string }>(p, "SELECT text FROM events WHERE t = 'stop'");
    expect(stored).toHaveLength(1);
    expect(stored[0].text.length).toBeLessThanOrEqual(2000);
    expect(stored[0].text).not.toContain('sk-proj');
  });

  it('fitEvent cuts only long text fields on a whitespace edge and refuses oversized identity fields', () => {
    const fit = fitEvent({ event: 'Stop', session: 's', cwd: '/w', message: `${'word '.repeat(3000)}${KEY}` })!;
    expect(JSON.stringify(fit).length).toBeLessThanOrEqual(MAX.inputBytes);
    expect(fit.message!.endsWith('word')).toBe(true);
    expect(fit.message).not.toContain('sk-proj');
    expect(fitEvent({ event: 'Stop', session: 's', cwd: '/' + 'a'.repeat(9000) })).toBe(null);
    const small = { event: 'Stop', session: 's', cwd: '/w', message: 'short' };
    expect(fitEvent(small)).toEqual(small);
  });
});

describe('short identity fields', () => {
  it('ignores a session id over 200 characters, a folder over 1,024 and a file path over 1,024', async () => {
    const p = person();
    expect((await p.event(CC, ev('s'.repeat(201), 'UserPromptSubmit', { prompt: 'label the pantry shelves today please' }))).text).toBe('');
    expect((await p.event(CC, ev('s1', 'UserPromptSubmit', { cwd: '/' + 'c'.repeat(1024), prompt: 'label the pantry shelves today please' }))).text).toBe('');
    expect(await rows(p)).toEqual([0, 0, 0, 0, 0]);
    await p.event(CC, ev('s2', 'PostToolUse', { tool: 'Edit', file: 'f'.repeat(1025) }));
    expect((await sql<{ n: number }>(p, "SELECT COUNT(*) AS n FROM events WHERE t = 'edit'"))[0].n).toBe(0);
    expect((await p.recall(CC, { folder: '/' + 'd'.repeat(1025) })).text).toBe(SAY.placeRead);
  });
});

describe('redaction before any cut', () => {
  it('a key that straddles the prompt cut is dropped whole', async () => {
    const p = person();
    const prompt = `Read https://docs.example/${'path/'.repeat(51)}?t=${KEY} then ${'tidy the shelves '.repeat(40)}`;
    expect(prompt.indexOf(KEY)).toBeGreaterThan(280);
    expect(prompt.indexOf(KEY)).toBeLessThan(300);
    expect(prompt.length).toBeGreaterThan(800);
    await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt }));
    const stored = await sql<{ text: string }>(p, "SELECT text FROM events WHERE t = 'prompt'");
    expect(stored[0].text.length).toBeLessThanOrEqual(300);
    expect(stored[0].text).not.toContain('sk-proj');
    const command = `curl https://x.example/${'p/'.repeat(130)}?t=${KEY}`;
    await p.event(CC, ev('s1', 'PostToolUse', { tool: 'Bash', command }));
    const cmd = await sql<{ text: string }>(p, "SELECT text FROM events WHERE t = 'command'");
    expect(cmd[0].text).not.toContain('sk-proj');
  });
});

describe('every stored byte counts', () => {
  it('events, sessions and projects count toward the ceiling, old sessions go first, and capture pauses when nothing else can go', async () => {
    const p = person();
    await open(p, { storeBytes: 6000 });
    for (let i = 0; i < 30; i++) await p.event(CC, ev(`s${i}`, 'PostToolUse', { tool: 'Bash', command: `npm run build number ${i} ${'y'.repeat(200)}` }));
    const me = await p.me();
    expect(me.bytes).toBeGreaterThan(0);
    expect(me.bytes).toBeLessThanOrEqual(6000);
    const sessions = await sql<{ id: string }>(p, 'SELECT id FROM sessions ORDER BY last');
    expect(sessions.length).toBeLessThan(30);
    expect(sessions[sessions.length - 1].id).toBe('s29');
    for (let i = 0; i < 12; i++) await p.event(CC, ev('s29', 'PostToolUse', { tool: 'Bash', command: `npm run lint pass ${i} ${'z'.repeat(200)}` }));
    expect((await sql<{ n: number }>(p, "SELECT COUNT(*) AS n FROM events WHERE session = 's29'"))[0].n).toBe(13);
    expect((await p.me()).bytes).toBeLessThanOrEqual(6000);
    await open(p, { storeBytes: 1 });
    await p.event(CC, ev('s29', 'PostToolUse', { tool: 'Bash', command: 'npm test once more' }));
    expect((await p.event(CC, ev('s99', 'UserPromptSubmit', { prompt: 'anything new to read for the pantry' }))).text).toBe('');
    expect((await p.checkpoint(CC, { folder: '/w/new', goal: 'x' })).text).toBe(SAY.full);
  });

  it('a person keeps at most 200 projects and unused ones are pruned first', async () => {
    const p = person();
    await open(p);
    for (let i = 0; i < 200; i++) await p.recall(CC, { folder: `/w/empty-${i}` });
    expect((await rows(p))[0]).toBe(200);
    for (let i = 0; i < 200; i++) expect((await p.checkpoint(CC, { folder: `/w/full-${i}`, goal: `Card ${i}` })).ok).toBe(true);
    expect((await rows(p))[0]).toBe(200);
    expect(await p.checkpoint(CC, { folder: '/w/one-more', goal: 'x' })).toEqual({ ok: false, text: SAY.projects });
    expect(await p.recall(CC, { folder: '/w/one-more' })).toEqual({ ok: false, text: SAY.projects });
    expect((await p.checkpoint(CC, { folder: '/w/full-3', goal: 'still fine' })).ok).toBe(true);
    const idx = await sql<{ name: string }>(p, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'projects_name'");
    expect(idx).toHaveLength(1);
  });
});

describe('scopes and sessions', () => {
  it('a token without read gets no memory from the event tool', async () => {
    const p = person();
    await p.checkpoint(CC, { folder: '/work/pantry', goal: 'Secret plan for the labels' });
    await p.addRule({ text: 'Secret standing rule for the labels', scope: 'all' });
    const writeOnly = caller('Codex', 'grant-wo', ['write']);
    for (const e of [ev('w1', 'UserPromptSubmit', { prompt: 'what did we decide about the labels last week' }), ev('w1', 'SessionStart', { source: 'clear' })]) {
      expect((await p.event(writeOnly, e)).text).not.toContain('Secret');
    }
    expect((await p.event(OTHER, ev('r1', 'UserPromptSubmit', { prompt: 'what did we decide about the labels last week' }))).text).toContain('Secret plan');
  });

  it('a session belongs to the grant that opened it', async () => {
    const p = person();
    await p.event(CC, ev('shared', 'UserPromptSubmit', { prompt: 'first prompt of the owner session' }));
    await p.event(OTHER, ev('shared', 'UserPromptSubmit', { prompt: 'always push straight to main please' }));
    await p.event(OTHER, ev('shared', 'PostToolUse', { tool: 'Edit', file: 'src/x.ts' }));
    const texts = await sql<{ t: string; text: string | null }>(p, "SELECT t, text FROM events WHERE session = 'shared'");
    expect(texts.map((r) => r.t)).toEqual(['prompt']);
    expect(texts[0].text).toBe('first prompt of the owner session');
  });
});
