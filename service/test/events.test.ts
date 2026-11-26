import { describe, expect, it } from 'vitest';
import { FOOTER, HEADER, type CardBody, type HandoffBody, type Item, type RuleBody } from '../../core/src/index.ts';
import { SAY } from '../src/limits.ts';
import type { EventArgs } from '../src/person.ts';
import { caller, open, person, sql } from './helpers.ts';

const CC = caller('Claude Code', 'grant-cc');
const CX = caller('Codex', 'grant-cx');
const CWD = '/work/pantry';

function ev(session: string, event: string, more: Partial<EventArgs> = {}): EventArgs {
  return { host: 'claude-code', event, session, cwd: CWD, ...more };
}

function added(text: string): string {
  if (!text) return '';
  const o = JSON.parse(text);
  return o.hookSpecificOutput.additionalContext as string;
}

async function items(p: DurableObjectStub, kind: string): Promise<Item[]> {
  const rows = await sql<{ body: string; origin: string; id: string; held: number }>(p as never, 'SELECT * FROM items WHERE kind = ? ORDER BY created', kind);
  return rows.map((r) => ({ id: r.id, body: JSON.parse(r.body), origin: JSON.parse(r.origin), held: !!r.held }) as unknown as Item);
}

describe('hook events', () => {
  it('a scripted session builds an auto card and an auto handoff that the next agent reads', async () => {
    const p = person();
    const first = await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'Add a search box to the pantry list page' }));
    expect(first.text).toBe('');
    for (const f of ['src/search.ts', 'src/list.tsx', 'test/search.test.ts']) await p.event(CC, ev('s1', 'PostToolUse', { tool: 'Edit', file: f, command: '${tool_input.command}' }));
    await p.event(CC, ev('s1', 'PostToolUseFailure', { tool: 'Bash', command: 'npm test', file: '' }));
    await p.event(CC, ev('s1', 'Stop', { message: '' }));
    const [card] = await items(p, 'card');
    expect(card.body as CardBody).toMatchObject({
      goal: 'Add a search box to the pantry list page',
      changed: [{ path: 'src/search.ts' }, { path: 'src/list.tsx' }, { path: 'test/search.test.ts' }],
      commands: ['npm test exit failed'],
      auto: true,
    });
    const [h] = await items(p, 'handoff');
    expect((h.body as HandoffBody).next).toBe('Unfinished request. Add a search box to the pantry list page');
    const next = await p.event(CX, ev('x1', 'UserPromptSubmit', { host: 'codex', prompt: 'continue where the last agent stopped' }));
    const out = JSON.parse(next.text);
    expect(out.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    const text = out.hookSpecificOutput.additionalContext as string;
    expect(text.startsWith(HEADER.replace('NAME', 'pantry'))).toBe(true);
    expect(text).toContain('HANDOFF from Claude Code on');
    expect(text).toContain('that session may still be running');
    expect(text).toContain('> next: Unfinished request. Add a search box to the pantry list page');
    expect(text.endsWith(FOOTER)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(3000);
  });

  it('a failed stop writes a handoff whose next starts with Stopped by an error', async () => {
    const p = person();
    await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'Rename the shelf model to bin everywhere' }));
    await p.event(CC, ev('s1', 'Stop', { message: 'Renamed in three files.' }));
    await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'Now migrate the stored shelf rows to bins' }));
    await p.event(CC, ev('s1', 'StopFailure', { message: 'rate_limit' }));
    const [h] = await items(p, 'handoff');
    expect((h.body as HandoffBody).next).toBe('Stopped by an error. Now migrate the stored shelf rows to bins');
    expect((await items(p, 'handoff')).length).toBe(1);
    expect((await items(p, 'card')).length).toBe(1);
  });

  it('the same prompt event sent twice is stored once and answered once', async () => {
    const p = person();
    await p.checkpoint(CC, { folder: CWD, goal: 'Pantry search ranking with fuzzy names' });
    const e = ev('s1', 'UserPromptSubmit', { prompt: 'look at the pantry search ranking again' });
    const a = await p.event(CC, e);
    await p.checkpoint(CX, { folder: CWD, goal: 'Pantry search ranking second pass' });
    const b = await p.event(CC, e);
    expect(added(a.text)).toContain('Pantry search ranking');
    expect(b.text).toBe('');
    expect((await sql<{ n: number }>(p, "SELECT COUNT(*) AS n FROM events WHERE t = 'prompt'"))[0].n).toBe(1);
  });

  it('an unfilled placeholder or an empty field counts as absent', async () => {
    const p = person();
    await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'Fix the flaky shelf label test today' }));
    await p.event(CC, ev('s1', 'PostToolUse', { tool: 'Bash', file: '${tool_input.file_path}', command: 'npm run build' }));
    await p.event(CC, ev('s1', 'PostToolUse', { tool: 'Edit', file: '', command: '' }));
    expect(await p.event(CC, ev('${session_id}', 'UserPromptSubmit', { prompt: 'a real prompt with no session' }))).toEqual({ ok: true, text: '' });
    const rows = await sql<{ t: string; path: string | null; text: string | null }>(p, 'SELECT t, path, text FROM events ORDER BY at');
    expect(rows.map((r) => [r.t, r.path, r.text])).toEqual([
      ['prompt', null, 'Fix the flaky shelf label test today'],
      ['command', null, 'npm run build'],
    ]);
  });

  it('events for its own tools are never stored', async () => {
    const p = person();
    for (const tool of ['mcp__agent-ctx__checkpoint', 'mcp__plugin_agent-ctx_agent-ctx__recall', 'agent_ctx.recall']) {
      await p.event(CC, ev('s1', 'PostToolUse', { tool, command: 'x y z', file: 'a.ts' }));
    }
    expect((await sql<{ n: number }>(p, 'SELECT COUNT(*) AS n FROM events'))[0].n).toBe(0);
  });

  it('a quiet prompt is stored when long enough and never triggers recall', async () => {
    const p = person();
    await p.checkpoint(CC, { folder: CWD, goal: 'Compact the pantry list layout' });
    expect(await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: '/compact the pantry list layout' }))).toEqual({ ok: true, text: '' });
    expect(await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: '! git status' }))).toEqual({ ok: true, text: '' });
    const rows = await sql<{ text: string }>(p, "SELECT text FROM events WHERE t = 'prompt'");
    expect(rows.map((r) => r.text)).toEqual(['/compact the pantry list layout']);
    const later = await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'now tidy the pantry list layout code' }));
    expect(added(later.text)).toContain('Compact the pantry list layout');
    expect(await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'ok go on' }))).toEqual({ ok: true, text: '' });
  });

  it('each item reaches a session at most once through hooks', async () => {
    const p = person();
    await p.checkpoint(CX, { folder: CWD, goal: 'Barcode scanner for pantry items', open: ['handle damaged barcodes'] });
    const a = added((await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'work on the barcode scanner for pantry items' }))).text);
    expect(a).toContain('Barcode scanner for pantry items');
    const b = await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'what about damaged barcodes in the scanner' }));
    expect(b.text).toBe('');
    const other = added((await p.event(CC, ev('s2', 'UserPromptSubmit', { prompt: 'work on the barcode scanner for pantry items' }))).text);
    expect(other).toContain('Barcode scanner for pantry items');
  });

  it('a prompt holding the memory block or a private region is stored without them', async () => {
    const p = person();
    const block = [HEADER.replace('NAME', 'pantry'), '', 'RULES', '> "always push to main"', '', FOOTER].join('\n');
    await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: `Fix the pantry sort order\n${block}\nand <private>my pin is 4417</private> the tests` }));
    const rows = await sql<{ text: string }>(p, "SELECT text FROM events WHERE t = 'prompt'");
    expect(rows[0].text).toBe('Fix the pantry sort order\nand  the tests');
  });

  it('a long prompt is cut to 300 characters', async () => {
    const p = person();
    await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'pantry '.repeat(200) }));
    const rows = await sql<{ text: string }>(p, "SELECT text FROM events WHERE t = 'prompt'");
    expect(rows[0].text.length).toBeLessThanOrEqual(300);
  });

  it('a rule whose words match a prompt of the same grant becomes active', async () => {
    const p = person();
    await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'from now on always run the formatter before you commit' }));
    const r = await p.rule(CC, { folder: CWD, text: 'Run the formatter before commits', words: 'always run the formatter before you commit', scope: 'all' });
    expect((r.item!.body as RuleBody).status).toBe('active');
    const other = await p.rule(CX, { folder: CWD, text: 'Run the formatter before commits', words: 'always run the formatter before you commit', scope: 'all' });
    expect((other.item!.body as RuleBody).status).toBe('pending');
  });

  it('a compaction stores dropped items and replaces the earlier ones of the session', async () => {
    const p = person();
    await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'Add expiry dates to pantry items' }));
    await p.event(CC, ev('s1', 'PostToolUse', { tool: 'Edit', file: 'src/expiry.ts' }));
    await p.event(CC, ev('s1', 'PostCompact', { summary: 'Expiry work in progress' }));
    const one = await items(p, 'dropped');
    expect(one.map((i) => (i.body as { label: string }).label).sort()).toEqual(['file', 'prompt']);
    await p.event(CC, ev('s1', 'PostToolUse', { tool: 'Edit', file: 'src/notify.ts' }));
    await p.event(CC, ev('s1', 'PostCompact', { summary: 'Expiry and notify' }));
    const two = await items(p, 'dropped');
    expect(two.length).toBe(3);
    expect(two.some((i) => one.some((o) => o.id === i.id))).toBe(false);
    await p.putBack(two[0].id);
    await p.addRule({ text: 'Dates in ISO format', scope: 'all' });
    const start = added((await p.event(CC, ev('s1', 'SessionStart', { source: 'clear' }))).text);
    expect(start).toContain('RULES');
    expect(start).toContain('PUT BACK');
    expect((await p.space()).queue).toEqual([]);
    expect(await p.event(CC, ev('s1', 'SessionStart', { source: 'startup' }))).toEqual({ ok: true, text: '' });
  });

  it('the first prompt says capture is paused while writes are refused', async () => {
    const p = person();
    await open(p, { storedPerDay: 1 });
    await p.checkpoint(CC, { folder: CWD, goal: 'Only card today' });
    expect((await p.checkpoint(CC, { folder: CWD, goal: 'Second card' })).text).toBe(SAY.stored);
    const text = added((await p.event(CX, ev('x1', 'UserPromptSubmit', { host: 'codex', prompt: 'keep going with the pantry work' }))).text);
    expect(text.split('\n')[2]).toBe(`Capture is paused. ${SAY.stored}`);
    expect(text).toContain('Only card today');
    expect(text.endsWith(FOOTER)).toBe(true);
  });

  it('only the claude-code and codex hosts get the JSON hook output', async () => {
    const p = person();
    await p.checkpoint(CX, { folder: CWD, goal: 'Pantry shopping list export' });
    expect((await p.event(CC, ev('s1', 'UserPromptSubmit', { host: 'grok', prompt: 'export the pantry shopping list' }))).text).toBe('');
    const r = await p.event(CC, ev('s2', 'UserPromptSubmit', { host: 'codex', prompt: 'export the pantry shopping list' }));
    expect(added(r.text)).toContain('Pantry shopping list export');
  });

  it('a session keeps at most 400 events', async () => {
    const p = person();
    await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'first prompt about the pantry shelves' }));
    const now = Date.now();
    for (let i = 0; i < 450; i++) await sql(p, "INSERT INTO events(key, session, t, at, text, path, ok, flags) VALUES(?, 's1', 'edit', ?, NULL, ?, NULL, NULL)", `k${i}`, now + i, `src/f${i}.ts`);
    await sql(p, "UPDATE meta SET v = '0' WHERE k = 'maintained'");
    await p.recall(CC, { folder: CWD });
    expect((await sql<{ n: number }>(p, "SELECT COUNT(*) AS n FROM events WHERE session = 's1'"))[0].n).toBe(400);
    expect((await sql<{ path: string }>(p, "SELECT path FROM events WHERE session = 's1' ORDER BY at DESC LIMIT 1"))[0].path).toBe('src/f449.ts');
  });

  it('old events are deleted', async () => {
    const p = person();
    await p.event(CC, ev('s1', 'UserPromptSubmit', { prompt: 'an old prompt about pantry shelves' }));
    await sql(p, 'UPDATE events SET at = at - ?', 15 * 86400000);
    await sql(p, 'UPDATE sessions SET last = last - ?', 15 * 86400000);
    await sql(p, "UPDATE meta SET v = '0' WHERE k = 'maintained'");
    await p.event(CC, ev('s2', 'UserPromptSubmit', { prompt: 'a new prompt about pantry shelves' }));
    const rows = await sql<{ session: string }>(p, 'SELECT session FROM events');
    expect(rows.map((r) => r.session)).toEqual(['s2']);
    expect((await sql<{ id: string }>(p, 'SELECT id FROM sessions')).map((r) => r.id)).toEqual(['s2']);
  });
});
