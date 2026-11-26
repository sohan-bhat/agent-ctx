import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE, PLUGINS_OUT, SAY, SERVICE } from '../scripts/deploy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'deploy.mjs');
const WRANGLER = join(SERVICE, 'node_modules', '.bin', 'wrangler');
const KV = '0123456789abcdef0123456789abcdef';
const ORIGIN = 'https://agent-ctx.example';

function deploy(args: string[]): { status: number | null; out: string } {
  const home = mkdtempSync(join(tmpdir(), 'deploy-home-'));
  try {
    const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: home };
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8', timeout: 180000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function withPage(fn: () => void): void {
  const made = !existsSync(PAGE);
  if (made) {
    mkdirSync(dirname(PAGE), { recursive: true });
    writeFileSync(PAGE, '<!doctype html><title>agent-ctx</title>\n');
  }
  try {
    fn();
  } finally {
    if (made) rmSync(dirname(PAGE), { recursive: true, force: true });
    rmSync(join(ROOT, 'out'), { recursive: true, force: true });
  }
}

test('the deploy script refuses a missing page, a local or plain origin and a bad KV id', { skip: !existsSync(WRANGLER) }, () => {
  if (!existsSync(PAGE)) {
    const r = deploy(['--origin', ORIGIN, '--kv', KV, '--dry-run']);
    assert.equal(r.status, 1);
    assert.equal(r.out.trim(), SAY.page);
    assert.equal(existsSync(PLUGINS_OUT), false);
  }
  withPage(() => {
    for (const origin of ['http://agent-ctx.example', 'https://localhost:8790', 'https://127.0.0.1', 'https://agent-ctx.example/mcp']) {
      const r = deploy(['--origin', origin, '--kv', KV, '--dry-run']);
      assert.equal(r.status, 1, origin);
      assert.equal(r.out.trim(), SAY.https, origin);
    }
    const bad = deploy(['--origin', ORIGIN, '--kv', 'replace-with-the-oauth-kv-namespace-id', '--dry-run']);
    assert.equal(bad.out.trim(), SAY.kv);
    assert.equal(deploy(['--origin', ORIGIN]).out.trim(), SAY.usage);
  });
});

test('a dry run stamps the plugins and bundles the production Worker with no account', { skip: !existsSync(WRANGLER) }, () => {
  withPage(() => {
    const r = deploy(['--origin', ORIGIN, '--kv', KV, '--dry-run']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /--dry-run: exiting now/);
    assert.ok(r.out.includes(`Running wrangler deploy --config wrangler.deploy.jsonc --env production --var MCP_RESOURCE:${ORIGIN}/mcp --dry-run`), r.out);
    assert.ok(r.out.includes(KV), r.out);
    assert.equal(r.out.includes('localhost'), false, r.out);
    const manifest = JSON.parse(readFileSync(join(PLUGINS_OUT, 'claude-code', '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.equal(manifest.mcpServers['agent-ctx'].url, `${ORIGIN}/mcp`);
    assert.equal(manifest.privacyPolicyUrl, `${ORIGIN}/privacy`);
    assert.equal(existsSync(join(SERVICE, 'wrangler.deploy.jsonc')), false);
  });
});
