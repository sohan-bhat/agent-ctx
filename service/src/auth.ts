import { Hono, type Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { AuthorizationError, CimdFetchError, type AuthRequest, type ConsentDescription, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { labelFor } from './agents.ts';

export type AppEnv = { Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } };
export type AppContext = Context<AppEnv>;
export interface Who { person: string; login: string }
export interface Props { person: string; login: string; label: string; grant: string }

const SESSION = 'session';
const LOGIN = 'login';
const SESSION_AGE = 30 * 86400;
const LOGIN_AGE = 600;
const PERSON = /^(?:gh|dev)-[A-Za-z0-9._-]{1,60}$/;
const UA = 'agent-ctx';

export function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function serviceOrigin(env: Env): string {
  return new URL(env.MCP_RESOURCE).origin;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function random(n = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

async function challenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

async function same(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(x, y) && a.length === b.length;
}

function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: true, sameSite: 'Lax' as const, path: '/', maxAge, prefix: 'host' as const };
}

function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function html(body: string, title: string, headers?: Headers, status = 200): Response {
  const h = headers ?? new Headers();
  h.set('Content-Type', 'text/html; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set('X-Frame-Options', 'DENY');
  h.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head><body>${body}</body></html>`, { status, headers: h });
}

function returnPath(v: string | undefined | null): string {
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return '/';
  return v;
}

export async function who(c: Context): Promise<Who | null> {
  const v = await getSignedCookie(c, (c.env as Env).COOKIE_KEY, SESSION, 'host');
  if (!v) return null;
  try {
    const s = JSON.parse(v) as { p?: unknown; l?: unknown; t?: unknown };
    if (typeof s.p !== 'string' || !PERSON.test(s.p) || typeof s.l !== 'string' || typeof s.t !== 'number') return null;
    if (Date.now() - s.t > SESSION_AGE * 1000) return null;
    return { person: s.p, login: s.l };
  } catch {
    return null;
  }
}

export function locationHint(cf: IncomingRequestCfProperties | undefined): DurableObjectLocationHint | undefined {
  const continent = cf?.continent;
  const lon = Number(cf?.longitude);
  const country = cf?.country;
  if (country && ['AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'IL', 'JO', 'IQ', 'IR'].includes(country)) return 'me';
  if (continent === 'NA') return Number.isFinite(lon) && lon < -100 ? 'wnam' : 'enam';
  if (continent === 'SA') return 'sam';
  if (continent === 'EU') return Number.isFinite(lon) && lon > 20 ? 'eeur' : 'weur';
  if (continent === 'AF') return 'afr';
  if (continent === 'OC') return 'oc';
  if (continent === 'AS') {
    if (Number.isFinite(lon) && lon > 125) return 'apac-ne';
    return 'apac';
  }
  return undefined;
}

async function signIn(c: AppContext, who: Who, to: string): Promise<Response> {
  const hint = locationHint(c.req.raw.cf as IncomingRequestCfProperties | undefined);
  const stub = c.env.PERSON.getByName(who.person, hint ? { locationHint: hint } : undefined);
  await stub.me();
  await setSignedCookie(c, SESSION, JSON.stringify({ p: who.person, l: who.login, t: Date.now() }), c.env.COOKIE_KEY, cookieOptions(SESSION_AGE));
  return c.redirect(returnPath(to), 302);
}

function sameOrigin(c: AppContext): boolean {
  return c.req.header('Origin') === serviceOrigin(c.env);
}

function devForm(to: string): string {
  return `<h1>Sign in for local work</h1><form method="post" action="/login/dev"><input type="hidden" name="return" value="${escape(to)}"><p><label>Name <input name="name" required pattern="[a-z0-9-]{1,40}" autocomplete="username"></label></p><p><button>Sign in</button></p></form>`;
}

function authFailure(e: unknown): Response {
  if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
  if (e instanceof AuthorizationError) return plain(400, e.description);
  if (e instanceof CimdFetchError) return plain(400, 'This app could not be verified.');
  throw e;
}

function consentPage(d: ConsentDescription, label: string, handle: string): string {
  const name = escape(label);
  const origin = d.clientDomain ? `<p>Published by <strong>${escape(d.clientDomain)}</strong>.</p>` : '<p>This app registered itself. Its name is not verified.</p>';
  const loop = d.redirectIsLoopback ? '<p><strong>This sends access to an app on this computer.</strong> Continue only if you just started signing in from it.</p>' : '';
  const scopes = [
    ['read', 'Read your memory'],
    ['write', 'Save to your memory'],
  ]
    .filter(([s]) => d.scope.includes(s))
    .map(([s, text]) => `<p><label><input type="checkbox" name="scope" value="${escape(s)}" checked> ${escape(text)}</label></p>`)
    .join('');
  return `<h1>Allow ${name} to use your agent-ctx memory?</h1>${origin}<p>The app calls itself <strong>${escape(d.clientName)}</strong>. Access goes to <strong>${escape(d.redirectHost)}</strong>.</p>${loop}<form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(handle)}">${scopes}<p><button name="decision" value="approve">Allow</button> <button name="decision" value="deny">Deny</button></p></form>`;
}

export const auth = new Hono<AppEnv>();

auth.get('/login', async (c) => {
  const to = returnPath(c.req.query('return'));
  if (c.env.DEV_LOGIN === '1') return html(devForm(to), 'Sign in');
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) return plain(503, 'Sign in is not set up on this server.');
  const state = random();
  const verifier = random();
  await setSignedCookie(c, LOGIN, JSON.stringify({ s: state, v: verifier, r: to, t: Date.now() }), c.env.COOKIE_KEY, cookieOptions(LOGIN_AGE));
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${serviceOrigin(c.env)}/login/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', await challenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return c.redirect(url.toString(), 302);
});

