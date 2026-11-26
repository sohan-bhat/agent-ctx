import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE = join(ROOT, 'test-e2e', 'service.mjs');
const PUBLIC = join(ROOT, 'service', 'public');

function service(cmd, dir) {
  const r = spawnSync(process.execPath, [SERVICE, cmd, dir], { encoding: 'utf8', env: process.env, timeout: 180000 });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`.trim() };
}

async function check() {
  const { devSignIn, connect } = await import('./oauth.mjs');
  const { open } = await import('./mcp.mjs');
  const wellKnown = await (await fetch('http://localhost:8790/.well-known/oauth-authorization-server')).json();
  if (!wellKnown.registration_endpoint || !wellKnown.client_id_metadata_document_supported) throw new Error('The well known document lacks registration or metadata document support.');
  const jar = await devSignIn('real-run');
  const a = await connect(jar, 'Real Probe One', 42101);
  const b = await connect(jar, 'Real Probe Two', 42102);
  if (a.scope !== 'read write' || b.scope !== 'read write') throw new Error(`Scopes were ${a.scope} and ${b.scope}.`);
  const one = await open(a.access);
  const loaded = (await one.list()).filter((t) => t._meta?.['anthropic/alwaysLoad'] === true).map((t) => t.name).sort();
  if (loaded.join(' ') !== 'checkpoint recall') throw new Error(`tools/list marked ${loaded.join(' and ') || 'no tool'} to load without a search.`);
  const saved = await one.call('checkpoint', { folder: '/work/real-run', goal: 'Real runtime probe card' });
  if (saved.isError || saved.error) throw new Error(`The checkpoint call failed with ${saved.text || JSON.stringify(saved.error)}.`);
  const two = await open(b.access);
  const read = await two.call('recall', { folder: '/work/real-run' });
  if (!read.text.includes('Real runtime probe card')) throw new Error(`The recall call did not return the card, it gave ${read.text.slice(0, 200)}.`);
  return `Two dynamic clients signed in as ${a.label} and ${b.label}, tools/list marked ${loaded.join(' and ')} to load without a search, one saved a checkpoint and the other read it back.`;
}

const dir = mkdtempSync(join(tmpdir(), 'agent-ctx-real-'));
process.env.WRANGLER_LOG_PATH = join(dir, 'wrangler-logs');
process.env.DISABLE_TELEMETRY = '1';
process.env.WRANGLER_SEND_METRICS = 'false';
const hadPublic = existsSync(PUBLIC);
let code = 1;
try {
  const up = service('start', dir);
  console.log(up.out);
  if (!up.ok) throw new Error('The service did not start.');
  console.log(await check());
  code = 0;
} catch (e) {
  console.log(`Real runtime check failed. ${e instanceof Error ? e.message : String(e)}`);
  const log = join(dir, 'service.log');
  if (existsSync(log)) console.log(readFileSync(log, 'utf8').split('\n').slice(-30).join('\n'));
} finally {
  console.log(service('stop', dir).out);
  const logs = join(dir, 'wrangler-logs');
  console.log(`Wrangler wrote ${existsSync(logs) ? readdirSync(logs).length : 0} log files under the temp folder.`);
  if (!hadPublic && existsSync(PUBLIC) && readdirSync(PUBLIC).length === 0) rmSync(PUBLIC, { recursive: true });
  rmSync(dir, { recursive: true, force: true });
}
console.log(code === 0 ? 'Real runtime check passed.' : 'Real runtime check failed.');
process.exit(code);
