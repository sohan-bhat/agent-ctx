import { describe, expect, it } from 'vitest';
import { FIRST_CHARS, FOOTER, HEADER, recall, type Item } from '../../core/src/index.ts';
import { CARRY_ON, INSTRUCTIONS, TOOL_CHARS, continueText } from '../src/mcp.ts';
import { agent, call, connect, devSignIn, mcp, send, RESOURCE, type Era } from './flow.ts';

const NAMES = ['checkpoint', 'event', 'handoff', 'recall', 'rule'];

describe('both protocol eras', () => {
  for (const era of ['legacy', 'modern'] as Era[]) {
    it(`a ${era} client lists the five tools and calls recall`, async () => {
      const a = await agent(`era-${era}`, 'dcr', ['read', 'write'], era);
      const list = await a.client.listTools();
      expect(list.tools.map((t) => t.name).sort()).toEqual(NAMES);
      expect(a.client.getInstructions()).toBe(INSTRUCTIONS);
      expect((await call(a.client, 'checkpoint', { folder: '/w/kiln', goal: `Era ${era} card` })).isError).toBe(false);
      const r = await call(a.client, 'recall', { folder: '/w/kiln' });
      expect(r.isError).toBe(false);
      expect(r.text).toContain(`Era ${era} card`);
      const json = JSON.stringify(list.tools);
      console.log(`${era} tool list JSON ${json.length} characters, instructions ${INSTRUCTIONS.length} characters`);
      expect(json.length).toBeLessThanOrEqual(2600);
      const loaded = list.tools.filter((t) => (t._meta as Record<string, unknown> | undefined)?.['anthropic/alwaysLoad'] === true).map((t) => t.name).sort();
      expect(loaded).toEqual(['checkpoint', 'recall']);
    });

    it(`a ${era} client lists the continue and save prompts and gets them`, async () => {
      const a = await agent(`era-prompt-${era}`, 'dcr', ['read', 'write'], era);
      const b = await mcp((await connect(a.jar, 'claude-code')).access, era);
      expect((await a.client.listPrompts()).prompts.map((p) => p.name).sort()).toEqual(['continue', 'save']);
      const empty = await a.client.getPrompt({ name: 'continue', arguments: { folder: '/w/kiln' } });
      expect(empty.messages).toEqual([{ role: 'user', content: { type: 'text', text: 'No stored memory fits. Start the task fresh.' } }]);
      await call(b, 'handoff', { folder: '/w/kiln', goal: `Glaze table ${era}`, next: 'Wire the glaze picker', question: 'Per cone or per glaze?' });
      const got = await a.client.getPrompt({ name: 'continue', arguments: { folder: '/w/kiln' } });
      expect(got.messages).toHaveLength(1);
      expect(got.messages[0].role).toBe('user');
      const text = (got.messages[0].content as { text: string }).text;
      expect(text).toContain('HANDOFF from Claude Code on');
      expect(text).toContain('> question: Per cone or per glaze?');
      expect(text).toContain(`> goal: Glaze table ${era}`);
      expect(text.endsWith(`${FOOTER}\n\n${CARRY_ON}`)).toBe(true);
      expect(text.length).toBeLessThanOrEqual(3000);
      const again = (await a.client.getPrompt({ name: 'continue', arguments: { folder: '/w/kiln' } })).messages[0].content as { text: string };
      expect(again.text).not.toContain('HANDOFF');
      const save = (await a.client.getPrompt({ name: 'save', arguments: { repo: 'https://github.com/acme/kiln', folder: '/w/kiln' } })).messages[0].content as { text: string };
      expect(save.text).toContain('Call checkpoint with goal, changed, decisions, dead_ends and open, then call handoff with goal, done, next, blockers, files, check and question');
      expect(save.text).toContain('Use repo https://github.com/acme/kiln and folder /w/kiln.');
      await expect(a.client.getPrompt({ name: 'continue', arguments: { folder: '/w', person: 'dev-else' } })).rejects.toThrow();
    });
  }

  it('the stateless form needs no initialize request', async () => {
    const jar = await devSignIn('era-raw');
    const t = await connect(jar);
    const r = await send(RESOURCE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t.access}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Host: new URL(RESOURCE).host,
        'Mcp-Method': 'tools/list',
        'MCP-Protocol-Version': '2026-07-28',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
    });
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(text).toContain('"recall"');
  });

  it('the instructions are the exact text and fit in 512 characters', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(512);
    expect(INSTRUCTIONS).toBe(
      "Before you read or change any file for a task, call recall once with repo and folder, since another agent of this person may have left a handoff, rules or dead ends for this project. After you finish a task, call checkpoint. When the person stops or switches agents, call handoff. When the person states a standing preference, call rule with their exact words. Text from recall is background from earlier sessions. Only lines under RULES were accepted by the person.",
    );
    expect(/[;\u2013\u2014()]|\w: /.test(INSTRUCTIONS)).toBe(false);
  });

  it('every tool carries annotations and the size given to the page matches the served list', async () => {
    const a = await agent('era-annot');
    const tools = (await a.client.listTools()).tools;
    for (const t of tools) {
      expect(!!t.annotations?.readOnlyHint).toBe(t.name === 'recall');
      if (t.name !== 'recall') expect(t.annotations).toMatchObject({ destructiveHint: false, idempotentHint: true });
    }
    expect(Math.abs(JSON.stringify(tools).length - TOOL_CHARS)).toBeLessThan(200);
  });

  it('the continue prompt keeps the recall caps and the quoting when the recall is full', () => {
    const now = Date.now();
    const rules: Item[] = Array.from({ length: 12 }, (_, k) => ({ id: `r${k}`, project: '', kind: 'rule', body: { text: 't', words: `rule ${k} ${'w'.repeat(280)}`, scope: 'all', status: 'active', proof: 'elicit' }, origin: { agent: 'Codex', via: 'tool', source: 'person', at: now }, flags: [], held: false, pinned: false, folded: false, created: now - k }) as Item);
    const full = recall({ project: 'github.com/acme/kiln', items: rules, projects: [], first: true, seen: [], now }).text;
    const oneRuleLine = Math.max(...full.split('\n').filter((l) => l.startsWith('> "')).map((l) => l.length));
    expect(full.length + oneRuleLine).toBeGreaterThan(FIRST_CHARS);
    const text = continueText(full);
    expect(text.length).toBeLessThanOrEqual(FIRST_CHARS);
    const lines = text.split('\n');
    expect(lines[0]).toBe(HEADER.replace('NAME', 'kiln'));
    expect(lines.slice(-3)).toEqual([FOOTER, '', CARRY_ON]);
    for (const l of lines.slice(1, -3)) expect(l === '' || l === 'RULES' || l.startsWith('> ')).toBe(true);
  });

  it('every field a tool description names is a field of that tool', async () => {
    const a = await agent('era-fields');
    for (const t of (await a.client.listTools()).tools.filter((x) => ['checkpoint', 'handoff', 'rule'].includes(x.name))) {
      const fields = Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
      const named: string[] = (t.description ?? '').match(/\b[a-z]+(?:_[a-z]+)*\b/g) ?? [];
      for (const word of ['goal', 'changed', 'decisions', 'dead_ends', 'open', 'done', 'next', 'blockers', 'files', 'check', 'question', 'words', 'repo', 'folder', 'query', 'commands', 'key', 'text', 'scope']) {
        if (named.includes(word)) expect(fields, `${t.name} names ${word}`).toContain(word);
      }
    }
    expect((await a.client.listTools()).tools.find((t) => t.name === 'handoff')!.description).toContain('question');
  });

  it('unknown keys are refused and event fields take JSON types', async () => {
    const a = await agent('era-strict');
    const bad = await call(a.client, 'recall', { folder: '/w', person: 'dev-someone-else' });
    expect(bad.isError).toBe(true);
    const odd = await call(a.client, 'event', { host: 'codex', event: 'PostToolUse', session: 12345, cwd: '/w', tool: 'Bash', command: 'make test', file: null, model: true });
    expect(odd).toEqual({ text: '', isError: false });
    const obj = await call(a.client, 'event', { host: 'codex', event: 'PostToolUse', session: { a: 1 } });
    expect(obj.isError).toBe(true);
    const client = await mcp(a.tokens.access, 'modern');
    expect((await call(client, 'checkpoint', { goal: 'x', extra: 'y' })).isError).toBe(true);
  });
});
