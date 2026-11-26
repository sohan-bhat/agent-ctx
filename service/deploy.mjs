import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanOrigin, stamp } from '../plugins/stamp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SERVICE = join(ROOT, 'service');
export const PAGE = join(SERVICE, 'public', 'index.html');
export const PLUGINS_OUT = join(ROOT, 'out', 'plugins');
const PLACEHOLDER = 'replace-with-the-oauth-kv-namespace-id';
const DEPLOY_CONFIG = 'wrangler.deploy.jsonc';
const LOCAL = /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$|\.localhost$/i;

export const SAY = {
  usage: 'Give --origin and --kv, as in node service/deploy.mjs --origin https://agent-ctx.example --kv KV_ID, and add --dry-run to build without uploading.',
  page: 'Build the page first, because service/public/index.html is missing.',
  https: 'The origin must start with https and must not be a local address.',
  kv: 'The KV namespace id must be the 32 letter and digit id printed by wrangler kv namespace create.',
  config: 'The production KV placeholder was not found in service/wrangler.jsonc.',
};

export function parse(argv) {
  const out = { origin: '', kv: '', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--origin') out.origin = argv[++i] ?? '';
    else if (a === '--kv') out.kv = argv[++i] ?? '';
    else return null;
  }
  return out.origin && out.kv ? out : null;
}

export function refusal(opts) {
  let origin;
  try {
    origin = cleanOrigin(opts.origin);
  } catch {
    return SAY.https;
  }
  const u = new URL(origin);
  if (u.protocol !== 'https:' || LOCAL.test(u.hostname)) return SAY.https;
  if (!/^[0-9a-f]{32}$/.test(opts.kv)) return SAY.kv;
  if (!existsSync(PAGE)) return SAY.page;
  return null;
}

export function deployConfig(kv) {
  const text = readFileSync(join(SERVICE, 'wrangler.jsonc'), 'utf8');
  if (text.split(PLACEHOLDER).length !== 2) throw new Error(SAY.config);
  return text.replace(PLACEHOLDER, kv);
}

export function run(opts, io = { log: console.log }) {
  const why = refusal(opts);
  if (why) {
    io.log(why);
    return 1;
  }
  const origin = cleanOrigin(opts.origin);
  const stamped = stamp(origin, PLUGINS_OUT);
  io.log(`Stamped ${stamped.plugins.join(' and ')} for ${origin} into ${stamped.out}.`);
  const config = join(SERVICE, DEPLOY_CONFIG);
  const outdir = opts.dryRun ? mkdtempSync(join(tmpdir(), 'agent-ctx-deploy-')) : '';
  try {
    writeFileSync(config, deployConfig(opts.kv));
    const args = ['deploy', '--config', DEPLOY_CONFIG, '--env', 'production', '--var', `MCP_RESOURCE:${origin}/mcp`];
    if (opts.dryRun) args.push('--dry-run', '--outdir', outdir);
    io.log(`Running wrangler ${args.join(' ')} in ${SERVICE}.`);
    const r = spawnSync(join(SERVICE, 'node_modules', '.bin', 'wrangler'), args, {
      cwd: SERVICE,
      stdio: 'inherit',
      env: { ...process.env, DISABLE_TELEMETRY: '1', WRANGLER_SEND_METRICS: 'false' },
    });
    return r.status ?? 1;
  } finally {
    rmSync(config, { force: true });
    if (outdir) rmSync(outdir, { recursive: true, force: true });
  }
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (main) {
  const opts = parse(process.argv.slice(2));
  if (!opts) {
    console.log(SAY.usage);
    process.exit(process.argv.length > 2 ? 1 : 0);
  }
  process.exit(run(opts));
}
