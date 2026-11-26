import { spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
  if (await up()) throw new Error('A service already answers on port 8790. Stop that one first.');
  const log = openSync(join(dir, 'service.log'), 'a');
  const env = { ...process.env, DISABLE_TELEMETRY: '1', WRANGLER_SEND_METRICS: 'false' };
  const child = spawn('npm', ['--prefix', join(ROOT, 'service'), 'run', 'dev', '--', '--var', 'DEV_LOGIN:1'], { detached: true, stdio: ['ignore', log, log], env });
  writeFileSync(join(dir, 'service.pid'), String(child.pid));
  child.unref();
  for (let i = 0; i < 120; i++) {
    if (await up()) return child.pid;
    await sleep(1000);
  }
  throw new Error('The service did not answer within two minutes. Read service.log.');
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

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (main) {
  const [cmd, dir] = process.argv.slice(2);
  if ((cmd !== 'start' && cmd !== 'stop') || !dir) {
    console.log('Give start or stop and a folder for the log and the pid, as in node test-e2e/service.mjs start /tmp/run');
    process.exit(cmd ? 1 : 0);
  }
  try {
    if (cmd === 'start') console.log(`The service answers at ${ORIGIN} with pid group ${await start(dir)}.`);
    else console.log((await stop(dir)) ? 'The service stopped.' : 'No service from this folder was running.');
  } catch (e) {
    console.log(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
