import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { FOOTER, newItem, type CardBody, type HandoffBody } from '../../core/src/index.ts';
import { SAY } from '../src/limits.ts';
import { NOT_STATED, type Person } from '../src/person.ts';
import { CARRY_ON } from '../src/mcp.ts';
import { KILN, caller, person, sql } from './helpers.ts';
import { agent, call } from './flow.ts';

const A = caller('Codex', 'grant-a');
const B = caller('Claude Code', 'grant-b');
const NOWHERE = [{}, { repo: '', folder: '' }, { repo: '   ' }, { folder: '/' }, { repo: 'not a remote' }];

async function unknownRows(p: DurableObjectStub<Person>): Promise<number> {
  return (await sql<{ n: number }>(p, "SELECT COUNT(*) AS n FROM projects WHERE key = 'folder:unknown'"))[0].n;
}

describe('a call that names no project', () => {
  it('a write with neither repo nor folder is refused and creates no project, except a rule of scope all', async () => {
    const p = person();
    for (const w of NOWHERE) {
      expect(await p.checkpoint(A, { ...w, goal: 'Lost card' })).toEqual({ ok: false, text: SAY.place });
      expect(await p.handoff(A, { ...w, goal: 'Lost handoff', next: 'n' })).toEqual({ ok: false, text: SAY.place });
      expect(await p.rule(A, { ...w, text: 't', words: 'some words that are long', scope: 'project' })).toEqual({ ok: false, text: SAY.where });
    }
    expect((await p.rule(A, { text: 'Short subjects', words: 'keep commit subjects short', scope: 'all' })).ok).toBe(true);
    expect((await p.space()).projects).toEqual([]);
    expect(await unknownRows(p)).toBe(0);
  });

  it('a read with neither returns only the active rules of scope all on a first recall, then one line asking for repo or folder', async () => {
    const p = person();
    await p.checkpoint(A, { ...KILN, goal: 'Kiln card that must not leak' });
    await p.handoff(A, { ...KILN, goal: 'Kiln handoff', next: 'Kiln next that must not leak' });
    await p.rule(A, { ...KILN, text: 'Kiln only', words: 'kiln rule words here', scope: 'project' });
    expect(await p.recall(B, {})).toEqual({ ok: true, text: SAY.placeRead, noProject: true });
    await p.addRule({ text: 'Write dates in ISO form', scope: 'all' });
    for (const w of NOWHERE) {
      const first = await p.recall(B, w);
      expect(first.noProject).toBe(true);
      expect(first.text).toContain('RULES\n> "Write dates in ISO form" added by the person on');
      expect(first.text.endsWith(`${FOOTER}\n\n${SAY.placeRead}`)).toBe(true);
      expect(first.text).not.toMatch(/Kiln|HANDOFF|EARLIER|PUT BACK/);
      expect(await p.recall(B, { ...w, query: 'kiln card leak' })).toEqual({ ok: true, text: SAY.placeRead, noProject: true });
    }
    expect(await unknownRows(p)).toBe(0);
  });

  it('a store that already holds a folder:unknown project never serves its items to a call that names no project', async () => {
    const p = person();
    await runInDurableObject(p, (x: Person) => {
      x.store.q("INSERT INTO projects(key, name, created) VALUES('folder:unknown', 'unknown', 1)");
      x.store.put(newItem('card', 'folder:unknown', { goal: 'Stranded card about payroll.ts' }, { agent: 'Codex', via: 'tool', source: 'agent', at: Date.now() }));
      x.store.put(newItem('handoff', 'folder:unknown', { goal: 'Stranded handoff', next: 'Edit payroll.ts' }, { agent: 'Codex', session: 'g-other', via: 'tool', source: 'agent', at: Date.now() }));
      x.store.put(newItem('dropped', 'folder:unknown', { label: 'prompt', text: 'stranded payroll prompt', size: 20 }, { agent: 'Codex', via: 'hook', source: 'person', at: Date.now() }));
    });
    for (const w of [{}, { repo: '' }]) {
      for (const r of [await p.recall(B, w), await p.recall(B, { ...w, query: 'payroll stranded' }), await p.recall(B, { ...w, dropped: true })]) {
        expect(r.text).not.toMatch(/payroll|Stranded|stranded/);
      }
    }
    expect((await p.event(B, { host: 'claude-code', event: 'UserPromptSubmit', session: 's-1', cwd: '', prompt: 'look at the payroll file again' })).text).toBe('');
    expect((await sql<{ n: number }>(p, 'SELECT COUNT(*) AS n FROM sessions'))[0].n).toBe(0);
  });

  it('a hook event with an empty or nameless cwd is stored nowhere', async () => {
    const p = person();
    for (const cwd of ['', '${cwd}', '/']) {
      for (const event of ['UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionStart']) {
        const r = await p.event(B, { host: 'claude-code', event, session: `s-${cwd.length}`, cwd, prompt: 'a prompt that is long enough to count', file: 'src/a.ts', message: 'done', source: 'clear' });
        expect(r.text).toBe('');
      }
    }
    expect((await sql<{ n: number }>(p, 'SELECT COUNT(*) AS n FROM events'))[0].n).toBe(0);
    expect((await sql<{ n: number }>(p, 'SELECT COUNT(*) AS n FROM sessions'))[0].n).toBe(0);
    expect((await p.space()).projects).toEqual([]);
    await p.event(B, { host: 'claude-code', event: 'PostToolUse', session: 'known', cwd: KILN.folder, tool: 'Edit', file: 'src/a.ts' });
    await p.event(B, { host: 'claude-code', event: 'PostToolUse', session: 'known', cwd: '', tool: 'Edit', file: 'src/b.ts' });
    expect((await sql<{ path: string }>(p, "SELECT path FROM events WHERE session = 'known'")).map((r) => r.path)).toEqual(['src/a.ts']);
  });

  it('the continue prompt with no project returns the rules and the ask line, never another project', async () => {
    const a = await agent('place-prompt');
    await call(a.client, 'checkpoint', { folder: '/w/payroll', goal: 'Payroll card that must not leak' });
    const bare = await a.client.getPrompt({ name: 'continue', arguments: {} });
    const text = (bare.messages[0].content as { text: string }).text;
    expect(text).toBe(SAY.placeRead);
    expect(text).not.toContain(CARRY_ON);
    expect((await call(a.client, 'recall', {})).text).toBe(SAY.placeRead);
    expect(await call(a.client, 'checkpoint', { goal: 'nowhere' })).toEqual({ text: SAY.place, isError: true });
    const stub = env.PERSON.getByName('dev-place-prompt');
    expect(await unknownRows(stub)).toBe(0);
  });
});

