import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import * as entry from '../src/index.ts';
import { CLIENT_TTL } from '../src/open.ts';
import { awayFromMinuteEdge } from './helpers.ts';
import { send } from './flow.ts';

function from(ip: string, more: Record<string, string> = {}): Record<string, string> {
  return { 'CF-Connecting-IP': ip, ...more };
}

const OPEN: ((ip: string) => Promise<Response>)[] = [
  (ip) => send('/oauth/register', { method: 'POST', headers: from(ip, { 'Content-Type': 'application/json' }), body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:4567/callback'], client_name: 'Flood', token_endpoint_auth_method: 'none' }) }),
  (ip) => send('/login', { headers: from(ip), redirect: 'manual' }),
  (ip) => send('/login/callback?state=a&code=b', { headers: from(ip), redirect: 'manual' }),
  (ip) => send('/authorize?client_id=nobody', { headers: from(ip), redirect: 'manual' }),
  (ip) => send('/oauth/token', { method: 'POST', headers: from(ip, { 'Content-Type': 'application/x-www-form-urlencoded' }), body: 'grant_type=refresh_token&refresh_token=a:b:c' }),
];

describe('open endpoints', () => {
  it('one address gets 20 calls a minute across the open routes, then 429, while others and the token routes go on', async () => {
    await awayFromMinuteEdge();
    const ip = '203.0.113.7';
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await OPEN[i % OPEN.length](ip)).status);
    expect(statuses.filter((s) => s === 429)).toEqual([]);
    for (const hit of OPEN) {
      const r = await hit(ip);
      expect(r.status).toBe(429);
      expect(r.headers.get('Retry-After')).toBe('60');
      expect(await r.text()).toBe('Too many requests from this address. Wait a minute and try again.');
    }
    for (const hit of OPEN) expect((await hit('203.0.113.8')).status).not.toBe(429);
    expect((await send('/api/me', { headers: from(ip) })).status).toBe(401);
    expect((await send('/mcp', { method: 'POST', headers: from(ip, { 'Content-Type': 'application/json' }), body: '{}' })).status).toBe(401);
    expect((await send('/.well-known/oauth-authorization-server', { headers: from(ip) })).status).toBe(200);
  });

  it('a registered client that is never used expires after 30 days', async () => {
    const r = await send('/oauth/register', { method: 'POST', headers: from('203.0.113.9', { 'Content-Type': 'application/json' }), body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:4567/callback'], client_name: 'Short lived', token_endpoint_auth_method: 'none' }) });
    const id = ((await r.json()) as { client_id: string }).client_id;
    const key = (await env.OAUTH_KV.list({ prefix: `client:${id}` })).keys[0];
    expect(CLIENT_TTL).toBe(30 * 86400);
    const left = (key.expiration ?? 0) - Date.now() / 1000;
    expect(left).toBeGreaterThan(CLIENT_TTL - 600);
    expect(left).toBeLessThanOrEqual(CLIENT_TTL + 5);
  });
  it('the entry file exports only the handler and the object class, since the runtime reads every other export as a handler', () => {
    expect(Object.keys(entry).sort()).toEqual(['Person', 'default']);
  });
});
