import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { world, repo, runHook, waitFor, workerIdle, Transcript, GUARD } from './helpers.ts';
import { store } from '../src/core/paths.ts';
import { loadCards } from '../src/core/store.ts';

function guarded(root: string) {
  const log = path.join(root, 'net.log');
  return { log, env: { NODE_OPTIONS: `--import ${GUARD}`, CLAUDE_CTX_NET_LOG: log } };
}

test('the guard catches an outgoing connection', () => {
  const w = world('netctl');
  const g = guarded(w.root);
  const code = `
    const net = require('node:net');
    try { net.connect(443, 'example.com'); } catch {}
    fetch('https://example.com').catch(() => {});
    try { require('node:child_process').spawnSync('curl', ['https://example.com']); } catch {}
  `;
  spawnSync(process.execPath, ['-e', code], { env: { ...w.env, ...g.env }, encoding: 'utf8' });
  const log = fs.readFileSync(g.log, 'utf8');
  assert.match(log, / tcp /);
  assert.match(log, / fetch /);
  assert.match(log, / process curl/);
});

test('hooks and the detached worker open no outgoing connection', async () => {
  const w = world('nethooks');
  const g = guarded(w.root);
  const a = repo(w, 'solar-kiln');
  const b = repo(w, 'kiln-site');
  const t = new Transcript(w.claude, a);
  t.prompt('Model the solar kiln drying curve');
  t.edit(path.join(a, 'curve.py'));
  t.title('Solar kiln drying curve');
  t.save();
  const env = g.env;
  runHook(w, 'session-end', { session_id: t.id, transcript_path: t.file, cwd: a }, env);
  assert.ok(await waitFor(() => workerIdle(w) && fs.existsSync(path.join(w.ctxHome, 'cards.jsonl'))));
  runHook(w, 'post-compact', { session_id: t.id, transcript_path: t.file, cwd: a, compact_summary: 'Fit the kiln curve.' }, env);
  assert.ok(await waitFor(() => workerIdle(w)));
  const s = runHook(w, 'session-start', { session_id: 'n1', cwd: b, source: 'startup' }, env);
  assert.ok(s.stdout.includes('Solar kiln drying curve'));
  runHook(w, 'prompt', { session_id: 'n1', cwd: b, prompt: 'solar kiln drying curve again' }, env);
  runHook(w, 'pre-compact', { session_id: 'n1', trigger: 'auto' }, env);
  runHook(w, 'session-start', { session_id: 'n1', cwd: b, source: 'compact' }, env);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(loadCards(store(w.ctxHome)).length, 1);
  assert.equal(fs.existsSync(g.log) ? fs.readFileSync(g.log, 'utf8') : '', '');
});
