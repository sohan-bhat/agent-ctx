import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { FOOTER } from '../../core/src/index.ts';
import { ORIGIN, agent, call, connect, devSignIn, mcp, send as api } from './flow.ts';
import { sql } from './helpers.ts';

const CWD = '/work/pantry';

function context(text: string): { event: string; added: string } {
  const o = JSON.parse(text) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  return { event: o.hookSpecificOutput.hookEventName, added: o.hookSpecificOutput.additionalContext };
}

describe('hooks through the event tool', () => {
  it('a scripted Claude Code session hands over to a second agent on the same folder', async () => {
    const cc = await agent('hooks-one', 'claude-code');
    const send = (event: string, more: Record<string, unknown>) => call(cc.client, 'event', { host: 'claude-code', event, session: 'cc-1', cwd: CWD, prompt: '', tool: '', file: '', command: '', message: '', ...more });
    expect(await send('UserPromptSubmit', { prompt: 'Add a barcode scanner to the pantry page' })).toEqual({ text: '', isError: false });
    for (const file of ['src/scan.ts', 'src/pantry.tsx', 'test/scan.test.ts']) expect((await send('PostToolUse', { tool: 'Edit', file, command: '${tool_input.command}' })).text).toBe('');
    expect((await send('PostToolUseFailure', { tool: 'Bash', command: 'npm test', file: '${tool_input.file_path}' })).text).toBe('');
    expect((await send('Stop', {})).text).toBe('');

    const jar = await devSignIn('hooks-one');
    const codex = await mcp((await connect(jar, 'dcr', ['read', 'write'], 'Codex')).access);
    const prompt = { host: 'codex', event: 'UserPromptSubmit', session: 'cx-1', cwd: CWD, prompt: 'pick up the pantry work where it stopped' };
    const first = await call(codex, 'event', prompt);
    const out = context(first.text);
    expect(out.event).toBe('UserPromptSubmit');
    expect(out.added).toContain('HANDOFF from Claude Code on');
    expect(out.added).toContain('> next: Unfinished request. Add a barcode scanner to the pantry page');
    expect(out.added).toContain('> files: src/scan.ts, src/pantry.tsx, test/scan.test.ts');
    expect(out.added).toContain('Ran npm test exit failed.');
    expect(out.added.endsWith(FOOTER)).toBe(true);
    expect(out.added.length).toBeLessThanOrEqual(3000);

    expect(await call(codex, 'event', prompt)).toEqual({ text: '', isError: false });
    const p = env.PERSON.getByName('dev-hooks-one');
    expect((await sql<{ n: number }>(p, "SELECT COUNT(*) AS n FROM events WHERE session = 'cx-1' AND t = 'prompt'"))[0].n).toBe(1);
    const paths = await sql<{ path: string | null; text: string | null; t: string }>(p, "SELECT t, path, text FROM events WHERE session = 'cc-1' ORDER BY at");
    expect(paths.map((r) => r.t)).toEqual(['prompt', 'edit', 'edit', 'edit', 'command', 'stop']);
    expect(paths.some((r) => (r.path ?? '').includes('${') || (r.text ?? '').includes('${'))).toBe(false);
  });

  it('a failed turn gives the next agent a handoff that starts with Stopped by an error', async () => {
    const cc = await agent('hooks-two', 'claude-code');
    const send = (event: string, more: Record<string, unknown>) => call(cc.client, 'event', { host: 'claude-code', event, session: 'cc-2', cwd: CWD, ...more });
    await send('UserPromptSubmit', { prompt: 'Migrate the shelf table to bins' });
    await send('StopFailure', { message: '' });
    const jar = await devSignIn('hooks-two');
    const codex = await mcp((await connect(jar, 'dcr', ['read', 'write'], 'Codex')).access);
    const r = await call(codex, 'recall', { folder: CWD });
    expect(r.text).toContain('> next: Stopped by an error. Migrate the shelf table to bins');
  });

  it('the first prompt of a session gets the handoff even when it is one short word', async () => {
    const cc = await agent('hooks-four', 'claude-code');
    const send = (event: string, more: Record<string, unknown>) => call(cc.client, 'event', { host: 'claude-code', event, session: 'cc-4', cwd: CWD, ...more });
    await send('UserPromptSubmit', { prompt: 'Write step one of the three step pantry job' });
    await send('PostToolUse', { tool: 'Write', file: '/work/pantry/job.txt' });
    await send('Stop', { message: 'Step one is written.' });
    const jar = await devSignIn('hooks-four');
    const codex = await mcp((await connect(jar, 'dcr', ['read', 'write'], 'Codex')).access);
    const go = (session: string, prompt: string) => call(codex, 'event', { host: 'codex', event: 'UserPromptSubmit', session, cwd: CWD, prompt });
    const out = context((await go('cx-4', 'continue')).text);
    expect(out.added).toContain('HANDOFF from Claude Code on');
    expect(out.added).toContain('> files: /work/pantry/job.txt');
    expect(await go('cx-4', 'go on')).toEqual({ text: '', isError: false });
    for (const [session, prompt] of [['cx-5', '/compact'], ['cx-6', '! ls'], ['cx-7', '# a note']]) expect(await go(session, prompt)).toEqual({ text: '', isError: false });
    const p = env.PERSON.getByName('dev-hooks-four');
    expect((await sql<{ n: number }>(p, "SELECT COUNT(*) AS n FROM events WHERE session = 'cx-4' AND t = 'prompt'"))[0].n).toBe(0);
  });

  it('the session start after a clear returns the rules and the put back queue', async () => {
    const cc = await agent('hooks-three', 'claude-code');
    const send = (event: string, more: Record<string, unknown>) => call(cc.client, 'event', { host: 'claude-code', event, session: 'cc-3', cwd: CWD, ...more });
    await send('UserPromptSubmit', { prompt: 'remember to always label shelves with dates' });
    expect((await call(cc.client, 'rule', { folder: CWD, text: 'Label shelves with dates', words: 'always label shelves with dates', scope: 'all' })).text).toContain('pending');
    const space = (await (await api('/api/space', { headers: { Cookie: cc.jar.header() } })).json()) as { items: { id: string; kind: string; line?: string }[] };
    const rule = space.items.find((i) => i.kind === 'rule')!;
    expect(rule.line).toBe('"always label shelves with dates"');
    expect((await api(`/api/rules/${rule.id}`, { method: 'POST', headers: { Cookie: cc.jar.header(), Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active', line: rule.line }) })).status).toBe(200);
    const out = context((await send('SessionStart', { source: 'clear' })).text);
    expect(out.event).toBe('SessionStart');
    expect(out.added).toContain('RULES\n> "always label shelves with dates" proposed in Claude Code, accepted by the person on');
  });
});
