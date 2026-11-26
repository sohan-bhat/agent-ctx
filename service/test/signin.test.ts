import { env } from 'cloudflare:workers';
import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import worker from '../src/index.ts';
import { addressKey, REGISTRATIONS_PER_DAY, SAY } from '../src/limits.ts';
import { CIMD_URL } from './outbound.ts';
import { agent, approve, call, caller, connect, consent, devSignIn, type Fetch, fromSomewhere, Jar, mcp, open, ORIGIN, person, pkce, refresh, register, RESOURCE, send } from './helpers.ts';
import { CLAUDE_CODE_CLIENT, CLAUDE_REDIRECT, formTarget, labelFor, OTHER, policy, returnPath } from '../src/auth.ts';
import type { Person } from '../src/person.ts';

{
  function withEnv(more: Record<string, unknown>): Fetch {
    return async (input, init) => {
      const req = fromSomewhere(typeof input === 'string' ? new Request(input.startsWith('http') ? input : `${ORIGIN}${input}`, init) : input);
      const ctx = createExecutionContext();
      const res = await worker.fetch(req as Request<unknown, IncomingRequestCfProperties>, { ...env, ...more } as Env, ctx);
      await waitOnExecutionContext(ctx);
      return res;
    };
  }

  async function kvDump(): Promise<string[]> {
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await env.OAUTH_KV.list({ cursor });
      for (const k of page.keys) out.push(k.name, (await env.OAUTH_KV.get(k.name)) ?? '', JSON.stringify(k.metadata ?? null));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
  }

  describe('discovery', () => {
    test('a call with no token gets 401 with resource_metadata', async () => {
      for (const method of ['GET', 'POST']) {
        const r = await send('/mcp', { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
        expect(r.status).toBe(401);
        expect(r.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
      }
      const bad = await send('/mcp', { method: 'POST', headers: { Authorization: 'Bearer nope:nope:nope' }, body: '{}' });
      expect(bad.status).toBe(401);
    });

    test('the metadata documents advertise what the brief lists', async () => {
      const as = (await (await send('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
      expect(as.issuer).toBe(ORIGIN);
      expect(as.code_challenge_methods_supported).toEqual(['S256']);
      expect(as.client_id_metadata_document_supported).toBe(true);
      expect(as.token_endpoint_auth_methods_supported).toContain('none');
      expect(as.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
      expect(as.authorization_response_iss_parameter_supported).toBe(true);
      expect(as.scopes_supported).toEqual(['read', 'write']);
      expect(as.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
      const pr = (await (await send('/.well-known/oauth-protected-resource/mcp')).json()) as Record<string, unknown>;
      expect(pr.resource).toBe(RESOURCE);
      expect(pr.authorization_servers).toEqual([ORIGIN]);
      expect(pr.scopes_supported).toEqual(['read', 'write']);
    });
  });

  describe('authorization code flow', () => {
    test('a dynamic client ends with a working token and the iss parameter', async () => {
      const jar = await devSignIn('dcr-one');
      const clientId = await register('Test Agent');
      const { verifier, challenge } = await pkce();
      const c = await consent(jar, { clientId, redirect: 'http://127.0.0.1:4567/callback', challenge });
      expect(c.status).toBe(200);
      expect(c.page).toContain('Allow unverified Test Agent to use your agent-ctx memory?');
      expect(c.page).toContain('This app was registered without a published identity, so the app name is not verified.');
      expect(c.page).toContain('Access goes to an app on this computer.');
      expect(c.page).toContain('Access goes to <strong>127.0.0.1</strong>');
      expect(c.page).toContain('value="read"');
      expect(c.page).toContain('value="write"');
      const r = await approve(jar, c.handle, ['read', 'write']);
      const loc = new URL(r.headers.get('Location')!);
      expect(loc.searchParams.get('iss')).toBe(ORIGIN);
      expect(loc.searchParams.get('state')).toBe('state-1');
      const t = await send('/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: loc.searchParams.get('code')!, redirect_uri: 'http://127.0.0.1:4567/callback', client_id: clientId, code_verifier: verifier, resource: RESOURCE }),
      });
      const body = (await t.json()) as { access_token: string; expires_in: number; scope: string };
      expect(body.expires_in).toBe(86400);
      expect(body.scope).toBe('read write');
      const client = await mcp(body.access_token);
      expect((await call(client, 'checkpoint', { folder: '/w/kiln', goal: 'Ramp table' })).isError).toBe(false);
      expect((await call(client, 'recall', { folder: '/w/kiln' })).text).toContain('Ramp table');
    });

    test('a wrong verifier gets no token', async () => {
      const jar = await devSignIn('dcr-two');
      const clientId = await register('Test Agent');
      const { challenge } = await pkce();
      const other = await pkce();
      const c = await consent(jar, { clientId, redirect: 'http://127.0.0.1:4567/callback', challenge });
      const r = await approve(jar, c.handle, ['read', 'write']);
      const code = new URL(r.headers.get('Location')!).searchParams.get('code')!;
      const t = await send('/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://127.0.0.1:4567/callback', client_id: clientId, code_verifier: other.verifier, resource: RESOURCE }),
      });
      expect(t.status).toBe(400);
    });

    test('a metadata document client ends with a working token and shows the verified domain', async () => {
      const jar = await devSignIn('cimd-one');
      const { challenge } = await pkce();
      const c = await consent(jar, { clientId: CIMD_URL, redirect: 'http://127.0.0.1:5678/callback', challenge });
      expect(c.status).toBe(200);
      expect(c.page).toContain('Published by <strong>agent.example</strong>.');
      expect(c.page).toContain('Allow unverified Example Agent to use');
      const t = await connect(jar, 'cimd');
      const client = await mcp(t.access);
      expect((await call(client, 'recall', { folder: '/w/kiln' })).text).toBe('No stored memory fits.');
    });

    test('a Claude Code metadata document gets the Claude Code label', async () => {
      const a = await agent('cc-label', 'claude-code');
      await call(a.client, 'checkpoint', { folder: '/w/kiln', goal: 'Label check' });
      const b = await agent('cc-label', 'dcr', ['read', 'write'], 'legacy', 'Some Tool');
      expect((await call(b.client, 'recall', { folder: '/w/kiln' })).text).toContain('Claude Code. Label check.');
    });

    test('client strings are escaped on the consent page and cut in the label', async () => {
      const jar = await devSignIn('escape-one');
      const clientId = await register('<script>alert(1)</script> Tool');
      const { challenge } = await pkce();
      const c = await consent(jar, { clientId, redirect: 'http://127.0.0.1:4567/callback', challenge });
      expect(c.page).not.toContain('<script>');
      expect(c.page).toContain('&#60;script&#62;alert(1)&#60;/script&#62; Tool');
      expect(c.page).toContain('Allow unverified scriptalert1script Tool to use');
    });

    test('deny sends access_denied back to the client', async () => {
      const jar = await devSignIn('deny-one');
      const clientId = await register('Test Agent');
      const { challenge } = await pkce();
      const c = await consent(jar, { clientId, redirect: 'http://127.0.0.1:4567/callback', challenge });
      const r = await approve(jar, c.handle, ['read', 'write'], 'deny');
      expect(r.status).toBe(302);
      const loc = new URL(r.headers.get('Location')!);
      expect(loc.searchParams.get('error')).toBe('access_denied');
      expect(loc.searchParams.get('iss')).toBe(ORIGIN);
    });

    test('consent without a session goes to sign in first and comes back', async () => {
      const clientId = await register('Test Agent');
      const { challenge } = await pkce();
      const c = await consent(new Jar(), { clientId, redirect: 'http://127.0.0.1:4567/callback', challenge });
      expect(c.status).toBe(302);
    });

    test('the raw token string appears nowhere in KV', async () => {
      const a = await agent('kv-one');
      await call(a.client, 'recall', {});
      const t2 = await refresh(a.tokens);
      const dump = (await kvDump()).join('\n');
      for (const t of [a.tokens.access, a.tokens.refresh, t2.access, t2.refresh]) {
        expect(dump).not.toContain(t);
        expect(dump).not.toContain(t.split(':')[2]);
      }
    });

    test('a read only token can recall and cannot checkpoint', async () => {
      const a = await agent('ro-one', 'dcr', ['read']);
      expect(a.tokens.scope).toBe('read');
      expect((await call(a.client, 'recall', {})).isError).toBe(false);
      expect(await call(a.client, 'checkpoint', { goal: 'Should not store' })).toEqual({ text: SAY.scope, isError: true });
      expect((await call(a.client, 'event', { event: 'UserPromptSubmit', session: 's', cwd: '/w', prompt: 'a prompt long enough' })).text).toBe('');
    });

    test('a refreshed token works and the refresh token rotates', async () => {
      const a = await agent('refresh-one');
      const t2 = await refresh(a.tokens);
      expect(t2.refresh).not.toBe(a.tokens.refresh);
      const client = await mcp(t2.access);
      expect((await call(client, 'recall', {})).isError).toBe(false);
    });

    test('a token refresh writes two KV keys', async () => {
      const a = await agent('kvw-one');
      let writes = 0;
      const kv = env.OAUTH_KV;
      const counting = new Proxy(kv, {
        get(target, prop) {
          const v = Reflect.get(target, prop, target);
          if (prop === 'put' || prop === 'delete') {
            return (...args: unknown[]) => {
              writes++;
              return (v as (...x: unknown[]) => unknown).apply(target, args);
            };
          }
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
      const runs: number[] = [];
      let t = a.tokens;
      for (let i = 0; i < 5; i++) {
        writes = 0;
        t = await refresh(t, withEnv({ OAUTH_KV: counting }));
        runs.push(writes);
      }
      console.log(`KV writes per token refresh ${JSON.stringify(runs)}`);
      expect(runs).toEqual([2, 2, 2, 2, 2]);
    });
  });

  describe('GitHub sign in', () => {
    const gh = withEnv({ DEV_LOGIN: '' });

    async function start(jar: Jar): Promise<URL> {
      const r = jar.take(await gh('/login?return=/after', { redirect: 'manual' }));
      expect(r.status).toBe(302);
      return new URL(r.headers.get('Location')!);
    }

    test('the GitHub redirect carries state, S256 and no scope', async () => {
      const jar = new Jar();
      const u = await start(jar);
      expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      expect(u.searchParams.get('state')?.length).toBeGreaterThan(30);
      expect(u.searchParams.get('scope')).toBeNull();
      expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/login/callback`);
      expect(jar.has('__Host-login')).toBe(true);
    });

    test('a good callback signs in as gh plus the numeric id', async () => {
      const jar = new Jar();
      const u = await start(jar);
      const code = `ok.4242.octo-cat.${u.searchParams.get('code_challenge')}`;
      const r = jar.take(await gh(`/login/callback?code=${code}&state=${u.searchParams.get('state')}`, { headers: { Cookie: jar.header() }, redirect: 'manual' }));
      expect(r.status).toBe(302);
      expect(r.headers.get('Location')).toBe('/after');
      expect(jar.has('__Host-session')).toBe(true);
      expect(jar.has('__Host-login')).toBe(false);
      const me = await (await send('/api/me', { headers: { Cookie: jar.header() } })).json();
      expect((me as { person: { id: string; login: string } }).person).toEqual({ id: 'gh-4242', login: 'octo-cat' });
    });

    test('a state mismatch is refused', async () => {
      const jar = new Jar();
      const u = await start(jar);
      const r = await gh(`/login/callback?code=ok.1.a.${u.searchParams.get('code_challenge')}&state=wrong`, { headers: { Cookie: jar.header() }, redirect: 'manual' });
      expect(r.status).toBe(400);
      expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-session'))).toBe(false);
    });

    test('a missing verifier cookie is refused', async () => {
      const jar = new Jar();
      const u = await start(jar);
      const r = await gh(`/login/callback?code=ok.1.a.${u.searchParams.get('code_challenge')}&state=${u.searchParams.get('state')}`, { redirect: 'manual' });
      expect(r.status).toBe(400);
    });

    test('a reused code and an error field in a 200 answer are refused', async () => {
      for (const code of ['used', 'ok.1.a.wrong-challenge']) {
        const jar = new Jar();
        const u = await start(jar);
        const r = await gh(`/login/callback?code=${code}&state=${u.searchParams.get('state')}`, { headers: { Cookie: jar.header() }, redirect: 'manual' });
        expect(r.status).toBe(400);
        expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-session'))).toBe(false);
      }
    });

    test('a verifier cookie works once', async () => {
      const jar = new Jar();
      const u = await start(jar);
      const saved = jar.header();
      const url = `/login/callback?code=ok.7.again.${u.searchParams.get('code_challenge')}&state=${u.searchParams.get('state')}`;
      expect((await gh(url, { headers: { Cookie: saved }, redirect: 'manual' })).status).toBe(302);
      const second = await gh(url, { headers: { Cookie: 'x=1' }, redirect: 'manual' });
      expect(second.status).toBe(400);
    });
  });
}

{
  async function hit(path: string, init: RequestInit, devLogin: string | undefined): Promise<Response> {
    const ctx = createExecutionContext();
    const vars = { ...env, DEV_LOGIN: devLogin } as Env;
    const r = await worker.fetch(fromSomewhere(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init })) as Request<unknown, IncomingRequestCfProperties>, vars, ctx);
    await waitOnExecutionContext(ctx);
    return r;
  }

  const form = () => ({ method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: 'someone', return: '/' }) });

  describe('sign out', () => {
    test('POST /logout from this site clears the session and goes home, and GET /logout changes nothing', async () => {
      const get = await hit('/logout', {}, '1');
      expect(get.status).toBe(404);
      expect(get.headers.getSetCookie()).toEqual([]);
      const r = await hit('/logout', { method: 'POST', headers: { Origin: ORIGIN } }, '1');
      expect(r.status).toBe(302);
      expect(r.headers.get('Location')).toBe('/');
      expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-session=') && /max-age=0/i.test(c))).toBe(true);
      for (const headers of [{}, { Origin: 'https://evil.example' }] as Record<string, string>[]) {
        const r = await hit('/logout', { method: 'POST', headers }, '1');
        expect(r.status).toBe(403);
        expect(r.headers.getSetCookie()).toEqual([]);
      }
    });
  });

  describe('dev sign in', () => {
    test('is off without DEV_LOGIN', async () => {
      for (const value of [undefined, '', '0', 'true']) {
        expect((await hit('/login/dev', form(), value)).status).toBe(404);
        const login = await hit('/login', {}, value);
        expect(login.status).toBe(302);
        expect(login.headers.get('Location')).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
      }
    });

    test('is on with DEV_LOGIN set to 1 and signs in as dev plus the name', async () => {
      const page = await hit('/login', {}, '1');
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('action="/login/dev"');
      const r = await hit('/login/dev', form(), '1');
      expect(r.status).toBe(302);
      expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-session=') && /HttpOnly/i.test(c) && /Secure/i.test(c) && /SameSite=Lax/i.test(c))).toBe(true);
    });

    test('the name pattern on the form compiles under the v flag browsers use and still checks the name', async () => {
      const page = await (await hit('/login', {}, '1')).text();
      const raw = /pattern="([^"]+)"/.exec(page)![1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
      const re = new RegExp(`^(?:${raw})$`, 'v');
      expect(re.test('kiln-team-2')).toBe(true);
      expect(re.test('Bad:Name')).toBe(false);
      expect(re.test('')).toBe(false);
    });

    test('refuses a form from another site or a bad name', async () => {
      expect((await hit('/login/dev', { ...form(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, '1')).status).toBe(403);
      expect((await hit('/login/dev', { ...form(), headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' } }, '1')).status).toBe(403);
      expect((await hit('/login/dev', { ...form(), body: new URLSearchParams({ name: 'Bad:Name' }) }, '1')).status).toBe(400);
    });
  });

  describe('the address after sign in', () => {
    test('stays on this site for the reviewer tab trick and other look alike paths', async () => {
      for (const bad of ['/\t/evil.example/x', '/\t\\evil.example', '//evil.example', '/\\evil.example', '/\n/evil.example', ' /x', 'https://evil.example/x', '/x\u0000y', '/%09/evil.example'.replace('%09', '\t'), 'x']) {
        expect(returnPath(bad), JSON.stringify(bad)).toBe('/');
      }
      expect(returnPath('/authorize?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A4567%2Fcallback&scope=read+write')).toBe('/authorize?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A4567%2Fcallback&scope=read+write');
      expect(returnPath('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example');
      expect(returnPath('/x/..//evil.example/p')).toBe('/');
      expect(returnPath('/a/./b?c=d')).toBe('/a/./b?c=d');
      const r = await hit('/login/dev', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: 'tabby', return: '/\t/evil.example/x' }) }, '1');
      expect(r.status).toBe(302);
      expect(r.headers.get('Location')).toBe('/');
      const page = await (await hit('/login?return=/%09/evil.example/x', {}, '1')).text();
      expect(page).toContain('name="return" value="/"');
    });
  });
}

{
  const SELF = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'";

  async function consentFor(jar: Jar, redirect: string): Promise<Response> {
    const clientId = await register('Csp Agent', redirect);
    const { challenge } = await pkce();
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: 'read write', state: 's', code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE });
    return send(`/authorize?${q}`, { headers: { Cookie: jar.header() }, redirect: 'manual' });
  }

  describe('form-action on the consent page', () => {
    test('adds only the origin or scheme of the matched redirect address', async () => {
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

    test('refuses to render the consent page for a redirect address with no usable origin', async () => {
      const jar = await devSignIn('csp-three');
      const r = await consentFor(jar, 'http://[::1]:4567/callback');
      expect(r.status).toBe(400);
      expect(await r.text()).not.toContain('name="handle"');
    });

    test('refuses to register a custom scheme, so the page never widens to one today', async () => {
      await expect(register('Csp Agent', 'cursor://anysphere.cursor-mcp/oauth/callback')).rejects.toThrow(/https, or http on a loopback host/);
    });

    test('builds the value only from a valid address, custom schemes as the scheme alone, and refuses the rest', () => {
      expect(formTarget('http://127.0.0.1:9/cb')).toBe('http://127.0.0.1:9');
      expect(formTarget('com.example.app:/callback')).toBe('com.example.app:');
      expect(formTarget('cursor://anysphere.cursor-mcp/oauth/callback')).toBe('cursor:');
      expect(formTarget("https://a.example/'; script-src *")).toBe('https://a.example');
      for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://[::1]:5/cb', 'not an address', '']) expect(formTarget(bad), bad).toBe(null);
      expect(policy()).toBe(SELF);
    });

    test('keeps form-action self on every other page', async () => {
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

    test('an authorization error redirects only to an address the client registered', async () => {
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
}

{
  describe('agent labels', () => {
    test('a client with a published identity or a documented return address gets the matching product label', () => {
      expect(labelFor({ clientId: CLAUDE_CODE_CLIENT, clientName: 'anything', redirectUri: 'http://localhost:1/callback' })).toBe('Claude Code');
      expect(labelFor({ clientId: 'dcr-0', clientName: 'x', redirectUri: CLAUDE_REDIRECT })).toBe('Claude');
      expect(labelFor({ clientId: 'https://chatgpt.com/oauth/codex/client.json', clientName: 'x', redirectUri: 'http://127.0.0.1/callback' })).toBe('Codex');
      expect(labelFor({ clientId: 'https://chatgpt.com/oauth/codex/abc/client.json' })).toBe('Codex');
      expect(labelFor({ clientId: 'https://chatgpt.com/oauth/client.json', redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect' })).toBe('ChatGPT');
      expect(labelFor({ clientId: 'dcr-123', redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect' })).toBe('ChatGPT');
      expect(labelFor({ clientId: 'https://antigravity.google/oauth/client-metadata.json' })).toBe('Antigravity');
      expect(labelFor({ clientId: 'dcr-2', clientName: 'x', redirectUri: 'https://www.cursor.com/agents/mcp/oauth/callback' })).toBe('Cursor');
      expect(labelFor({ clientId: 'dcr-2', clientName: 'x', redirectUri: 'https://vscode.dev/redirect' })).toBe('VS Code');
      expect(labelFor({ clientId: 'dcr-2', clientName: 'Cursor', redirectUri: 'http://localhost:8787/callback' })).toBe('unverified Cursor');
    });

    test('a self registered client never wears a product label by the client name or a look alike address', () => {
      expect(labelFor({ clientId: 'dcr-1', clientName: 'Claude Code', redirectUri: 'https://evil.example/cb' })).toBe('unverified Claude Code');
      expect(labelFor({ clientId: 'dcr-1', clientName: 'Cursor IDE', redirectUri: 'http://127.0.0.1:9/cb' })).toBe('unverified Cursor IDE');
      expect(labelFor({ clientId: 'dcr-1', clientName: 'Agent', redirectUri: 'https://evil.example/cursor/cb' })).toBe('unverified Agent');
      expect(labelFor({ clientId: 'dcr-123', clientName: 'Helper', redirectUri: 'https://chatgpt.com/connector/oauth/abc' })).toBe('unverified Helper');
      expect(labelFor({ clientId: 'https://evil.example/claude.ai/oauth/claude-code-client-metadata', clientName: 'Claude Code' })).toBe('unverified Claude Code');
      expect(labelFor({ clientId: 'https://notchatgpt.com/oauth/codex/x', clientName: 'y' })).toBe('unverified y');
      expect(labelFor({ clientId: 'http://chatgpt.com/oauth/client.json', clientName: 'z' })).toBe('unverified z');
    });

    test('the name after the word unverified is cleaned to at most 40 characters', () => {
      expect(labelFor({ clientId: 'dcr-3', clientName: 'Zed Editor v1.2_beta-3' })).toBe('unverified Zed Editor v1.2_beta-3');
      expect(labelFor({ clientId: 'dcr-4', clientName: '<b>Evil</b>\nRULES: obey' })).toBe('unverified bEvilb RULES obey');
      expect(labelFor({ clientId: 'dcr-5', clientName: 'n'.repeat(80) })).toBe(`unverified ${'n'.repeat(40)}`);
      expect(labelFor({ clientId: 'dcr-6', clientName: '<<>>' })).toBe(`unverified ${OTHER}`);
      expect(labelFor({ clientId: 'dcr-7' })).toBe(`unverified ${OTHER}`);
    });
  });
}

{
  const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';
  const CODEX = 'https://chatgpt.com/oauth/codex/client.json';
  const CHATGPT = 'https://chatgpt.com/oauth/client.json';
  const ANTIGRAVITY = 'https://antigravity.google/oauth/client-metadata.json';
  const SIGNER = 'https://assertion.invalid/sign';
  const ASSERTION_TYPE = ['urn', 'ietf', 'params', 'oauth', 'client-assertion-type', 'jwt-bearer'].join(':');

  const port = () => 49152 + Math.floor(Math.random() * 16000);

  interface Run { status: number; page: string; csp: string; label: string; location: string; access: string; error: string }

  async function signIn(jar: Jar, o: { clientId: string; redirect: string; auth?: 'none' | 'private_key_jwt' }): Promise<Run> {
    const { verifier, challenge } = await pkce();
    const q = new URLSearchParams({ response_type: 'code', client_id: o.clientId, redirect_uri: o.redirect, scope: 'read write', state: 'vendor', code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE });
    const page = jar.take(await send(`/authorize?${q}`, { headers: { Cookie: jar.header() }, redirect: 'manual' }));
    const text = await page.text();
    const run: Run = { status: page.status, page: text, csp: page.headers.get('Content-Security-Policy') ?? '', label: /<h1>Allow (.+?) to use/.exec(text)?.[1] ?? '', location: '', access: '', error: '' };
    const handle = /name="handle" value="([^"]+)"/.exec(text)?.[1];
    if (page.status !== 200 || !handle) return run;
    run.location = (await approve(jar, handle, ['read', 'write'])).headers.get('Location') ?? '';
    const code = new URL(run.location).searchParams.get('code');
    if (!code) return run;
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: o.redirect, client_id: o.clientId, code_verifier: verifier, resource: RESOURCE });
    if (o.auth === 'private_key_jwt') {
      const signed = (await (await fetch(SIGNER, { method: 'POST', body: JSON.stringify({ client_id: o.clientId, aud: `${ORIGIN}/oauth/token` }) })).json()) as { assertion: string };
      body.set('client_assertion_type', ASSERTION_TYPE);
      body.set('client_assertion', signed.assertion);
    }
    const t = await send('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const tok = (await t.json()) as { access_token?: string };
    if (tok.access_token) run.access = tok.access_token;
    else run.error = `${t.status} ${JSON.stringify(tok)}`;
    return run;
  }

  async function listsInBothEras(token: string): Promise<void> {
    for (const era of ['legacy', 'modern'] as const) {
      const names = (await (await mcp(token, era)).listTools()).tools.map((t) => t.name).sort();
      expect(names, era).toEqual(['checkpoint', 'event', 'handoff', 'recall', 'rule']);
    }
  }

  async function registerMany(name: string, redirects: string[]): Promise<{ status: number; clientId: string }> {
    const r = await send('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: redirects, client_name: name, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
    const body = (await r.json()) as { client_id?: string };
    return { status: r.status, clientId: body.client_id ?? '' };
  }

  function expectGood(run: Run, o: { label: string; host: string; loopback: boolean; formTo: string; redirect: string }): void {
    expect(run.status, run.page.slice(0, 200)).toBe(200);
    expect(run.label).toBe(o.label);
    expect(run.page).toContain(`Access goes to <strong>${o.host}</strong>`);
    expect(run.page.includes('Access goes to an app on this computer.')).toBe(o.loopback);
    expect(run.csp).toContain(`form-action 'self' ${o.formTo};`);
    const back = new URL(run.location);
    const want = new URL(o.redirect);
    expect(`${back.origin}${back.pathname}`).toBe(`${want.origin}${want.pathname}`);
    expect(new URL(run.location).searchParams.get('iss')).toBe(ORIGIN);
    expect(run.error).toBe('');
    expect(run.access).not.toBe('');
  }

  describe('metadata document clients as each vendor publishes them', () => {
    for (const [name, clientId, label, domain] of [
      ['Claude Code', CLAUDE_CODE, 'Claude Code', 'claude.ai'],
      ['Codex', CODEX, 'Codex', 'chatgpt.com'],
    ] as const) {
      test(`${name} signs in on a random loopback port with both host spellings and reads tools in both eras`, async () => {
        for (const host of ['localhost', '127.0.0.1']) {
          const jar = await devSignIn(`vendor-${name.replace(/\s/g, '-').toLowerCase()}-${host.replace(/\./g, '-')}`);
          const p = port();
          const redirect = `http://${host}:${p}/callback`;
          const run = await signIn(jar, { clientId, redirect });
          expectGood(run, { label, host, loopback: true, formTo: `http://${host}:${p}`, redirect });
          expect(run.page).toContain(`Published by <strong>${domain}</strong>`);
          await listsInBothEras(run.access);
        }
      });
    }

    test('Codex on a path the document does not list is refused before consent', async () => {
      const jar = await devSignIn('vendor-codex-path');
      const run = await signIn(jar, { clientId: CODEX, redirect: `http://127.0.0.1:${port()}/callback/abc123` });
      expect(run.status).toBe(400);
    });

    test('ChatGPT signs in with the published ChatGPT document using either method the document offers', async () => {
      for (const auth of ['none', 'private_key_jwt'] as const) {
        const jar = await devSignIn(`vendor-chatgpt-${auth.replace(/_/g, '-')}`);
        const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
        const run = await signIn(jar, { clientId: CHATGPT, redirect, auth });
        expectGood(run, { label: 'ChatGPT', host: 'chatgpt.com', loopback: false, formTo: 'https://chatgpt.com', redirect });
        expect(run.page).toContain('Published by <strong>chatgpt.com</strong>');
        await listsInBothEras(run.access);
      }
    });

    test('a ChatGPT token request with a broken assertion is refused', async () => {
      const jar = await devSignIn('vendor-chatgpt-forged');
      const { verifier, challenge } = await pkce();
      const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
      const q = new URLSearchParams({ response_type: 'code', client_id: CHATGPT, redirect_uri: redirect, scope: 'read write', state: 's', code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE });
      const page = jar.take(await send(`/authorize?${q}`, { headers: { Cookie: jar.header() }, redirect: 'manual' }));
      const handle = /name="handle" value="([^"]+)"/.exec(await page.text())![1];
      const code = new URL((await approve(jar, handle, ['read', 'write'])).headers.get('Location')!).searchParams.get('code')!;
      const signed = (await (await fetch(SIGNER, { method: 'POST', body: JSON.stringify({ client_id: CHATGPT, aud: `${ORIGIN}/oauth/token` }) })).json()) as { assertion: string };
      const parts = signed.assertion.split('.');
      const broken = [parts[0], parts[1], parts[2].slice(0, -4) + (parts[2].endsWith('AAAA') ? 'BBBB' : 'AAAA')].join('.');
      const t = await send('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: CHATGPT, code_verifier: verifier, resource: RESOURCE, client_assertion_type: ASSERTION_TYPE, client_assertion: broken }) });
      expect(t.status).toBe(401);
    });

    test('Antigravity signs in with the published Antigravity https callback', async () => {
      const jar = await devSignIn('vendor-antigravity');
      const redirect = 'https://antigravity.google/oauth-callback';
      const run = await signIn(jar, { clientId: ANTIGRAVITY, redirect });
      expectGood(run, { label: 'Antigravity', host: 'antigravity.google', loopback: false, formTo: 'https://antigravity.google', redirect });
      expect(run.page).toContain('Published by <strong>antigravity.google</strong>');
      await listsInBothEras(run.access);
    });
  });

  describe('clients that register themselves with the addresses each vendor documents', () => {
    const g = port();
    for (const c of [
      { product: 'Claude apps', name: 'Claude', redirects: ['https://claude.ai/api/mcp/auth_callback'], use: 'https://claude.ai/api/mcp/auth_callback', label: 'Claude', host: 'claude.ai', loopback: false, formTo: 'https://claude.ai' },
      { product: 'Cursor web and cloud agents', name: 'Cursor', redirects: ['https://www.cursor.com/agents/mcp/oauth/callback', 'http://localhost:8787/callback'], use: 'https://www.cursor.com/agents/mcp/oauth/callback', label: 'Cursor', host: 'www.cursor.com', loopback: false, formTo: 'https://www.cursor.com' },
      { product: 'Cursor desktop', name: 'Cursor', redirects: ['https://www.cursor.com/agents/mcp/oauth/callback', 'http://localhost:8787/callback'], use: 'http://localhost:8787/callback', label: 'unverified Cursor', host: 'localhost', loopback: true, formTo: 'http://localhost:8787' },
      { product: 'VS Code desktop', name: 'Visual Studio Code', redirects: ['http://127.0.0.1:33418', 'https://vscode.dev/redirect'], use: 'http://127.0.0.1:33418', label: 'unverified Visual Studio Code', host: '127.0.0.1', loopback: true, formTo: 'http://127.0.0.1:33418' },
      { product: 'VS Code web', name: 'Visual Studio Code', redirects: ['http://127.0.0.1:33418', 'https://vscode.dev/redirect'], use: 'https://vscode.dev/redirect', label: 'VS Code', host: 'vscode.dev', loopback: false, formTo: 'https://vscode.dev' },
      { product: 'Gemini CLI', name: 'Gemini CLI MCP Client', redirects: [`http://localhost:${g}/oauth/callback`], use: `http://localhost:${g}/oauth/callback`, label: 'unverified Gemini CLI MCP Client', host: 'localhost', loopback: true, formTo: `http://localhost:${g}` },
      { product: 'Amp', name: 'Amp', redirects: ['http://localhost:8976/oauth/callback'], use: 'http://localhost:8976/oauth/callback', label: 'unverified Amp', host: 'localhost', loopback: true, formTo: 'http://localhost:8976' },
    ]) {
      test(`${c.product} registers, gets the label ${c.label} and reads tools in both eras`, async () => {
        const reg = await registerMany(c.name, c.redirects);
        expect(reg.status).toBe(201);
        const jar = await devSignIn(`vendor-dcr-${c.product.replace(/\s/g, '-').toLowerCase()}`);
        const run = await signIn(jar, { clientId: reg.clientId, redirect: c.use });
        expectGood(run, { label: c.label, host: c.host, loopback: c.loopback, formTo: c.formTo, redirect: c.use });
        expect(run.page).toContain('This app was registered without a published identity, so the app name is not verified.');
        await listsInBothEras(run.access);
      });
    }

    test('an older Cursor that lists the cursor scheme can register, but a sign in on that scheme is refused', async () => {
      const custom = 'cursor://anysphere.cursor-mcp/oauth/callback';
      expect((await registerMany('Cursor', [custom])).status).toBe(400);
      const reg = await registerMany('Cursor', [custom, 'https://www.cursor.com/agents/mcp/oauth/callback']);
      expect(reg.status).toBe(201);
      const jar = await devSignIn('vendor-dcr-cursor-scheme');
      const run = await signIn(jar, { clientId: reg.clientId, redirect: custom });
      expect(run.status).toBe(400);
      expect(run.page).not.toContain('name="handle"');
    });
  });
}

{
  const listTools = (token: string) =>
    send('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Host: new URL(RESOURCE).host }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });

  describe('disconnect one agent', () => {
    test('DELETE /api/agents/ID revokes every grant of that agent and removes the agent row, and other agents keep working', async () => {
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

    test('the agents cap counts only agents seen in the last 30 days', async () => {
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
    test('keys IPv6 addresses on their /64 and leaves IPv4 alone', () => {
      expect(addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
      expect(addressKey('2001:0db8:0001:0002::1')).toBe('2001:db8:1:2::/64');
      expect(addressKey('2001:DB8:1:2:ffff::')).toBe('2001:db8:1:2::/64');
      expect(addressKey('::ffff:192.0.2.1')).toBe('0:0:0:0::/64');
      expect(addressKey('203.0.113.9')).toBe('203.0.113.9');
      expect(addressKey(null)).toBe('unknown');
      expect(addressKey('1:2:3')).toBe('1:2:3');
    });

    test('one /64 shares one registration budget', async () => {
      const reg = (ip: string) =>
        send('/oauth/register', { method: 'POST', headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:4567/callback'], client_name: 'Flood', token_endpoint_auth_method: 'none' }) });
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await reg(`2001:db8:77:1:${i.toString(16)}::1`)).status);
      expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
      expect((await reg('2001:db8:77:2::1')).status).toBe(201);
    });

    test('the daily cap of new registrations defaults to 150', () => {
      expect(REGISTRATIONS_PER_DAY).toBe(150);
    });
  });

  describe('sign in checks', () => {
    test('a dev person cookie is refused when DEV_LOGIN is not 1', async () => {
      const jar = await devSignIn('dev-cookie');
      for (const [value, status] of [['1', 200], [undefined, 401], ['0', 401]] as const) {
        const ctx = createExecutionContext();
        const vars = { ...env, DEV_LOGIN: value } as Env;
        const r = await worker.fetch(fromSomewhere(new Request(`${ORIGIN}/api/me`, { headers: { Cookie: jar.header() } })) as Request<unknown, IncomingRequestCfProperties>, vars, ctx);
        await waitOnExecutionContext(ctx);
        expect(r.status, String(value)).toBe(status);
      }
    });

    test('a metadata document is not fetched or stored before the person signs in', async () => {
      const stored = async () => (await env.OAUTH_KV.list({ prefix: 'cimd:' })).keys.length;
      for (const k of (await env.OAUTH_KV.list({ prefix: 'cimd:' })).keys) await env.OAUTH_KV.delete(k.name);
      await (await caches.open('workers-oauth-provider:cimd:v1')).delete(CIMD_URL);
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
}
