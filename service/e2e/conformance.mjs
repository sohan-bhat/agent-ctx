import { spawn, spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVICE = join(ROOT, 'service', 'e2e', 'lib.mjs');
const PUBLIC = join(ROOT, 'service', 'public');
const BIN = join(ROOT, 'service', 'node_modules', '.bin', 'conformance');
export const BASELINE = join(ROOT, 'service', 'conformance-baseline.yml');
export const REVISIONS = ['2025-11-25', '2026-07-28'];
const UPSTREAM = { host: 'localhost', port: 8790 };

function service(cmd, dir) {
  const r = spawnSync(process.execPath, [SERVICE, cmd, dir], { encoding: 'utf8', env: process.env, timeout: 180000 });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`.trim() };
}

export function withToken(token, upstream = UPSTREAM) {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const port = server.address().port;
      const own = req.headers.host === `localhost:${port}` || req.headers.host === `127.0.0.1:${port}`;
      const headers = { ...req.headers, host: own ? `${upstream.host}:${upstream.port}` : req.headers.host, authorization: `Bearer ${token}` };
      const up = request({ ...upstream, method: req.method, path: req.url, headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(up);
    });
    server.listen(0, '127.0.0.1', () => done({ port: server.address().port, close: () => new Promise((r) => server.close(() => r())) }));
  });
}

function run(args, onText) {
  return new Promise((done) => {
    const child = spawn(BIN, args, { env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (d) => {
      out += d;
      onText?.(out);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => child.kill('SIGTERM'), 20 * 60000);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, out });
    });
  });
}

function summary(out) {
  const lines = out.split('\n');
  const at = lines.findIndex((l) => /^(=== |)?(SUMMARY|Summary)/.test(l.trim()) || /Total:|Scenarios:/.test(l));
  return (at >= 0 ? lines.slice(at) : lines.slice(-25)).join('\n').trim();
}

const CALLBACK_PORT = 42301;
const send = (path, init) => fetch(`http://${UPSTREAM.host}:${UPSTREAM.port}${path}`, { redirect: 'manual', ...init });

async function authorization(jar, reports) {
  const redirect = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
  const reg = await send('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirect], client_name: 'Conformance Authorization', token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  if (reg.status !== 201) throw new Error(`Registration for the authorization run gave ${reg.status}.`);
  const clientId = (await reg.json()).client_id;
  let approved = false;
  let failure = null;
  const approve = async (address) => {
    try {
      const page = jar.take(await send(address.replace(`http://${UPSTREAM.host}:${UPSTREAM.port}`, ''), { headers: { Cookie: jar.header() } }));
      const handle = /name="handle" value="([^"]+)"/.exec(await page.text())?.[1];
      if (page.status !== 200 || !handle) throw new Error(`The consent page gave ${page.status}.`);
      const form = new URLSearchParams({ handle, decision: 'approve' });
      form.append('scope', 'read');
      form.append('scope', 'write');
      const ok = jar.take(await send('/authorize', { method: 'POST', redirect: 'manual', headers: { Cookie: jar.header(), 'Content-Type': 'application/x-www-form-urlencoded', Origin: `http://${UPSTREAM.host}:${UPSTREAM.port}` }, body: form }));
      const back = ok.headers.get('Location');
      if (ok.status !== 302 || !back) throw new Error(`Approval gave ${ok.status}.`);
      await fetch(back);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  };
  const r = await run(['authorization', '--url', `http://${UPSTREAM.host}:${UPSTREAM.port}`, '--client-id', clientId, '--resource', `http://${UPSTREAM.host}:${UPSTREAM.port}/mcp`, '-p', String(CALLBACK_PORT), '-o', join(reports, 'authorization')], (text) => {
    const address = /^(http:\/\/localhost:8790\/authorize\?\S+)$/m.exec(text)?.[1];
    if (address && text.includes(`Callback server started`) && !approved) {
      approved = true;
      approve(address);
    }
  });
  writeFileSync(join(reports, 'authorization.txt'), r.out);
  if (failure) throw new Error(`The automated consent for the authorization run failed. ${failure}`);
  return r;
}

async function main() {
  const args = process.argv.slice(2);
  const raw = args.includes('--raw');
  const at = args.indexOf('--out');
  const out = at >= 0 && args[at + 1] ? resolve(args[at + 1]) : null;
  const dir = mkdtempSync(join(tmpdir(), 'agent-ctx-conformance-'));
  const reports = out ?? join(dir, 'reports');
  mkdirSync(reports, { recursive: true });
  process.env.WRANGLER_LOG_PATH = join(dir, 'wrangler-logs');
  process.env.DISABLE_TELEMETRY = '1';
  process.env.WRANGLER_SEND_METRICS = 'false';
  const hadPublic = existsSync(PUBLIC);
  let code = 1;
  let gate = null;
  try {
    if (!existsSync(BIN)) throw new Error('The conformance suite is not installed. Run npm --prefix service install first.');
    const up = service('start', dir);
    console.log(up.out);
    if (!up.ok) throw new Error('The service did not start.');
    const { devSignIn, connect } = await import('./lib.mjs');
    const jar = await devSignIn('conformance');
    const t = await connect(jar, 'Conformance Suite', 42201);
    gate = await withToken(t.access);
    const url = `http://localhost:${gate.port}/mcp`;
    console.log(`The suite reaches the service through a local relay at ${url} that adds the bearer token of a real sign in.`);
    let failed = 0;
    for (const rev of REVISIONS) {
      const flags = ['server', '--url', url, '--requirements', rev, '-o', join(reports, rev), ...(raw ? [] : ['--expected-failures', BASELINE])];
      const r = await run(flags);
      writeFileSync(join(reports, `${rev}.txt`), r.out);
      console.log(`\nRequirement set ${rev} ${raw ? 'without' : 'with'} the baseline exited ${r.code}.\n${summary(r.out)}`);
      if (r.code !== 0) failed++;
    }
    const auth = await authorization(jar, reports);
    console.log(`\nAuthorization server scenarios exited ${auth.code}.\n${summary(auth.out)}`);
    if (auth.code !== 0) failed++;
    code = failed ? 1 : 0;
  } catch (e) {
    console.log(`Conformance run failed. ${e instanceof Error ? e.message : String(e)}`);
    const log = join(dir, 'service.log');
    if (existsSync(log)) console.log(readFileSync(log, 'utf8').split('\n').slice(-30).join('\n'));
  } finally {
    if (gate) await gate.close();
    console.log(service('stop', dir).out);
    if (!hadPublic && existsSync(PUBLIC) && readdirSync(PUBLIC).length === 0) rmSync(PUBLIC, { recursive: true });
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(code === 0 ? 'Conformance passed.' : 'Conformance failed.');
  process.exit(code);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
