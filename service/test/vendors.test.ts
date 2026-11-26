import { describe, expect, it } from 'vitest';
import { ORIGIN, RESOURCE, approve, devSignIn, mcp, pkce, send, type Jar } from './flow.ts';

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
  expect(run.page.includes('This sends access to an app on this computer.')).toBe(o.loopback);
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
    it(`${name} signs in on a random loopback port with both host spellings and reads tools in both eras`, async () => {
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

  it('Codex on a path the document does not list is refused before consent', async () => {
    const jar = await devSignIn('vendor-codex-path');
    const run = await signIn(jar, { clientId: CODEX, redirect: `http://127.0.0.1:${port()}/callback/abc123` });
    expect(run.status).toBe(400);
  });

  it('ChatGPT signs in with its published document using either method the document offers', async () => {
    for (const auth of ['none', 'private_key_jwt'] as const) {
      const jar = await devSignIn(`vendor-chatgpt-${auth.replace(/_/g, '-')}`);
      const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
      const run = await signIn(jar, { clientId: CHATGPT, redirect, auth });
      expectGood(run, { label: 'ChatGPT', host: 'chatgpt.com', loopback: false, formTo: 'https://chatgpt.com', redirect });
      expect(run.page).toContain('Published by <strong>chatgpt.com</strong>');
      await listsInBothEras(run.access);
    }
  });

  it('a ChatGPT token request with a broken assertion is refused', async () => {
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

  it('Antigravity signs in with its published https callback', async () => {
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
    it(`${c.product} registers, gets the label ${c.label} and reads tools in both eras`, async () => {
      const reg = await registerMany(c.name, c.redirects);
      expect(reg.status).toBe(201);
      const jar = await devSignIn(`vendor-dcr-${c.product.replace(/\s/g, '-').toLowerCase()}`);
      const run = await signIn(jar, { clientId: reg.clientId, redirect: c.use });
      expectGood(run, { label: c.label, host: c.host, loopback: c.loopback, formTo: c.formTo, redirect: c.use });
      expect(run.page).toContain('This app registered itself. Its name is not verified.');
      await listsInBothEras(run.access);
    });
  }

  it('an older Cursor that lists its cursor scheme can register, but a sign in on that scheme is refused', async () => {
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
