import { describe, expect, it } from 'vitest';
import { formTarget, policy } from '../src/auth.ts';
import { ORIGIN, RESOURCE, devSignIn, pkce, register, send, type Jar } from './flow.ts';

const SELF = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'";

async function consentFor(jar: Jar, redirect: string): Promise<Response> {
  const clientId = await register('Csp Agent', redirect);
  const { challenge } = await pkce();
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: 'read write', state: 's', code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE });
  return send(`/authorize?${q}`, { headers: { Cookie: jar.header() }, redirect: 'manual' });
}

describe('form-action on the consent page', () => {
  it('adds only the origin or scheme of the matched redirect address', async () => {
    const jar = await devSignIn('csp-one');
    for (const [redirect, extra] of [
      ['http://127.0.0.1:4567/callback', 'http://127.0.0.1:4567'],
      ['http://localhost:6123/callback', 'http://localhost:6123'],
      ['https://app.example/oauth/cb?x=1', 'https://app.example'],
    ]) {
      const r = await consentFor(jar, redirect);
      const page = await r.text();
      expect(r.status, redirect).toBe(200);
      expect(page).toContain('name="handle"');
      expect(r.headers.get('Content-Security-Policy'), redirect).toBe(SELF.replace("form-action 'self'", `form-action 'self' ${extra}`));
      expect(page).toContain('<link rel="icon" href="data:,">');
    }
  });

  it('refuses to render the consent page for a redirect address with no usable origin', async () => {
    const jar = await devSignIn('csp-three');
    const r = await consentFor(jar, 'http://[::1]:4567/callback');
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain('name="handle"');
  });

  it('refuses to register a custom scheme, so the page never widens to one today', async () => {
    await expect(register('Csp Agent', 'cursor://anysphere.cursor-mcp/oauth/callback')).rejects.toThrow(/https, or http on a loopback host/);
  });

  it('builds the value only from a valid address, custom schemes as the scheme alone, and refuses the rest', () => {
    expect(formTarget('http://127.0.0.1:9/cb')).toBe('http://127.0.0.1:9');
    expect(formTarget('com.example.app:/callback')).toBe('com.example.app:');
    expect(formTarget('cursor://anysphere.cursor-mcp/oauth/callback')).toBe('cursor:');
    expect(formTarget("https://a.example/'; script-src *")).toBe('https://a.example');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://[::1]:5/cb', 'not an address', '']) expect(formTarget(bad), bad).toBe(null);
    expect(policy()).toBe(SELF);
  });

  it('keeps form-action self on every other page', async () => {
    const jar = await devSignIn('csp-two');
    const pages = [
      await send('/login', { redirect: 'manual' }),
      await send('/', { headers: { Cookie: jar.header() } }),
      await send('/', {}),
    ];
    for (const r of pages) {
      expect(r.status).toBe(200);
      expect(r.headers.get('Content-Security-Policy')).toBe(SELF);
      expect(await r.text()).toContain('<link rel="icon" href="data:,">');
    }
    const signedIn = await (await send('/', { headers: { Cookie: jar.header() } })).text();
    expect(signedIn).toContain('<form method="post" action="/logout">');
    expect(signedIn).not.toContain('href="/logout"');
    expect(ORIGIN.length).toBeGreaterThan(0);
  });

  it('an authorization error redirects only to an address the client registered', async () => {
    const jar = await devSignIn('csp-four');
    const clientId = await register('Csp Agent', 'http://127.0.0.1:4567/callback');
    const { challenge } = await pkce();
    const ask = (redirect: string, type = 'code') =>
      send(`/authorize?${new URLSearchParams({ response_type: type, client_id: clientId, redirect_uri: redirect, scope: 'read write', state: 's', code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE })}`, { headers: { Cookie: jar.header() }, redirect: 'manual' });
    const wrong = await ask('https://evil.example/cb', 'token');
    expect(wrong.status).toBe(400);
    expect(wrong.headers.get('Location')).toBe(null);
    const matched = await ask('http://127.0.0.1:4567/callback', 'token');
    expect(matched.status).toBe(302);
    expect(matched.headers.get('Location')).toMatch(/^http:\/\/127\.0\.0\.1:4567\/callback\?error=/);
  });
});
