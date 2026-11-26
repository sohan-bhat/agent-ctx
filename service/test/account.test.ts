import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { Item } from '../../core/src/index.ts';
import type { Person } from '../src/person.ts';
import { call, connect, devSignIn, mcp, ORIGIN, send } from './helpers.ts';

describe('export and delete', () => {
  it('the export zip holds every item in the open layout', async () => {
    const jar = await devSignIn('export-one');
    const a = await mcp((await connect(jar, 'dcr', ['read', 'write'], 'Codex')).access);
    await call(a, 'checkpoint', { repo: 'https://github.com/acme/kiln', folder: '/w/kiln', goal: 'Kiln ramp' });
    await call(a, 'handoff', { repo: 'https://github.com/acme/kiln', folder: '/w/kiln', goal: 'Kiln goal', next: 'Kiln next', question: 'Per glaze?' });
    await call(a, 'checkpoint', { folder: '/w/loom', goal: 'Loom heddles' });
    await send('/api/rules', { method: 'POST', headers: { Cookie: jar.header(), Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Keep notes short', scope: 'all' }) });
    const r = await send('/api/export', { headers: { Cookie: jar.header() } });
    expect(r.headers.get('Content-Type')).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      'agent-ctx/README.md',
      'agent-ctx/agents.jsonl',
      'agent-ctx/projects/kiln/handoff.md',
      'agent-ctx/projects/kiln/items.jsonl',
      'agent-ctx/projects/loom/items.jsonl',
      'agent-ctx/rules.jsonl',
    ]);
    expect(strFromU8(files['agent-ctx/projects/kiln/handoff.md'])).toContain('## Question\n\nPer glaze?');
    const space = (await (await send('/api/space', { headers: { Cookie: jar.header() } })).json()) as { items: Item[] };
    const ids = Object.entries(files)
      .filter(([k]) => k.endsWith('.jsonl') && !k.endsWith('agents.jsonl'))
      .flatMap(([, v]) => strFromU8(v).split('\n').filter(Boolean).map((l) => (JSON.parse(l) as Item).id));
    expect(ids.sort()).toEqual(space.items.map((i) => i.id).sort());
    expect(strFromU8(files['agent-ctx/agents.jsonl'])).toContain('"label":"unverified Codex"');
  });

  it('after the account is deleted the object holds nothing, every grant fails and a fresh sign in recalls nothing', async () => {
    const jar = await devSignIn('delete-one');
    const t1 = await connect(jar, 'dcr', ['read', 'write'], 'Codex');
    const t2 = await connect(jar, 'claude-code');
    const a = await mcp(t1.access);
    const b = await mcp(t2.access);
    await call(a, 'checkpoint', { folder: '/w/kiln', goal: 'Gone soon' });
    await call(b, 'event', { host: 'claude-code', event: 'UserPromptSubmit', session: 's-1', cwd: '/w/kiln', prompt: 'a prompt that will be deleted' });
    const before = await env.OAUTH_KV.list({ prefix: 'grant:dev-delete-one:' });
    expect(before.keys.length).toBe(2);
    const copied = jar.header();
    let grantsAtWipe = -1;
    const proto = await runInDurableObject(env.PERSON.getByName('dev-delete-one'), (x: Person) => Object.getPrototypeOf(x) as Person);
    const wipe = proto.wipe;
    proto.wipe = async function (this: Person) {
      grantsAtWipe = (await env.OAUTH_KV.list({ prefix: 'grant:dev-delete-one:' })).keys.length;
      return wipe.call(this);
    };
    let del: Response;
    try {
      del = await send('/api/account', { method: 'DELETE', headers: { Cookie: jar.header(), Origin: ORIGIN } });
    } finally {
      proto.wipe = wipe;
    }
    expect(grantsAtWipe).toBe(0);
    expect((await send('/api/me', { headers: { Cookie: copied } })).status).toBe(401);
    expect(del.status).toBe(200);
    expect(del.headers.getSetCookie().some((c) => c.startsWith('__Host-session=') && /max-age=0/i.test(c))).toBe(true);
    expect(await env.PERSON.getByName('dev-delete-one').rowCount()).toBe(1);
    expect((await env.OAUTH_KV.list({ prefix: 'grant:dev-delete-one:' })).keys.length).toBe(0);
    expect((await env.OAUTH_KV.list({ prefix: 'token:dev-delete-one:' })).keys.length).toBe(0);
    for (const t of [t1, t2]) {
      const r = await send('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${t.access}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Host: 'localhost:8790' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      expect(r.status).toBe(401);
    }
    const fresh = await devSignIn('delete-one');
    const c = await mcp((await connect(fresh, 'dcr')).access);
    expect((await call(c, 'recall', { folder: '/w/kiln' })).text).toBe('No stored memory fits.');
  });
});
