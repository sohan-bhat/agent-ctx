import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { world, repo, runHook, waitFor, workerIdle, alive, Transcript, type World } from './helpers.ts';
import { store } from '../src/core/paths.ts';
import { enqueue, makeItem, pin, queued } from '../src/core/items.ts';
import { loadCards } from '../src/core/store.ts';

function seed(w: World) {
  const orchard = repo(w, 'orchard-planner', 'git@github.com:someone/orchard-planner.git');
  const site = repo(w, 'orchard-site', 'git@github.com:someone/orchard-planner.git');
  const garden = repo(w, 'garden', 'git@github.com:someone/garden.git');
  for (const d of [orchard, site, garden]) fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.writeFileSync(path.join(site, 'src', 'FrostMap.tsx'), 'x');
  const a = new Transcript(w.claude, orchard, { start: Date.parse('2026-11-18T09:00:00Z') });
  a.prompt('Build the frost map switch for the orchard planner');
  a.edit(path.join(orchard, 'src/FrostMap.tsx'));
  a.edit(path.join(orchard, 'src/OrchardKit.tsx'));
  a.title('Frost map switch for orchard planner');
  a.compact(160000, 22000, [], 'Built a frost map switch with a cool blue scale. The orchard kit now places trees.');
  a.prompt('Make the frost colours sit behind a switch that starts off');
  a.save();
  const b = new Transcript(w.claude, garden, { start: Date.parse('2026-11-19T09:00:00Z') });
  b.prompt('Plan tomato beds for spring');
  b.edit(path.join(garden, 'src/beds.py'));
  b.title('Tomato bed planner');
  b.save();
  const c = new Transcript(w.claude, site, { start: Date.parse('2026-11-20T09:00:00Z') });
  c.prompt('Write the site copy for the orchard site');
  c.edit(path.join(site, 'src/FrostMap.tsx'));
  c.title('Site copy');
  c.save();
  return { orchard, site, garden, a, b, c };
}

