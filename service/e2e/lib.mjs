import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ORIGIN = 'http://localhost:8790';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up() {
  try {
    const r = await fetch(`${ORIGIN}/.well-known/oauth-authorization-server`);
    return r.ok;
  } catch {
    return false;
  }
}

async function start(dir) {
  if (await up()) throw new Error('Port 8790 is already in use by a service. Stop that service first.');
  const log = openSync(join(dir, 'service.log'), 'a');
  const env = { ...process.env, DISABLE_TELEMETRY: '1', WRANGLER_SEND_METRICS: 'false' };
  const child = spawn('npm', ['--prefix', join(ROOT, 'service'), 'run', 'dev', '--', '--persist-to', join(dir, 'state'), '--var', 'DEV_LOGIN:1'], { detached: true, stdio: ['ignore', log, log], env });
  writeFileSync(join(dir, 'service.pid'), String(child.pid));
  child.unref();
  for (let i = 0; i < 120; i++) {
    if (await up()) return child.pid;
    await sleep(1000);
  }
  throw new Error('No answer came from the service within two minutes. Read service.log.');
}

async function stop(dir) {
  const file = join(dir, 'service.pid');
  if (!existsSync(file)) return false;
  const pid = Number(readFileSync(file, 'utf8'));
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    rmSync(file, { force: true });
    return false;
  }
  for (let i = 0; i < 30 && (await up()); i++) await sleep(500);
  try {
    process.kill(-pid, 0);
    process.kill(-pid, 'SIGKILL');
  } catch {
    rmSync(file, { force: true });
    return true;
  }
  rmSync(file, { force: true });
  return true;
}

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
  if (r.status !== 302) throw new Error(`The dev sign in ended with status ${r.status}.`);
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
  if (reg.status !== 201) throw new Error(`The registration ended with status ${reg.status}.`);
  const clientId = (await reg.json()).client_id;
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: 'read write', state: 'e2e', code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE });
  const page = jar.take(await send(`/authorize?${q}`, { headers: { Cookie: jar.header() } }));
  const text = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(text)?.[1];
  if (page.status !== 200 || !handle) throw new Error(`The consent page came back with status ${page.status}.`);
  const label = /<h1>Allow (.+?) to use/.exec(text)?.[1] ?? '';
  const form = new URLSearchParams({ handle, decision: 'approve' });
  form.append('scope', 'read');
  form.append('scope', 'write');
  const ok = jar.take(await send('/authorize', { method: 'POST', headers: { Cookie: jar.header(), 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN }, body: form }));
  const code = new URL(ok.headers.get('Location') ?? '', ORIGIN).searchParams.get('code');
  if (ok.status !== 302 || !code) throw new Error(`The approval ended with status ${ok.status}.`);
  const t = await send('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, resource: RESOURCE }),
  });
  const body = await t.json();
  if (!body.access_token) throw new Error(`The token call ended with status ${t.status}.`);
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

let id = 0;

async function rpc(token, session, body) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' };
  if (session) headers['Mcp-Session-Id'] = session;
  const r = await fetch(RESOURCE, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  const data = text.startsWith('{') ? text : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop() ?? '';
  return { status: r.status, session: r.headers.get('Mcp-Session-Id') ?? session, json: data ? JSON.parse(data) : null };
}

export async function open(token) {
  const init = await rpc(token, null, { jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e-probe', version: '1.0.0' } } });
  if (init.status !== 200) throw new Error(`initialize ended with status ${init.status}`);
  await rpc(token, init.session, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    async call(name, args) {
      const r = await rpc(token, init.session, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
      const res = r.json?.result ?? {};
      return { text: (res.content ?? []).map((c) => c.text ?? '').join(''), isError: !!res.isError, error: r.json?.error };
    },
    async list() {
      const r = await rpc(token, init.session, { jsonrpc: '2.0', id: ++id, method: 'tools/list', params: {} });
      return r.json?.result?.tools ?? [];
    },
  };
}

async function serviceCommand(argv) {
  const [cmd, dir] = argv;
  if ((cmd !== 'start' && cmd !== 'stop') || !dir) {
    console.log('Give start or stop and a folder for the log and the pid, as in node service/e2e/lib.mjs start /tmp/run');
    process.exit(cmd ? 1 : 0);
  }
  try {
    if (cmd === 'start') console.log(`The service is up at ${ORIGIN} with pid group ${await start(dir)}.`);
    else console.log((await stop(dir)) ? 'The service stopped.' : 'No service from this folder was running.');
  } catch (e) {
    console.log(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

async function signInCommand(argv) {
  const [person, out] = argv;
  if (!person || !out) {
    console.log('Give a dev person name and a file for the secrets, as in node service/e2e/lib.mjs sign-in relay-e2e /tmp/run/secrets.json');
    process.exit(person ? 1 : 0);
  }
  const jar = await devSignIn(person);
  const a = await connect(jar, 'Claude Code', 41001);
  const b = await connect(jar, 'Codex', 41002);
  writeFileSync(out, JSON.stringify({ person: `dev-${person}`, cookie: jar.header(), A: a, B: b }, null, 2), { mode: 0o600 });
  console.log(`Two agents of dev-${person} are signed in. Side A appears as ${a.label} and side B as ${b.label}, with scopes ${a.scope} and ${b.scope}.`);
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'start' || cmd === 'stop') await serviceCommand([cmd, ...rest]);
  else if (cmd === 'sign-in') await signInCommand(rest);
  else {
    console.log('Give start or stop and a folder for the log and the pid, as in node service/e2e/lib.mjs start /tmp/run, or sign-in with a dev person name and a file for the secrets, as in node service/e2e/lib.mjs sign-in relay-e2e /tmp/run/secrets.json');
    process.exit(cmd ? 1 : 0);
  }
}
