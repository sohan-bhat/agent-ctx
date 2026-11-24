import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, world, repo, Transcript, waitFor, workerIdle } from './helpers.ts';
import { EVENTS } from '../src/core/install.ts';

const plugin = path.join(ROOT, 'plugin');
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('the plugin folder follows the documented layout', () => {
  const manifest = read(path.join(plugin, '.claude-plugin', 'plugin.json'));
  assert.equal(manifest.name, 'ctx');
  assert.match(manifest.name, /^[a-z0-9-]+$/);
  const words = manifest.name.toLowerCase().split(/[^a-z0-9]+/);
  assert.ok(!/^(claude|anthropics?|cc-plugin)[^a-z0-9]/i.test(manifest.name), 'name avoids the reserved prefixes');
  assert.ok(!words.some((x: string) => ['claude', 'anthropic', 'anthropics'].includes(x)), 'name avoids the reserved words');
  assert.ok(manifest.version && manifest.description && manifest.author?.name);
  const market = read(path.join(ROOT, '.claude-plugin', 'marketplace.json'));
  assert.ok(market.name && market.owner?.name && Array.isArray(market.plugins));
  const entry = market.plugins.find((p: any) => p.name === manifest.name);
  assert.ok(entry, 'marketplace entry name matches the manifest name');
  assert.ok(entry.source.startsWith('./') && !entry.source.includes('..'));
  assert.ok(fs.existsSync(path.join(ROOT, entry.source, '.claude-plugin', 'plugin.json')));
  const hooks = read(path.join(plugin, 'hooks', 'hooks.json'));
  assert.ok(hooks.hooks, 'hooks file wraps the event map in a hooks key');
  for (const [event, arg] of EVENTS) {
    const cmd: string = hooks.hooks[event]?.[0]?.hooks?.[0]?.command;
    assert.equal(cmd, `node "\${CLAUDE_PLUGIN_ROOT}/scripts/hook.js" ${arg}`, event);
  }
  for (const f of ['hook.js', 'worker.js', 'cli.js']) assert.ok(fs.existsSync(path.join(plugin, 'scripts', f)), f);
  const skill = fs.readFileSync(path.join(plugin, 'skills', 'recall', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: recall\ndescription: .+\n---\n/);
  const dist = path.join(ROOT, 'dist', 'hook.js');
  if (fs.existsSync(dist)) assert.equal(fs.readFileSync(path.join(plugin, 'scripts', 'hook.js'), 'utf8'), fs.readFileSync(dist, 'utf8'), 'plugin scripts match the build');
});

test('the plugin hooks run the way Claude Code runs them', async () => {
  const w = world('plugin');
  const a = repo(w, 'glaze-calc');
  const b = repo(w, 'glaze-site');
  const t = new Transcript(w.claude, a);
  t.prompt('Compute glaze recipes by unity molecular formula');
  t.edit(path.join(a, 'umf.py'));
  t.title('Glaze UMF calculator');
  t.save();
  const run = (cmd: string, input: unknown) =>
    spawnSync('/bin/sh', ['-c', cmd.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, '$CLAUDE_PLUGIN_ROOT')], {
      input: JSON.stringify(input),
      env: { ...w.env, CLAUDE_PLUGIN_ROOT: plugin },
      encoding: 'utf8',
    });
  const hooks = read(path.join(plugin, 'hooks', 'hooks.json')).hooks;
  const end = run(hooks.SessionEnd[0].hooks[0].command, { session_id: t.id, transcript_path: t.file, cwd: a, hook_event_name: 'SessionEnd', reason: 'other' });
  assert.equal(end.status, 0);
  assert.ok(await waitFor(() => workerIdle(w) && fs.existsSync(path.join(w.ctxHome, 'cards.jsonl'))));
  const start = run(hooks.SessionStart[0].hooks[0].command, { session_id: 'p2', cwd: b, hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(start.status, 0);
  assert.ok(start.stdout.includes('Glaze UMF calculator'));
  const search = spawnSync(process.execPath, [path.join(plugin, 'scripts', 'cli.js'), 'search', 'glaze', 'formula'], { env: w.env, encoding: 'utf8' });
  assert.ok(search.stdout.includes('Glaze UMF calculator'));
});