auth.post('/login/dev', async (c) => {
  if (c.env.DEV_LOGIN !== '1') return c.notFound();
  if (!sameOrigin(c)) return plain(403, 'This form only works from this site.');
  const form = await c.req.formData();
  const name = String(form.get('name') ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(name)) return plain(400, 'Use 1 to 40 lower case letters, digits or dashes.');
  return signIn(c, { person: `dev-${name}`, login: name }, String(form.get('return') ?? '/'));
});

auth.get('/login/callback', async (c) => {
  const raw = await getSignedCookie(c, c.env.COOKIE_KEY, LOGIN, 'host');
  deleteCookie(c, LOGIN, { path: '/', secure: true, prefix: 'host' });
  if (!raw) return plain(400, 'This sign in expired or came from another browser. Start again.');
  let saved: { s?: unknown; v?: unknown; r?: unknown; t?: unknown };
  try {
    saved = JSON.parse(raw);
  } catch {
    return plain(400, 'This sign in expired or came from another browser. Start again.');
  }
  if (typeof saved.s !== 'string' || typeof saved.v !== 'string' || typeof saved.t !== 'number' || Date.now() - saved.t > LOGIN_AGE * 1000) {
    return plain(400, 'This sign in expired or came from another browser. Start again.');
  }
  const state = c.req.query('state') ?? '';
  if (!(await same(state, saved.s))) return plain(400, 'This sign in does not match the one this browser started. Start again.');
  if (c.req.query('error')) return plain(400, 'The GitHub sign in was cancelled.');
  const code = c.req.query('code');
  if (!code) return plain(400, 'The GitHub answer had no code. Start again.');
  const body = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    client_secret: c.env.GITHUB_CLIENT_SECRET,
    code,
    redirect_uri: `${serviceOrigin(c.env)}/login/callback`,
    code_verifier: saved.v,
  });
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body,
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown };
  if (!tokenRes.ok || token.error || typeof token.access_token !== 'string') return plain(400, 'This sign in was not accepted. Start again.');
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': UA, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  const user = (await userRes.json().catch(() => ({}))) as { id?: unknown; login?: unknown };
  if (!userRes.ok || !Number.isSafeInteger(user.id) || (user.id as number) <= 0 || typeof user.login !== 'string') return plain(502, 'The GitHub account could not be read. Try again.');
  return signIn(c, { person: `gh-${user.id}`, login: user.login.slice(0, 40) }, typeof saved.r === 'string' ? saved.r : '/');
});

function signOut(c: AppContext): Response {
  deleteCookie(c, SESSION, { path: '/', secure: true, prefix: 'host' });
  return c.redirect('/', 302);
}

auth.get('/logout', (c) => signOut(c));

auth.post('/logout', (c) => (sameOrigin(c) ? signOut(c) : plain(403, 'This form only works from this site.')));

auth.get('/authorize', async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  try {
    const request: AuthRequest = await oauth.parseAuthRequest(c.req.raw);
    const me = await who(c);
    if (!me) {
      const url = new URL(c.req.url);
      return c.redirect(`/login?return=${encodeURIComponent(url.pathname + url.search)}`, 302);
    }
    const details = await oauth.describeConsent(request);
    const consent = await oauth.beginConsent(request);
    const label = labelFor({ clientId: details.clientId, clientName: details.clientName, redirectUri: details.redirectUri });
    return html(consentPage(details, label, consent.handle), `Allow ${label}`, consent.headers);
  } catch (e) {
    return authFailure(e);
  }
});

auth.post('/authorize', async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  const me = await who(c);
  if (!me) return plain(400, 'Sign in first, then start again from the agent.');
  try {
    const form = await c.req.raw.clone().formData();
    const handle = String(form.get('handle') ?? '');
    const scope = form
      .getAll('scope')
      .map(String)
      .filter((s) => s === 'read' || s === 'write');
    if (form.get('decision') !== 'approve' || !scope.length) {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope });
    const details = await oauth.describeConsent(approved.request);
    const label = labelFor({ clientId: details.clientId, clientName: details.clientName, redirectUri: details.redirectUri });
    const props: Props = { person: me.person, login: me.login, label, grant: random(18) };
    const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: me.person, metadata: { label }, scope: approved.request.scope, props });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (e) {
    return authFailure(e);
  }
});
