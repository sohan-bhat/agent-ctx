import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import * as entry from '../src/index.ts';
import { CLIENT_TTL, SLOW_DOWN } from '../src/limits.ts';
import { awayFromMinuteEdge, send } from './helpers.ts';

function from(ip: string, more: Record<string, string> = {}): Record<string, string> {
  return { 'CF-Connecting-IP': ip, ...more };
}

const register = (ip: string) =>
  send('/oauth/register', { method: 'POST', headers: from(ip, { 'Content-Type': 'application/json' }), body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:4567/callback'], client_name: 'Flood', token_endpoint_auth_method: 'none' }) });
const token = (ip: string) => send('/oauth/token', { method: 'POST', headers: from(ip, { 'Content-Type': 'application/x-www-form-urlencoded' }), body: 'grant_type=refresh_token&refresh_token=a:b:c' });
const SIGN_IN: ((ip: string) => Promise<Response>)[] = [
  (ip) => send('/login', { headers: from(ip), redirect: 'manual' }),
  (ip) => send('/login/callback?state=a&code=b', { headers: from(ip), redirect: 'manual' }),
  (ip) => send('/authorize?client_id=nobody', { headers: from(ip), redirect: 'manual' }),
];
const signIn = (ip: string, i: number) => SIGN_IN[i % SIGN_IN.length](ip);

async function refused(r: Promise<Response>): Promise<void> {
  const res = await r;
  expect(res.status).toBe(429);
  expect(res.headers.get('Retry-After')).toBe('60');
  expect(await res.text()).toBe(SLOW_DOWN);
}

async function statuses(n: number, fn: (i: number) => Promise<Response>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await fn(i)).status);
  return out;
}

describe('open endpoints', () => {
  it('registration allows 10 calls a minute per address and leaves the other classes alone', async () => {
    await awayFromMinuteEdge();
    const ip = '203.0.113.10';
    expect((await statuses(10, () => register(ip))).filter((s) => s === 429)).toEqual([]);
    await refused(register(ip));
    expect((await register('203.0.113.11')).status).toBe(201);
    expect((await token(ip)).status).not.toBe(429);
    expect((await signIn(ip, 0)).status).not.toBe(429);
  });

  it('the sign in routes allow 60 calls a minute per address', async () => {
    await awayFromMinuteEdge();
    const ip = '203.0.113.20';
    expect((await statuses(60, (i) => signIn(ip, i))).filter((s) => s === 429)).toEqual([]);
    for (let i = 0; i < SIGN_IN.length; i++) await refused(signIn(ip, i));
    expect((await signIn('203.0.113.21', 0)).status).not.toBe(429);
    expect((await register(ip)).status).toBe(201);
    expect((await token(ip)).status).not.toBe(429);
  });

  it('the token route allows 120 calls a minute per address', async () => {
    await awayFromMinuteEdge();
    const ip = '203.0.113.30';
    expect((await statuses(120, () => token(ip))).filter((s) => s === 429)).toEqual([]);
    await refused(token(ip));
    expect((await token('203.0.113.31')).status).not.toBe(429);
    expect((await signIn(ip, 0)).status).not.toBe(429);
  });

  it('the page API, the MCP endpoint and discovery are not limited per address', async () => {
    const ip = '203.0.113.40';
    for (let i = 0; i < 130; i++) expect((await send('/.well-known/oauth-authorization-server', { headers: from(ip) })).status).toBe(200);
    expect((await send('/api/me', { headers: from(ip) })).status).toBe(401);
    expect((await send('/mcp', { method: 'POST', headers: from(ip, { 'Content-Type': 'application/json' }), body: '{}' })).status).toBe(401);
  });

  it('a registered client that is never used expires after 30 days', async () => {
    const r = await register('203.0.113.9');
    const id = ((await r.json()) as { client_id: string }).client_id;
    const key = (await env.OAUTH_KV.list({ prefix: `client:${id}` })).keys[0];
    expect(CLIENT_TTL).toBe(30 * 86400);
    const left = (key.expiration ?? 0) - Date.now() / 1000;
    expect(left).toBeGreaterThan(CLIENT_TTL - 600);
    expect(left).toBeLessThanOrEqual(CLIENT_TTL + 5);
  });

  it('the entry file exports only the handler and the object classes, since the runtime reads every other export as a handler', () => {
    expect(Object.keys(entry).sort()).toEqual(['Person', 'Registry', 'default']);
  });
});
