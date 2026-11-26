import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.ts';
import { ORIGIN } from './flow.ts';

async function hit(path: string, init: RequestInit, devLogin: string | undefined): Promise<Response> {
  const ctx = createExecutionContext();
  const vars = { ...env, DEV_LOGIN: devLogin } as Env;
  const r = await worker.fetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }) as Request<unknown, IncomingRequestCfProperties>, vars, ctx);
  await waitOnExecutionContext(ctx);
  return r;
}

const form = () => ({ method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: 'someone', return: '/' }) });

describe('sign out', () => {
  it('GET and POST /logout clear the session and go home, POST only from this site', async () => {
    for (const init of [{}, { method: 'POST', headers: { Origin: ORIGIN } }]) {
      const r = await hit('/logout', init, '1');
      expect(r.status).toBe(302);
      expect(r.headers.get('Location')).toBe('/');
      expect(r.headers.getSetCookie().some((c) => c.startsWith('__Host-session=') && /max-age=0/i.test(c))).toBe(true);
    }
    for (const headers of [{}, { Origin: 'https://evil.example' }]) {
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

  it('refuses a form from another site or a bad name', async () => {
    expect((await hit('/login/dev', { ...form(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, '1')).status).toBe(403);
    expect((await hit('/login/dev', { ...form(), headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' } }, '1')).status).toBe(403);
    expect((await hit('/login/dev', { ...form(), body: new URLSearchParams({ name: 'Bad:Name' }) }, '1')).status).toBe(400);
  });
});
