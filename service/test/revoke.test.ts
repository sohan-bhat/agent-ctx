import { env } from 'cloudflare:workers';
import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.ts';
import type { Person } from '../src/person.ts';
import { REGISTRATIONS_PER_DAY, addressKey } from '../src/limits.ts';
import { CIMD_URL } from './outbound.ts';
import { ORIGIN, RESOURCE, call, connect, devSignIn, fromSomewhere, mcp, pkce, send } from './flow.ts';
import { caller, open, person } from './helpers.ts';

const listTools = (token: string) =>
  send('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Host: new URL(RESOURCE).host }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });

describe('disconnect one agent', () => {
  it('DELETE /api/agents/ID revokes every grant of that agent and removes its row, and other agents keep working', async () => {
    const jar = await devSignIn('revoke-one');
    const a1 = await connect(jar, 'dcr', ['read', 'write'], 'Pantry Bot');
    const a2 = await connect(jar, 'dcr', ['read', 'write'], 'Pantry Bot');
    const b = await connect(jar, 'claude-code');
    for (const t of [a1, a2, b]) await call(await mcp(t.access), 'recall', { folder: '/w/pantry' });
    const label = 'unverified Pantry Bot';
    const headers = { Cookie: jar.header(), Origin: ORIGIN };
    expect((await send(`/api/agents/${encodeURIComponent(label)}`, { method: 'DELETE', headers: { Cookie: jar.header() } })).status).toBe(403);
    expect((await send(`/api/agents/${encodeURIComponent(label)}`, { method: 'DELETE', headers })).status).toBe(204);
    for (const t of [a1, a2]) expect((await listTools(t.access)).status).toBe(401);
    expect((await listTools(b.access)).status).toBe(200);
    const space = (await (await send('/api/space', { headers: { Cookie: jar.header() } })).json()) as { agents: { id: string }[] };
    expect(space.agents.map((x) => x.id)).toEqual(['Claude Code']);
    expect((await env.OAUTH_KV.list({ prefix: 'grant:dev-revoke-one:' })).keys).toHaveLength(1);
    expect((await send(`/api/agents/${encodeURIComponent(label)}`, { method: 'DELETE', headers })).status).toBe(404);
  });

  it('the agents cap counts only agents seen in the last 30 days', async () => {
    const p = person();
    await open(p, { agents: 2 });
    await p.recall(caller('One', 'g1'), { folder: '/w' });
    await runInDurableObject(p, (x: Person) => {
      x.store.q('UPDATE agents SET last = ? WHERE id = ?', Date.now() - 31 * 86400000, 'One');
    });
    await p.recall(caller('Two', 'g2'), { folder: '/w' });
    expect((await p.recall(caller('Three', 'g3'), { folder: '/w' })).ok).toBe(true);
    expect((await p.recall(caller('Four', 'g4'), { folder: '/w' })).text).toBe('This account already has 20 connected agents.');
  });
});

describe('open registration', () => {
  it('keys IPv6 addresses on their /64 and leaves IPv4 alone', () => {
    expect(addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:0db8:0001:0002::1')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:DB8:1:2:ffff::')).toBe('2001:db8:1:2::/64');
    expect(addressKey('::ffff:192.0.2.1')).toBe('0:0:0:0::/64');
    expect(addressKey('203.0.113.9')).toBe('203.0.113.9');
    expect(addressKey(null)).toBe('unknown');
    expect(addressKey('1:2:3')).toBe('1:2:3');
  });

  it('one /64 shares one registration budget', async () => {
    const reg = (ip: string) =>
      send('/oauth/register', { method: 'POST', headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:4567/callback'], client_name: 'Flood', token_endpoint_auth_method: 'none' }) });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await reg(`2001:db8:77:1:${i.toString(16)}::1`)).status);
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    expect((await reg('2001:db8:77:2::1')).status).toBe(201);
  });

  it('the daily cap of new registrations defaults to 150', () => {
    expect(REGISTRATIONS_PER_DAY).toBe(150);
  });
});

describe('sign in checks', () => {
  it('a dev person cookie is refused when DEV_LOGIN is not 1', async () => {
    const jar = await devSignIn('dev-cookie');
    for (const [value, status] of [['1', 200], [undefined, 401], ['0', 401]] as const) {
      const ctx = createExecutionContext();
      const vars = { ...env, DEV_LOGIN: value } as Env;
      const r = await worker.fetch(fromSomewhere(new Request(`${ORIGIN}/api/me`, { headers: { Cookie: jar.header() } })) as Request<unknown, IncomingRequestCfProperties>, vars, ctx);
      await waitOnExecutionContext(ctx);
      expect(r.status, String(value)).toBe(status);
    }
  });

  it('a metadata document is not fetched or stored before the person signs in', async () => {
    const stored = async () => (await env.OAUTH_KV.list({ prefix: 'cimd:' })).keys.length;
    for (const k of (await env.OAUTH_KV.list({ prefix: 'cimd:' })).keys) await env.OAUTH_KV.delete(k.name);
    const { challenge } = await pkce();
    const q = new URLSearchParams({ response_type: 'code', client_id: CIMD_URL, redirect_uri: 'http://127.0.0.1/callback', scope: 'read write', state: 's', code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE });
    const r = await send(`/authorize?${q}`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toMatch(/^\/login\?return=/);
    expect(await stored()).toBe(0);
    const jar = await devSignIn('cimd-after');
    expect((await send(`/authorize?${q}`, { headers: { Cookie: jar.header() }, redirect: 'manual' })).status).toBe(200);
    expect(await stored()).toBe(1);
  });
});
