import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, openSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browser, engine, waitFor, web } from './lib.mjs';

const ORIGIN = process.env.ORIGIN ?? (engine === 'webkit' ? 'https://localhost:8795' : 'http://localhost:8795');
const TLS = ORIGIN.startsWith('https:');
if (TLS) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const RESOURCE = `${ORIGIN}/mcp`;
const MARKUP = '<img src=x onerror="window.__pwned=1"><b>Probe</b> & "quotes"';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${engine} ${name}${detail ? `  ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (buf) => Buffer.from(buf).toString('base64url');

async function up() {
  try {
    return (await fetch(`${ORIGIN}/.well-known/oauth-authorization-server`)).ok;
  } catch {
    return false;
  }
}

async function service(dir) {
  if (await up()) return async () => {};
  const log = openSync(path.join(dir, 'service.log'), 'w');
  const env = { ...process.env, DISABLE_TELEMETRY: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(dir, 'wrangler') };
  const svc = path.join(web, '..', 'service');
  const args = ['dev', '--port', new URL(ORIGIN).port, '--persist-to', path.join(dir, 'state'), '--var', 'DEV_LOGIN:1', '--var', `MCP_RESOURCE:${RESOURCE}`, ...(TLS ? ['--local-protocol', 'https'] : [])];
  const child = spawn(path.join(svc, 'node_modules', '.bin', 'wrangler'), args, { cwd: svc, detached: true, stdio: ['ignore', log, log], env });
  for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
  if (!(await up())) throw new Error('The service did not start.');
  return async () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
    for (let i = 0; i < 30 && (await up()); i++) await sleep(500);
  };
}

function listener() {
  const hits = [];
  const srv = createServer((req, res) => {
    hits.push(new URL(req.url, 'http://127.0.0.1'));
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('received');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, hits, close: () => new Promise((r) => srv.close(r)) })));
}

async function register(redirect, name) {
  const r = await fetch(`${ORIGIN}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [redirect], client_name: name, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  if (r.status !== 201) throw new Error(`Registration gave ${r.status}.`);
  return (await r.json()).client_id;
}

function authorizeUrl(clientId, redirect, state) {
  const verifier = b64url(randomBytes(32));
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: 'read write', state, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', resource: RESOURCE });
  return `${ORIGIN}/authorize?${q}`;
}

async function signInIfAsked(page, name) {
  if (!new URL(page.url()).pathname.startsWith('/login')) return;
  await page.locator('input[name=name]').fill(name);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname === '/authorize', { timeout: 10000 });
}

async function decide(page, button, arrived) {
  const notes = [];
  const onConsole = (m) => notes.push(`${m.type()}: ${m.text().slice(0, 240)}`);
  page.on('console', onConsole);
  await page.getByRole('button', { name: button }).click();
  const hit = await waitFor(arrived, 6000, 50);
  await page.waitForTimeout(400);
  page.off('console', onConsole);
  return { hit, url: page.url(), notes };
}

