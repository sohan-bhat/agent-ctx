import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.ts';
import { returnPath } from '../src/auth.ts';
import { ORIGIN, fromSomewhere } from './flow.ts';

async function hit(path: string, init: RequestInit, devLogin: string | undefined): Promise<Response> {
  const ctx = createExecutionContext();
  const vars = { ...env, DEV_LOGIN: devLogin } as Env;
  const r = await worker.fetch(fromSomewhere(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init })) as Request<unknown, IncomingRequestCfProperties>, vars, ctx);
  await waitOnExecutionContext(ctx);
  return r;
}

const form = () => ({ method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: 'someone', return: '/' }) });

describe('sign out', () => {
  it('POST /logout from this site clears the session and goes home, and GET /logout changes nothing', async () => {
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
  it('is off without DEV_LOGIN', async () => {
    for (const value of [undefined, '', '0', 'true']) {
      expect((await hit('/login/dev', form(), value)).status).toBe(404);
      const login = await hit('/login', {}, value);
      expect(login.status).toBe(302);
      expect(login.headers.get('Location')).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    }
  });

  it('is on with DEV_LOGIN set to 1 and signs in as dev plus the name', async () => {
    const page = await hit('/login', {}, '1');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('action="/login/dev"');
    const r = await hit('/login/dev', form(), '1');
    expect(r.status).toBe(302);
    expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-session=') && /HttpOnly/i.test(c) && /Secure/i.test(c) && /SameSite=Lax/i.test(c))).toBe(true);
  });

  it('the name pattern on the form compiles under the v flag browsers use and still checks the name', async () => {
    const page = await (await hit('/login', {}, '1')).text();
    const raw = /pattern="([^"]+)"/.exec(page)![1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    const re = new RegExp(`^(?:${raw})$`, 'v');
    expect(re.test('kiln-team-2')).toBe(true);
    expect(re.test('Bad:Name')).toBe(false);
    expect(re.test('')).toBe(false);
  });

  it('refuses a form from another site or a bad name', async () => {
    expect((await hit('/login/dev', { ...form(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, '1')).status).toBe(403);
    expect((await hit('/login/dev', { ...form(), headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' } }, '1')).status).toBe(403);
    expect((await hit('/login/dev', { ...form(), body: new URLSearchParams({ name: 'Bad:Name' }) }, '1')).status).toBe(400);
  });
});

describe('the address after sign in', () => {
  it('stays on this site for the reviewer tab trick and other look alike paths', async () => {
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