async function indexByHooks(w: World, ts: Transcript[]) {
  for (const t of ts) {
    const r = runHook(w, 'session-end', { session_id: t.id, transcript_path: t.file, cwd: t.cwd, hook_event_name: 'SessionEnd', reason: 'other' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
  assert.ok(await waitFor(() => workerIdle(w)), 'worker finished');
}

test('session end hooks build cards through the detached worker', async () => {
  const w = world('hooks1');
  const { a, b, c, orchard } = seed(w);
  await indexByHooks(w, [a, b, c]);
  const cards = loadCards(store(w.ctxHome));
  assert.equal(cards.length, 3);
  const card = cards.find((x) => x.session === a.id)!;
  assert.equal(card.place, orchard);
  assert.equal(card.summaries.length, 1);
  assert.ok(fs.existsSync(path.join(w.ctxHome, 'index.json')));
});

test('session start prints fitting cards from other folders and leaves out its own', async () => {
  const w = world('hooks2');
  const { a, b, c, site } = seed(w);
  await indexByHooks(w, [a, b, c]);
  const r = runHook(w, 'session-start', { session_id: 'new-1', transcript_path: '/x', cwd: site, hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.length > 0 && r.stdout.length <= 6001);
  assert.ok(r.stdout.includes('Frost map switch for orchard planner'));
  assert.ok(!r.stdout.includes('Site copy'));
  assert.ok(!r.stdout.includes('Tomato bed planner'));
});

test('session start falls back to the newest work elsewhere', async () => {
  const w = world('hooks3');
  const { a, b, c } = seed(w);
  await indexByHooks(w, [a, b, c]);
  const lone = repo(w, 'zzz-unrelated');
  const r = runHook(w, 'session-start', { session_id: 'new-2', cwd: lone, source: 'startup' });
  assert.ok(r.stdout.includes('latest work in other folders'));
  assert.ok(r.stdout.includes('Site copy'));
});

test('prompt hook adds at most three cards above the bar and stays silent otherwise', async () => {
  const w = world('hooks4');
  const { a, b, c, garden } = seed(w);
  await indexByHooks(w, [a, b, c]);
  const hit = runHook(w, 'prompt', { session_id: 's-1', cwd: garden, prompt: 'the frost map switch in the orchard planner flickers' });
  assert.equal(hit.status, 0);
  assert.ok(hit.stdout.includes('Frost map switch for orchard planner'));
  assert.ok(hit.stdout.length <= 1501);
  const again = runHook(w, 'prompt', { session_id: 's-1', cwd: garden, prompt: 'the frost map switch in the orchard planner flickers' });
  assert.ok(!again.stdout.includes('Frost map switch for orchard planner'), 'a card is shown once per session');
  const miss = runHook(w, 'prompt', { session_id: 's-2', cwd: garden, prompt: 'what is the boiling point of water at altitude' });
  assert.equal(miss.stdout, '');
  const slash = runHook(w, 'prompt', { session_id: 's-3', cwd: garden, prompt: '/compact' });
  assert.equal(slash.stdout, '');
});

test('put back queue drains on the next prompt and after a compaction', async () => {
  const w = world('hooks5');
  const st = store(w.ctxHome);
  enqueue(st, makeItem('sess-q', 'command', 'npm test', '12 passing'));
  enqueue(st, makeItem('other', 'file', '/code/x.ts', ''));
  const r = runHook(w, 'prompt', { session_id: 'sess-q', cwd: w.code, prompt: 'carry on' });
  assert.ok(r.stdout.includes('npm test'));
  assert.ok(r.stdout.includes('12 passing'));
  assert.equal(queued(st, 'sess-q').length, 0);
  assert.equal(queued(st, 'other').length, 1);
  const r2 = runHook(w, 'prompt', { session_id: 'sess-q', cwd: w.code, prompt: 'carry on' });
  assert.equal(r2.stdout, '');
  enqueue(st, makeItem('sess-q', 'decision', 'decision', 'Use plain files for the store'));
  const r3 = runHook(w, 'session-start', { session_id: 'sess-q', cwd: w.code, source: 'compact' });
  assert.ok(r3.stdout.includes('Use plain files for the store'));
});

test('pre compact prints pinned items as an instruction to keep them', () => {
  const w = world('hooks6');
  const st = store(w.ctxHome);
  pin(st, makeItem('sess-p', 'decision', 'decision', 'Never port 4000'));
  const r = runHook(w, 'pre-compact', { session_id: 'sess-p', trigger: 'auto', custom_instructions: null });
  assert.ok(r.stdout.startsWith('Keep these pinned items'));
  assert.ok(r.stdout.includes('Never port 4000'));
  const none = runHook(w, 'pre-compact', { session_id: 'sess-none', trigger: 'manual' });
  assert.equal(none.stdout, '');
});

test('post compact stores the summary it receives', async () => {
  const w = world('hooks7');
  const { a } = seed(w);
  const r = runHook(w, 'post-compact', { session_id: a.id, transcript_path: a.file, cwd: a.cwd, trigger: 'manual', compact_summary: 'Moved the frost legend under the map and fixed contrast.' });
  assert.equal(r.status, 0);
  assert.ok(await waitFor(() => workerIdle(w) && fs.existsSync(path.join(w.ctxHome, 'cards.jsonl'))));
  const card = loadCards(store(w.ctxHome)).find((x) => x.session === a.id)!;
  assert.ok(card.summaries.some((s) => s.includes('Moved the frost legend')));
});

test('every hook exits 0 and prints nothing on any error', async () => {
  const w = world('hooks8');
  const { a, b, c, site } = seed(w);
  await indexByHooks(w, [a, b, c]);
  fs.writeFileSync(path.join(w.ctxHome, 'index.json'), '{"v":2,"terms":"x","docs":[null],"offsets":[0],"buckets":0}');
  for (const ev of ['session-start', 'prompt', 'session-end', 'pre-compact', 'post-compact', 'nonsense']) {
    const r = runHook(w, ev, { session_id: 'e', cwd: site, prompt: 'frost map', source: 'startup' });
    assert.equal(r.status, 0, ev);
    assert.equal(r.stdout, '', ev);
    assert.equal(r.stderr, '', ev);
  }
  const bad = runHook(w, 'session-start', '{not json');
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
  const log = fs.readFileSync(path.join(w.ctxHome, 'claude-ctx.log'), 'utf8');
  assert.ok(log.includes('hook session-start'));
  fs.chmodSync(w.ctxHome, 0o500);
  try {
    const ro = runHook(w, 'prompt', { session_id: 'e', cwd: site, prompt: 'frost map switch orchard planner' });
    assert.equal(ro.status, 0);
  } finally {
    fs.chmodSync(w.ctxHome, 0o700);
  }
});

test('the worker takes a lock, has a life limit and leaves no process behind', async () => {
  const w = world('worker');
  const { a, b, c } = seed(w);
  const trace = store(w.ctxHome).trace;
  for (const t of [a, b, c, a, b, c]) {
    runHook(w, 'session-end', { session_id: t.id, transcript_path: t.file, cwd: t.cwd }, { CLAUDE_CTX_TRACE: '1' });
  }
  assert.ok(await waitFor(() => workerIdle(w)));
  await new Promise((r) => setTimeout(r, 300));
  const events = fs.readFileSync(trace, 'utf8').trim().split('\n').map((l) => l.split(' '));
  let holders = 0;
  let maxHolders = 0;
  for (const [what] of events) {
    if (what === 'acquire') holders++;
    if (what === 'release') holders--;
    maxHolders = Math.max(maxHolders, holders);
  }
  assert.equal(maxHolders, 1);
  const pids = [...new Set(events.map((e) => Number(e[1])))];
  assert.ok(pids.length >= 2);
  for (const pid of pids) assert.ok(await waitFor(() => !alive(pid), 3000), `worker ${pid} still running`);
  assert.equal(loadCards(store(w.ctxHome)).length, 3);

  const big = new Transcript(w.claude, w.repos['garden']);
  const filler = 'lorem ipsum '.repeat(400);
  for (let i = 0; i < 6000; i++) big.prompt(`${i} ${filler}`);
  big.save();
  const trace2 = trace;
  fs.rmSync(trace2, { force: true });
  const t0 = Date.now();
  runHook(w, 'session-end', { session_id: big.id, transcript_path: big.file, cwd: big.cwd }, { CLAUDE_CTX_TRACE: '1', CLAUDE_CTX_WORKER_LIMIT_MS: '150' });
  assert.ok(await waitFor(() => fs.existsSync(trace2) && fs.readFileSync(trace2, 'utf8').includes('exit'), 5000));
  const ev2 = fs.readFileSync(trace2, 'utf8').trim().split('\n').map((l) => l.split(' '));
  const pid2 = Number(ev2[0][1]);
  const life = Number(ev2[ev2.length - 1][2]) - Number(ev2[0][2]);
  assert.ok(life < 1500, `worker lived ${life} ms`);
  assert.ok(Date.now() - t0 < 5000);
  assert.ok(await waitFor(() => !alive(pid2), 3000), 'limited worker still running');
  assert.ok(!fs.existsSync(path.join(w.ctxHome, 'lock')), 'lock released after the limit');
  const log = fs.readFileSync(path.join(w.ctxHome, 'claude-ctx.log'), 'utf8');
  assert.ok(log.includes('life limit'));
});