async function run(b, dir) {
  const name = `consent-${engine}-${Date.now().toString(36)}`;
  const ear = await listener();
  const loop = `http://127.0.0.1:${ear.port}/callback`;
  const web2 = 'https://agent.invalid/api/mcp/auth_callback';
  const ctx = await b.newContext({ ignoreHTTPSErrors: TLS });
  const page = await ctx.newPage();
  const external = [];
  page.on('request', (r) => {
    if (r.url().startsWith('https://agent.invalid/')) external.push(new URL(r.url()));
  });
  await ctx.route('https://agent.invalid/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: 'received' }));
  let proposed = null;
  await ctx.route(`${ORIGIN}/authorize?**`, async (r) => {
    if (!proposed || r.request().method() !== 'GET') return r.continue();
    const res = await r.fetch();
    const headers = { ...res.headers(), 'content-security-policy': proposed };
    return r.fulfill({ response: res, headers });
  });
  try {
    const a = await register(loop, 'Consent Probe');
    await page.goto(authorizeUrl(a, loop, 'allow-loop'));
    await signInIfAsked(page, name);
    const html = await page.content();
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    check('the consent page shows the agent label', /Allow .*Consent Probe.* to use your agent-ctx memory\?/.test(text), text.slice(0, 80));
    check('the consent page shows the redirect host', text.includes(`127.0.0.1:${ear.port}`) || text.includes('127.0.0.1'));
    check('the consent page shows the loopback warning', /This sends access to an app on this computer/.test(text));
    const csp = (await page.request.get(page.url()).then((r) => r.headers()['content-security-policy']).catch(() => '')) ?? '';
    const allow = await decide(page, 'Allow', () => ear.hits.find((u) => u.searchParams.get('state') === 'allow-loop'));
    const code = allow.hit?.searchParams.get('code');
    check('Allow reaches the loopback listener with a code', !!code, `landed on ${allow.url.slice(0, 60)}${allow.notes.length ? `, console ${allow.notes.join(' | ')}` : ''}`);

    await page.goto(authorizeUrl(a, loop, 'deny-loop'));
    await signInIfAsked(page, name);
    const deny = await decide(page, 'Deny', () => ear.hits.find((u) => u.searchParams.get('state') === 'deny-loop'));
    check('Deny reaches the loopback listener with access_denied', deny.hit?.searchParams.get('error') === 'access_denied', `landed on ${deny.url.slice(0, 60)}${deny.notes.length ? `, console ${deny.notes.join(' | ')}` : ''}`);

    const c = await register(web2, 'Web Probe');
    await page.goto(authorizeUrl(c, web2, 'allow-web'));
    await signInIfAsked(page, name);
    const viaWeb = await decide(page, 'Allow', () => external.find((u) => u.searchParams.get('state') === 'allow-web'));
    check('Allow reaches an https agent callback with a code', !!viaWeb.hit?.searchParams.get('code'), `landed on ${viaWeb.url.slice(0, 60)}${viaWeb.notes.length ? `, console ${viaWeb.notes.join(' | ')}` : ''}`);

    const m = await register(loop, MARKUP);
    await page.goto(authorizeUrl(m, loop, 'markup'));
    await signInIfAsked(page, name);
    const injected = await page.evaluate(() => ({ imgs: document.querySelectorAll('img').length, bold: document.querySelectorAll('b').length, pwned: !!window.__pwned }));
    const shown = await page.locator('strong').allInnerTexts();
    check('every client string is escaped', injected.imgs === 0 && injected.bold === 0 && !injected.pwned && shown.some((s) => s.includes('<img src=x') && s.includes('<b>Probe</b>')), JSON.stringify(injected));
    console.log(`NOTE ${engine} consent policy ${csp}`);
    void html;

    const origin = (u) => new URL(u).origin;
    proposed = `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${origin(loop)}; frame-ancestors 'none'`;
    await page.goto(authorizeUrl(a, loop, 'allow-fixed'));
    await signInIfAsked(page, name);
    const fixed = await decide(page, 'Allow', () => ear.hits.find((u) => u.searchParams.get('state') === 'allow-fixed'));
    check(`with form-action 'self' plus the redirect origin, Allow reaches the listener`, !!fixed.hit?.searchParams.get('code'), fixed.notes.join(' | '));
    await page.goto(authorizeUrl(a, loop, 'deny-fixed'));
    await signInIfAsked(page, name);
    const fixedDeny = await decide(page, 'Deny', () => ear.hits.find((u) => u.searchParams.get('state') === 'deny-fixed'));
    check(`with the same change, Deny reaches the listener`, fixedDeny.hit?.searchParams.get('error') === 'access_denied', fixedDeny.notes.join(' | '));
    proposed = `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${origin(web2)}; frame-ancestors 'none'`;
    await page.goto(authorizeUrl(c, web2, 'web-fixed'));
    await signInIfAsked(page, name);
    const fixedWeb = await decide(page, 'Allow', () => external.find((u) => u.searchParams.get('state') === 'web-fixed'));
    check(`with the same change, Allow reaches an https callback`, !!fixedWeb.hit?.searchParams.get('code'), fixedWeb.notes.join(' | '));
    proposed = null;
  } finally {
    await ctx.close();
    await ear.close();
  }
}

const dir = mkdtempSync(path.join(tmpdir(), 'page-consent-'));
const stop = await service(dir);
const b = await browser();
try {
  await run(b, dir);
} finally {
  await b.close();
  await stop();
  rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
