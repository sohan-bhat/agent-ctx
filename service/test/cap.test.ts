import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { REGISTRATIONS_FULL, REGISTRATIONS_PER_DAY, registrationCap } from '../src/open.ts';
import { address, agent, call, send } from './flow.ts';

const register = () =>
  send('/oauth/register', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': address(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:4567/callback'], client_name: 'Cap probe', token_endpoint_auth_method: 'none' }),
  });

it('the service stores at most the daily cap of new registrations and metadata document clients still sign in', async () => {
  expect(registrationCap(env.REGISTRATIONS_PER_DAY)).toBe(REGISTRATIONS_PER_DAY);
  expect([registrationCap(undefined), registrationCap('x'), registrationCap('-1'), registrationCap('12')]).toEqual([150, 150, 150, 12]);
  const before = (await env.OAUTH_KV.list({ prefix: 'client:' })).keys.length;
  for (let i = 0; i < REGISTRATIONS_PER_DAY; i++) expect((await register()).status).toBe(201);
  const over = await register();
  expect(over.status).toBe(503);
  expect(await over.json()).toEqual({ error: 'temporarily_unavailable', error_description: REGISTRATIONS_FULL });
  expect((await env.OAUTH_KV.list({ prefix: 'client:' })).keys.length - before).toBe(REGISTRATIONS_PER_DAY);
  const day = new Date().toISOString().slice(0, 10);
  expect(await env.REGISTRY.getByName('registrations').count(day)).toBe(REGISTRATIONS_PER_DAY);
  const cimd = await agent('cap-cimd', 'claude-code');
  expect((await call(cimd.client, 'recall', {})).isError).toBe(false);
});
