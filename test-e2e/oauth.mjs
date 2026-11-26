import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN } from './service.mjs';

export const RESOURCE = `${ORIGIN}/mcp`;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export class Jar {
  map = new Map();
  take(r) {
    for (const c of r.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim())) || value === '') this.map.delete(name);
      else this.map.set(name, value);
    }
    return r;
  }
  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

const send = (path, init) => fetch(`${ORIGIN}${path}`, { redirect: 'manual', ...init });

export async function devSignIn(name) {
  const jar = new Jar();
  const r = await send('/login/dev', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name, return: '/' }) });
  if (r.status !== 302) throw new Error(`Dev sign in gave ${r.status}.`);
  jar.take(r);
  return jar;
}

export async function connect(jar, clientName, port) {
  const redirect = `http://127.0.0.1:${port}/callback`;
  const reg = await send('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirect], client_name: clientName, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  if (reg.status !== 201) throw new Error(`Registration gave ${reg.status}.`);
  const clientId = (await reg.json()).client_id;
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: 'read write', state: 'e2e', code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE });
  const page = jar.take(await send(`/authorize?${q}`, { headers: { Cookie: jar.header() } }));
  const text = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(text)?.[1];
  if (page.status !== 200 || !handle) throw new Error(`The consent page gave ${page.status}.`);
  const label = /<h1>Allow (.+?) to use/.exec(text)?.[1] ?? '';
  const form = new URLSearchParams({ handle, decision: 'approve' });
  form.append('scope', 'read');
  form.append('scope', 'write');
  const ok = jar.take(await send('/authorize', { method: 'POST', headers: { Cookie: jar.header(), 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN }, body: form }));
  const code = new URL(ok.headers.get('Location') ?? '', ORIGIN).searchParams.get('code');
  if (ok.status !== 302 || !code) throw new Error(`Approval gave ${ok.status}.`);
  const t = await send('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, resource: RESOURCE }),
  });
  const body = await t.json();
  if (!body.access_token) throw new Error(`The token call gave ${t.status}.`);
  return { label, clientId, access: body.access_token, scope: body.scope };
}

export async function page(jar, method, path, body) {
  const headers = { Cookie: jar.header(), Origin: ORIGIN };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await send(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  try {
    return { status: r.status, json: JSON.parse(text) };
  } catch {
    return { status: r.status, json: null, text };
  }
}

export function jarFrom(cookie) {
  const jar = new Jar();
  for (const part of cookie.split('; ')) {
    const at = part.indexOf('=');
    if (at > 0) jar.map.set(part.slice(0, at), part.slice(at + 1));
  }
  return jar;
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (main) {
  const [person, out] = process.argv.slice(2);
  if (!person || !out) {
    console.log('Give a dev person name and a file for the secrets, as in node test-e2e/oauth.mjs relay-e2e /tmp/run/secrets.json');
    process.exit(person ? 1 : 0);
  }
  const jar = await devSignIn(person);
  const a = await connect(jar, 'Claude Code', 41001);
  const b = await connect(jar, 'Codex', 41002);
  writeFileSync(out, JSON.stringify({ person: `dev-${person}`, cookie: jar.header(), A: a, B: b }, null, 2), { mode: 0o600 });
  console.log(`Two agents of dev-${person} are signed in. Side A shows as ${a.label} and side B as ${b.label}, scopes ${a.scope} and ${b.scope}.`);
}
