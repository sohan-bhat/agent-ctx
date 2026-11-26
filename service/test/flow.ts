import { exports } from 'cloudflare:workers';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CIMD_URL, CLAUDE_CODE_URL } from './outbound.ts';

export const ORIGIN = 'http://localhost:8790';
export const RESOURCE = `${ORIGIN}/mcp`;

export type Fetch = (input: string | Request, init?: RequestInit) => Promise<Response>;
export const send: Fetch = (input, init) => exports.default.fetch(typeof input === 'string' ? new Request(input.startsWith('http') ? input : `${ORIGIN}${input}`, init) : input);

export class Jar {
  map = new Map<string, string>();
  take(r: Response): Response {
    for (const c of r.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const gone = attrs.some((a) => /max-age=0\b/i.test(a.trim())) || value === '';
      if (gone) this.map.delete(name);
      else this.map.set(name, value);
    }
    return r;
  }
  header(): string {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  has(name: string): boolean {
    return this.map.has(name);
  }
}

export async function devSignIn(name: string, jar = new Jar()): Promise<Jar> {
  const r = await send('/login/dev', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name, return: '/' }),
    redirect: 'manual',
  });
  if (r.status !== 302) throw new Error(`dev sign in gave ${r.status}`);
  jar.take(r);
  return jar;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export type Kind = 'dcr' | 'cimd' | 'claude-code';

export interface Tokens { access: string; refresh: string; clientId: string; redirect: string; scope: string }

export async function register(name = 'Test Agent', redirect = 'http://127.0.0.1:4567/callback'): Promise<string> {
  const r = await send('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirect], client_name: name, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  if (r.status !== 201) throw new Error(`register gave ${r.status} ${await r.text()}`);
  return ((await r.json()) as { client_id: string }).client_id;
}

export async function consent(jar: Jar, o: { clientId: string; redirect: string; challenge: string; scopes?: string[] }): Promise<{ page: string; status: number; handle: string }> {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: o.clientId,
    redirect_uri: o.redirect,
    scope: 'read write',
    state: 'state-1',
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    resource: RESOURCE,
  });
  const r = jar.take(await send(`/authorize?${q}`, { headers: { Cookie: jar.header() }, redirect: 'manual' }));
  const page = await r.text();
  const handle = /name="handle" value="([^"]+)"/.exec(page)?.[1] ?? '';
  return { page, status: r.status, handle };
}

export async function approve(jar: Jar, handle: string, scopes: string[], decision = 'approve'): Promise<Response> {
  const form = new URLSearchParams({ handle, decision });
  for (const s of scopes) form.append('scope', s);
  return jar.take(
    await send('/authorize', {
      method: 'POST',
      headers: { Cookie: jar.header(), 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN },
      body: form,
      redirect: 'manual',
    }),
  );
}

export async function connect(jar: Jar, kind: Kind = 'dcr', scopes = ['read', 'write'], name?: string): Promise<Tokens> {
  const redirect = kind === 'dcr' ? 'http://127.0.0.1:4567/callback' : kind === 'claude-code' ? 'http://localhost:6123/callback' : 'http://127.0.0.1:5678/callback';
  const clientId = kind === 'dcr' ? await register(name, redirect) : kind === 'cimd' ? CIMD_URL : CLAUDE_CODE_URL;
  const { verifier, challenge } = await pkce();
  const c = await consent(jar, { clientId, redirect, challenge });
  if (c.status !== 200 || !c.handle) throw new Error(`consent gave ${c.status} ${c.page.slice(0, 200)}`);
  const r = await approve(jar, c.handle, scopes);
  const location = r.headers.get('Location') ?? '';
  const code = new URL(location).searchParams.get('code');
  if (r.status !== 302 || !code) throw new Error(`approve gave ${r.status} ${location}`);
  const t = await send('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, resource: RESOURCE }),
  });
  const body = (await t.json()) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  if (!body.access_token) throw new Error(`token gave ${t.status} ${JSON.stringify(body)}`);
  return { access: body.access_token, refresh: body.refresh_token ?? '', clientId, redirect, scope: body.scope ?? '' };
}

export async function refresh(t: Tokens, fetcher: Fetch = send): Promise<Tokens> {
  const r = await fetcher('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.clientId, resource: RESOURCE }),
  });
  const body = (await r.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!body.access_token) throw new Error(`refresh gave ${r.status} ${JSON.stringify(body)}`);
  return { ...t, access: body.access_token, refresh: body.refresh_token ?? '', scope: body.scope ?? '' };
}

export type Era = 'legacy' | 'modern';

export async function mcp(token: string, era: Era = 'legacy'): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
    fetch: (u: string | URL, init?: RequestInit) => {
      const req = new Request(u, init);
      req.headers.set('Host', new URL(RESOURCE).host);
      return exports.default.fetch(req);
    },
    authProvider: { token: async () => token },
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' }, era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {});
  await client.connect(transport);
  return client;
}

export function textOf(r: unknown): string {
  const content = (r as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((c) => c.text ?? '').join('');
}

export async function agent(name: string, kind: Kind = 'dcr', scopes = ['read', 'write'], era: Era = 'legacy', clientName?: string): Promise<{ jar: Jar; tokens: Tokens; client: Client }> {
  const jar = await devSignIn(name);
  const tokens = await connect(jar, kind, scopes, clientName);
  return { jar, tokens, client: await mcp(tokens.access, era) };
}

export async function call(client: Client, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean };
  return { text: textOf(r), isError: !!r.isError };
}
