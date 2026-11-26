import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.ts';
import { SAY } from '../src/limits.ts';
import { CIMD_URL } from './outbound.ts';
import { Jar, ORIGIN, RESOURCE, agent, approve, call, connect, consent, devSignIn, fromSomewhere, mcp, pkce, refresh, register, send, type Fetch } from './flow.ts';

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
  it('a call with no token gets 401 with resource_metadata', async () => {
    for (const method of ['GET', 'POST']) {
      const r = await send('/mcp', { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      expect(r.status).toBe(401);
      expect(r.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
    }
    const bad = await send('/mcp', { method: 'POST', headers: { Authorization: 'Bearer nope:nope:nope' }, body: '{}' });
    expect(bad.status).toBe(401);
  });

  it('the metadata documents advertise what the brief lists', async () => {
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
  it('a dynamic client ends with a working token and the iss parameter', async () => {
    const jar = await devSignIn('dcr-one');
    const clientId = await register('Test Agent');
    const { verifier, challenge } = await pkce();
    const c = await consent(jar, { clientId, redirect: 'http://127.0.0.1:4567/callback', challenge });
    expect(c.status).toBe(200);
    expect(c.page).toContain('Allow unverified Test Agent to use your agent-ctx memory?');
    expect(c.page).toContain('This app registered itself. Its name is not verified.');
    expect(c.page).toContain('This sends access to an app on this computer.');
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

  it('a wrong verifier gets no token', async () => {
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

  it('a metadata document client ends with a working token and shows its verified domain', async () => {
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

  it('a Claude Code metadata document gets the Claude Code label', async () => {
    const a = await agent('cc-label', 'claude-code');
    await call(a.client, 'checkpoint', { folder: '/w/kiln', goal: 'Label check' });
    const b = await agent('cc-label', 'dcr', ['read', 'write'], 'legacy', 'Some Tool');
    expect((await call(b.client, 'recall', { folder: '/w/kiln' })).text).toContain('Claude Code. Label check.');
  });

  it('client strings are escaped on the consent page and cut in the label', async () => {
    const jar = await devSignIn('escape-one');
    const clientId = await register('<script>alert(1)</script> Tool');
    const { challenge } = await pkce();
    const c = await consent(jar, { clientId, redirect: 'http://127.0.0.1:4567/callback', challenge });
    expect(c.page).not.toContain('<script>');
    expect(c.page).toContain('&#60;script&#62;alert(1)&#60;/script&#62; Tool');
    expect(c.page).toContain('Allow unverified scriptalert1script Tool to use');
  });

  it('deny sends access_denied back to the client', async () => {
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

  it('consent without a session goes to sign in first and comes back', async () => {
    const clientId = await register('Test Agent');
    const { challenge } = await pkce();
    const c = await consent(new Jar(), { clientId, redirect: 'http://127.0.0.1:4567/callback', challenge });
    expect(c.status).toBe(302);
  });

  it('the raw token string appears nowhere in KV', async () => {
    const a = await agent('kv-one');
    await call(a.client, 'recall', {});
    const t2 = await refresh(a.tokens);
    const dump = (await kvDump()).join('\n');
    for (const t of [a.tokens.access, a.tokens.refresh, t2.access, t2.refresh]) {
      expect(dump).not.toContain(t);
      expect(dump).not.toContain(t.split(':')[2]);
    }
  });

  it('a read only token can recall and cannot checkpoint', async () => {
    const a = await agent('ro-one', 'dcr', ['read']);
    expect(a.tokens.scope).toBe('read');
    expect((await call(a.client, 'recall', {})).isError).toBe(false);
    expect(await call(a.client, 'checkpoint', { goal: 'Should not store' })).toEqual({ text: SAY.scope, isError: true });
    expect((await call(a.client, 'event', { event: 'UserPromptSubmit', session: 's', cwd: '/w', prompt: 'a prompt long enough' })).text).toBe('');
  });

  it('a refreshed token works and the refresh token rotates', async () => {
    const a = await agent('refresh-one');
    const t2 = await refresh(a.tokens);
    expect(t2.refresh).not.toBe(a.tokens.refresh);
    const client = await mcp(t2.access);
    expect((await call(client, 'recall', {})).isError).toBe(false);
  });

  it('a token refresh writes two KV keys', async () => {
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

  it('the GitHub redirect carries state, S256 and no scope', async () => {
    const jar = new Jar();
    const u = await start(jar);
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')?.length).toBeGreaterThan(30);
    expect(u.searchParams.get('scope')).toBeNull();
    expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/login/callback`);
    expect(jar.has('__Host-login')).toBe(true);
  });

  it('a good callback signs in as gh plus the numeric id', async () => {
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

  it('a state mismatch is refused', async () => {
    const jar = new Jar();
    const u = await start(jar);
    const r = await gh(`/login/callback?code=ok.1.a.${u.searchParams.get('code_challenge')}&state=wrong`, { headers: { Cookie: jar.header() }, redirect: 'manual' });
    expect(r.status).toBe(400);
    expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-session'))).toBe(false);
  });

  it('a missing verifier cookie is refused', async () => {
    const jar = new Jar();
    const u = await start(jar);
    const r = await gh(`/login/callback?code=ok.1.a.${u.searchParams.get('code_challenge')}&state=${u.searchParams.get('state')}`, { redirect: 'manual' });
    expect(r.status).toBe(400);
  });

  it('a reused code and an error field in a 200 answer are refused', async () => {
    for (const code of ['used', 'ok.1.a.wrong-challenge']) {
      const jar = new Jar();
      const u = await start(jar);
      const r = await gh(`/login/callback?code=${code}&state=${u.searchParams.get('state')}`, { headers: { Cookie: jar.header() }, redirect: 'manual' });
      expect(r.status).toBe(400);
      expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-session'))).toBe(false);
    }
  });

  it('a verifier cookie works once', async () => {
    const jar = new Jar();
    const u = await start(jar);
    const saved = jar.header();
    const url = `/login/callback?code=ok.7.again.${u.searchParams.get('code_challenge')}&state=${u.searchParams.get('state')}`;
    expect((await gh(url, { headers: { Cookie: saved }, redirect: 'manual' })).status).toBe(302);
    const second = await gh(url, { headers: { Cookie: 'x=1' }, redirect: 'manual' });
    expect(second.status).toBe(400);
  });
});