describe('optional goal and next', () => {
  it('a handoff without goal or next takes the goal from the newest item of the same agent and states the rest plainly', async () => {
    const p = person();
    await p.checkpoint(A, { ...KILN, goal: 'Older goal of Codex' });
    await p.checkpoint(B, { ...KILN, goal: 'Goal of another agent' });
    await p.checkpoint(A, { ...KILN, goal: 'Newest goal of Codex' });
    await p.checkpoint(B, { ...KILN, goal: 'Newest goal of the other agent' });
    const h = await p.handoff(A, { ...KILN, question: 'Glaze per cone?' });
    expect(h.ok).toBe(true);
    expect(h.item!.body as HandoffBody).toMatchObject({ goal: 'Newest goal of Codex', next: NOT_STATED, question: 'Glaze per cone?' });
    const fresh = person();
    const bare = await fresh.handoff(A, { ...KILN });
    expect(bare.item!.body as HandoffBody).toMatchObject({ goal: NOT_STATED, next: NOT_STATED });
    const kept = await fresh.handoff(A, { ...KILN, goal: 'Given goal', next: 'Given next' });
    expect(kept.item!.body as HandoffBody).toMatchObject({ goal: 'Given goal', next: 'Given next' });
  });

  it('a checkpoint without goal takes the first line of the newest prompt of the caller session, else Not stated', async () => {
    const p = person();
    await p.event(A, { host: 'codex', event: 'UserPromptSubmit', session: 'cx-1', cwd: KILN.folder, prompt: 'Add a cone chart to the glaze page\nwith the usual colours please' });
    await p.checkpoint(A, { ...KILN, goal: 'link the folder to the repo' });
    const c = await p.checkpoint(A, { ...KILN, changed: ['src/cone.ts'] });
    expect((c.item!.body as CardBody).goal).toBe('Add a cone chart to the glaze page');
    const other = await p.checkpoint(B, { ...KILN, changed: ['src/other.ts'] });
    expect((other.item!.body as CardBody).goal).toBe(NOT_STATED);
  });

  it('agents may leave out goal and next through MCP without a retry', async () => {
    const a = await agent('place-optional', 'dcr', ['read', 'write'], 'modern');
    expect(await call(a.client, 'handoff', { folder: '/w/kiln', question: 'Which glaze first?' })).toEqual({ text: 'Handoff saved for the next agent.', isError: false });
    expect((await call(a.client, 'checkpoint', { folder: '/w/kiln', open: ['test the glaze'] })).isError).toBe(false);
  });
});
