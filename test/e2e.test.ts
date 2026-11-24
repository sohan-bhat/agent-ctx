import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { world, repo, runHook, Transcript, CLI, GUARD, waitFor } from './helpers.ts';
import { store } from '../src/core/paths.ts';
import { pinsFor, queued } from '../src/core/items.ts';

const PW = process.env.CLAUDE_CTX_PLAYWRIGHT ?? '/usr/local/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

async function browserOrNull(): Promise<any> {
  if (!fs.existsSync(PW)) return null;
  try {
    const { chromium } = await import(PW);
    return await chromium.launch({ headless: true });
  } catch {
    return null;
  }
}

test('compaction list, put back and pin, end to end through the page and the hooks', async (t) => {
  const w = world('e2e');
  const a = repo(w, 'loom');
  const tr = new Transcript(w.claude, a);
  tr.prompt('Build the loom editor. Never open port 4000 for the dev server.');
  tr.reply('On it.', { input: 10, read: 3000, write: 500, out: 120 });
  tr.read(path.join(a, 'src/forgotten.ts'), 'B'.repeat(7800), { input: 5, read: 6000, out: 30 });
  tr.bash('cargo build --release', 'error: could not compile loom', { input: 5, read: 9000, out: 20 });
  tr.reply('First pass done.', { input: 5, read: 9500, write: 100, out: 80 });
  tr.compact(9700, 2000, [], 'Started the loom editor.');
  tr.prompt('Add undo');
  tr.reply('Adding undo.', { input: 5, read: 2000, write: 300, out: 60 });
  tr.title('Loom editor');
  tr.save();

  const log = path.join(w.root, 'net.log');
  const child = spawn(process.execPath, [CLI, '--no-open'], { env: { ...w.env, NODE_OPTIONS: `--import ${GUARD}`, CLAUDE_CTX_NET_LOG: log }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  assert.ok(await waitFor(() => /http:\/\/127\.0\.0\.1:\d+\/\S+\//.test(out), 20000));
  const url = out.match(/(http:\/\/127\.0\.0\.1:\d+\/\S+\/)/)![1];
  const st = store(w.ctxHome);
  const browser = await browserOrNull();
  try {
    if (browser) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors: string[] = [];
      page.on('pageerror', (e: Error) => errors.push(String(e)));
      await page.goto(`${url}#/s/${tr.id}`);
      await page.getByRole('button', { name: /^Compaction 1/ }).click();
      await page.getByText('Left out of the summary').waitFor({ timeout: 15000 });
      const row = (text: string) => page.locator('li', { hasText: text });
      await row('cargo build --release').getByRole('button', { name: 'Put back' }).click();
      await row('cargo build --release').getByText('Queued for your next prompt').waitFor({ timeout: 10000 });
      await row('Never open port 4000').getByRole('button', { name: 'Put back' }).click();
      await row('Never open port 4000').getByText('Queued for your next prompt').waitFor({ timeout: 10000 });
      await row('forgotten.ts').getByRole('button', { name: 'Pin' }).click();
      await row('forgotten.ts').getByText('Pinned').waitFor({ timeout: 10000 });
      await page.reload();
      await page.getByRole('button', { name: /^Compaction 1/ }).click();
      await row('forgotten.ts').getByText('Pinned').waitFor({ timeout: 10000 });
      await row('cargo build --release').getByText('Queued for your next prompt').waitFor({ timeout: 10000 });
      assert.deepEqual(errors, []);
    } else {
      t.diagnostic('no headless browser found, driving the same requests the page sends');
      const post = (p: string, body: unknown) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const s: any = await (await fetch(`${url}api/session/${tr.id}`)).json();
      const dropped = s.compactions[0].dropped;
      for (const d of dropped.filter((x: any) => x.kind !== 'file')) await post('api/putback', { session: tr.id, kind: d.kind, label: d.kind === 'decision' ? 'Decision' : d.label, text: d.text });
      const f = dropped.find((x: any) => x.kind === 'file');
      await post('api/pin', { session: tr.id, kind: 'file', label: f.label, text: '' });
    }
  } finally {
    await browser?.close();
    child.kill('SIGINT');
    await new Promise((r) => child.once('exit', r));
  }

  assert.equal(queued(st, tr.id).length, 2);
  assert.equal(pinsFor(st, tr.id).length, 1);
  const p = runHook(w, 'prompt', { session_id: tr.id, cwd: a, prompt: 'keep going' });
  assert.ok(p.stdout.includes('cargo build --release'));
  assert.ok(p.stdout.includes('error: could not compile loom'));
  assert.ok(p.stdout.includes('Never open port 4000 for the dev server.'));
  assert.equal(queued(st, tr.id).length, 0);
  const pre = runHook(w, 'pre-compact', { session_id: tr.id, trigger: 'auto', custom_instructions: null });
  assert.ok(pre.stdout.includes('forgotten.ts'));
  assert.equal(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', '');
});
