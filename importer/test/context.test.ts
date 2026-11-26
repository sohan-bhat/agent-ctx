import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { world, repo, Transcript } from './helpers.ts';
import { advance, newAnalyzer, largest, decisions, fileNamed, commandNamed, normalizeCommand, timeline, MAX_STEPS, type Span, type Timeline } from '../src/core/context.ts';

function build() {
  const w = world('ctx');
  const a = repo(w, 'loom');
  const t = new Transcript(w.claude, a);
  t.shape([{ type: 'text', text: 'S'.repeat(2600) }], [{ name: 'Read', input_schema: {} }]);
  t.prompt('Build the loom pattern editor. Always use plain files for the store. Never open port 4000 for the dev server.');
  t.reply('On it.', { input: 10, read: 3000, write: 500, out: 120 });
  t.read(path.join(a, 'src/named.ts'), 'A'.repeat(5200), { input: 5, read: 3600, out: 30 });
  t.read(path.join(a, 'src/forgotten.ts'), 'B'.repeat(7800), { input: 5, read: 6000, out: 30 });
  const kept = t.read(path.join(a, 'src/kept.ts'), 'C'.repeat(2600), { input: 5, read: 9000, out: 30 });
  t.bash('npm test', '12 passing', { input: 5, read: 10000, out: 20 });
  t.bash('cargo build --release', 'error[E0425]: cannot find value `grid` in this scope', { input: 5, read: 10100, out: 20 });
  t.reply('Done with the first pass.', { input: 5, read: 10200, write: 100, out: 80 });
  const c = t.compact(10500, 2200, [kept.use, kept.result], 'The user is building a loom pattern editor. src/named.ts holds the grid. Tests ran with npm test. The store uses plain files.');
  t.prompt('Next add undo.');
  t.reply('Adding undo.', { input: 5, read: 2200, write: 300, out: 60 });
  t.save();
  return { t, c, a };
}

test('per call totals come from the usage block and the split is an estimate', async () => {
  const { t } = build();
  const an = newAnalyzer(t.id, t.file);
  await advance(an);
  const pts = an.ctx.points;
  assert.equal(pts.length, 8);
  assert.equal(pts[0].total, 3510);
  assert.equal(pts[pts.length - 1].total, 2505);
  assert.ok(an.ctx.system.measured);
  assert.ok(pts[0].est.system > 0 && pts[0].est.prompts > 0);
  assert.ok(pts[4].est['tool:Read'] > 0);
  assert.ok(pts[6].est['tool:Bash'] > 0);
  assert.equal(pts[1].est.replies, 120);
  const after = pts[pts.length - 1];
  assert.ok(after.est.summary > 0);
  assert.equal(after.est['tool:Read'], 1000);
  assert.ok(!after.est['tool:Bash']);
  assert.equal(an.ctx.offset, (await import('node:fs')).statSync(t.file).size);
});

test('a compaction lists what was in context, is not preserved and is not named in the summary', async () => {
  const { t, a } = build();
  const an = newAnalyzer(t.id, t.file);
  await advance(an);
  assert.equal(an.ctx.compactions.length, 1);
  const c = an.ctx.compactions[0];
  assert.equal(c.pre, 10500);
  assert.equal(c.post, 2200);
  assert.equal(c.trigger, 'auto');
  assert.equal(c.preserved, 2);
  const got = c.dropped.map((d) => `${d.kind}:${d.kind === 'decision' ? d.text : d.label}`).sort();
  assert.deepEqual(got, [
    'command:cargo build --release',
    `file:${path.join(a, 'src/forgotten.ts')}`,
    'decision:Never open port 4000 for the dev server.',
  ].sort());
  const cmd = c.dropped.find((d) => d.kind === 'command')!;
  assert.equal(cmd.text, 'error[E0425]: cannot find value `grid` in this scope');
  assert.equal(cmd.error, true);
  assert.equal(c.named, 3);
  assert.deepEqual(c.dropped.map((d) => d.kind), ['decision', 'file', 'command']);
  assert.ok(c.before.length > 0);
});

test('reading in ranges by offset gives the same result as one pass', async () => {
  const { t } = build();
  const whole = newAnalyzer(t.id, t.file);
  await advance(whole);
  const fs = await import('node:fs');
  const size = fs.statSync(t.file).size;
  const parts = newAnalyzer(t.id, t.file);
  for (const cutAt of [Math.floor(size / 3), Math.floor(size / 2) + 7, size]) await advance(parts, cutAt);
  assert.deepEqual(parts.ctx.points, whole.ctx.points);
  assert.deepEqual(parts.ctx.compactions, whole.ctx.compactions);
  assert.deepEqual(largest(parts), largest(whole));
});

test('decisions come from prompt sentences with a firm verb', () => {
  assert.deepEqual(decisions('Build it. Always use plain files. The sky is blue today. Do not add a database!'), ['Always use plain files.', 'Do not add a database!']);
});

test('attachments count by kind from their rendered text', async () => {
  const { world: mk, repo: rp, Transcript: T } = await import('./helpers.ts');
  const w = mk('ctxatt');
  const a = rp(w, 'att');
  const t = new T(w.claude, a);
  t.attachment({ type: 'instructions', files: [{ path: 'CLAUDE.md' }, { path: 'MEMORY.md' }] }, 'M'.repeat(2600));
  t.attachment({ type: 'skill_listing', content: 'x' }, 'K'.repeat(1300));
  t.attachment({ type: 'hook_success', content: 'not shown' });
  t.prompt('hello');
  t.reply('hi', { input: 5, read: 100, write: 10, out: 5 });
  t.save();
  const an = newAnalyzer(t.id, t.file);
  await advance(an);
  const p = an.ctx.points[0];
  assert.equal(p.est.memory, 1000);
  assert.equal(p.est.skills, 500);
});

test('the dropped list ranks decisions, edits, large reads, then folded command output, with strict naming', async () => {
  const { world: mk, repo: rp, Transcript: T } = await import('./helpers.ts');
  const w = mk('ctxrank');
  const r = rp(w, 'tide');
  const t = new T(w.claude, r);
  t.prompt('Fix the alert window. Always keep the queue in Postgres.');
  t.read(path.join(r, 'src/alerts/window.ts'), 'A'.repeat(5200), { input: 5, read: 3000, out: 30 });
  t.read(path.join(r, 'src/queue/window.ts'), 'Q'.repeat(7800), { input: 5, read: 5000, out: 30 });
  t.read(path.join(r, 'src/data.ts'), 'D'.repeat(5460), { input: 5, read: 7000, out: 30 });
  t.read(path.join(r, 'lib/util.ts'), 'U'.repeat(3000), { input: 5, read: 8000, out: 30 });
  t.read(path.join(r, 'lib/tiny.ts'), 'T'.repeat(260), { input: 5, read: 8100, out: 30 });
  t.read(path.join(r, 'src/edited.ts'), 'E'.repeat(6000), { input: 5, read: 8200, out: 30 });
  t.edit(path.join(r, 'src/edited.ts'));
  t.edit(path.join(r, 'src/edited.ts'));
  t.edit(path.join(r, 'src/alerts/window.ts'));
  t.bash('npm test', 'ok 12 passing, 0 failed', { input: 5, read: 9000, out: 20 });
  t.bash('npm test -- queue', 'FAIL src/queue/window.test.ts', { input: 5, read: 9100, out: 20 });
  t.bash(`cd ${r} && npm run lint`, 'lint clean', { input: 5, read: 9200, out: 20 });
  t.bash(`cd ${r} && npm run lint`, 'lint clean again', { input: 5, read: 9300, out: 20 });
  t.bash('ls -la', 'total 8', { input: 5, read: 9400, out: 20 });
  t.compact(9500, 2000, [], 'Changed src/alerts/window.ts and metadata.ts. Ran npm test. util.ts was fine.');
  t.save();
  const an = newAnalyzer(t.id, t.file);
  await advance(an);
  const c = an.ctx.compactions[0];
  const got = c.dropped.map((d) => `${d.kind}:${d.kind === 'decision' ? d.text : d.kind === 'command' ? d.label : path.relative(r, d.label)}`);
  assert.deepEqual(got, [
    'decision:Always keep the queue in Postgres.',
    'edit:src/edited.ts',
    'file:src/queue/window.ts',
    'file:src/data.ts',
    'command:npm test -- queue',
    `command:cd ${r} && npm run lint`,
  ]);
  assert.equal(c.dropped.find((d) => d.kind === 'edit')!.runs, 2);
  assert.equal(c.dropped.find((d) => d.label === 'npm test -- queue')!.error, true);
  assert.equal(c.dropped.find((d) => d.label.endsWith('npm run lint'))!.runs, 2);
  assert.equal(c.commands, 3);
  assert.equal(c.smallReads, 1);
});

test('naming in the summary needs a path or a whole command, not two words', () => {
  const s = 'changed src/alerts/window.ts and metadata.ts. ran `npm test`. util.ts was fine.';
  assert.equal(fileNamed('/r/src/alerts/window.ts', s, '/r', false), true);
  assert.equal(fileNamed('/r/src/queue/window.ts', s, '/r', false), false);
  assert.equal(fileNamed('/r/src/data.ts', s, '/r', true), false);
  assert.equal(fileNamed('/r/lib/util.ts', s, '/r', true), true);
  assert.equal(fileNamed('/r/lib/util.ts', s, '/r', false), false);
  assert.equal(commandNamed('npm test', s), true);
  assert.equal(commandNamed('npm test -- queue', s), false);
  assert.equal(commandNamed('cd /r && npm test 2>&1 | tail -20', s), true);
  assert.equal(normalizeCommand('cd /a && cd b && npm run lint 2>&1 | head -50'), 'npm run lint');
});

function aliveAt(tl: Timeline, n: number): number {
  let sum = 0;
  for (const s of [...tl.closed, ...tl.live]) {
    if (s.b > n || (s.e !== undefined && n >= s.e)) continue;
    if (!s.s) sum += s.t;
    else for (let i = 0; i < s.s.length; i += 2) if (s.s[i] <= n) sum += s.s[i + 1];
  }
  return sum;
}

test('each item carries the call it entered and the compaction that removed it', async () => {
  const { t, a } = build();
  const an = newAnalyzer(t.id, t.file);
  await advance(an);
  const tl = timeline(an);
  const all = [...tl.closed, ...tl.live];
  const named = (label: string): Span => all.find((s) => s.l !== undefined && tl.labels[s.l] === label)!;
  assert.deepEqual([named(path.join(a, 'src/named.ts')).b, named(path.join(a, 'src/named.ts')).e, named(path.join(a, 'src/named.ts')).t], [2, 7, 2000]);
  assert.deepEqual([named(path.join(a, 'src/forgotten.ts')).b, named(path.join(a, 'src/forgotten.ts')).e], [3, 7]);
  const kept = named(path.join(a, 'src/kept.ts'));
  assert.deepEqual([kept.b, kept.e, kept.t], [4, undefined, 1000]);
  assert.ok(tl.live.includes(kept));
  assert.equal(named('Compaction summary').b, 7);
  assert.equal(named('Compaction summary').e, undefined);
  const sys = tl.live.find((s) => s.i === -1)!;
  assert.deepEqual([sys.b, sys.e, tl.cats[sys.c]], [0, undefined, 'system']);
  const bash = tl.closed.filter((s) => tl.cats[s.c] === 'tool:Bash');
  assert.equal(bash.length, 1);
  assert.deepEqual([bash[0].n, bash[0].b, bash[0].e, bash[0].s], [2, 5, 7, [5, bash[0].s![1], 6, bash[0].s![3]]]);
  assert.ok(tl.closed.every((s) => s.e === 7));
  for (const p of an.ctx.points) assert.equal(aliveAt(tl, p.n), p.raw, `call ${p.n}`);
});

test('the spans rebuild the estimate at every call across many turns and compactions', async () => {
  const w = world('ctxspan');
  const r = repo(w, 'kiln');
  const t = new Transcript(w.claude, r);
  t.shape([{ type: 'text', text: 'S'.repeat(5200) }], []);
  let cur = 3000;
  for (let turn = 0; turn < 12; turn++) {
    t.prompt(`Step ${turn}, keep the ramp slow.`);
    for (let k = 0; k < 9; k++) {
      cur += 400;
      if (k % 3 === 0) t.read(path.join(r, `src/ramp${(turn + k) % 5}.ts`), 'R'.repeat(1300 + 260 * k), { input: 5, read: cur, out: 40 });
      else if (k % 3 === 1) t.bash('cargo test', 'ok '.repeat(20 + k), { input: 5, read: cur, out: 30 });
      else t.reply('Ramp updated.', { input: 5, read: cur, write: 50, out: 90 });
    }
    if (turn % 4 === 3) {
      const keep = t.read(path.join(r, 'src/keep.ts'), 'K'.repeat(2600), { input: 5, read: cur, out: 30 });
      t.compact(cur, 4000, [keep.use, keep.result], 'Kiln ramp work continues in src/ramp0.ts.');
      cur = 4000;
    }
  }
  t.save();
  const an = newAnalyzer(t.id, t.file);
  await advance(an);
  const tl = timeline(an);
  assert.equal(an.ctx.compactions.length, 3);
  for (const p of an.ctx.points) assert.equal(aliveAt(tl, p.n), p.raw, `call ${p.n}`);
  const ends = new Set(tl.closed.map((s) => s.e));
  assert.deepEqual([...ends].sort((x, y) => x! - y!), an.ctx.compactions.map((c) => c.n));
  const ids = tl.live.filter((s) => s.i !== undefined).map((s) => s.i);
  assert.equal(new Set(ids).size, ids.length);
  const groups = [...tl.closed, ...tl.live].filter((s) => s.s).map((s) => `${s.c}@${s.u}/${s.e}`);
  assert.equal(new Set(groups).size, groups.length);
  const keeps = [...tl.closed, ...tl.live].filter((s) => s.l !== undefined && tl.labels[s.l] === path.join(r, 'src/keep.ts'));
  assert.ok(keeps.some((s) => s.e === undefined));
});

test('a long turn of small results folds into one span with a bounded number of steps', async () => {
  const w = world('ctxfold');
  const r = repo(w, 'loom');
  const t = new Transcript(w.claude, r);
  t.prompt('Run the grid tests until they pass.');
  for (let k = 0; k < 300; k++) t.bash('npm test -- grid', 'ok ' + 'x'.repeat(k % 40), { input: 5, read: 3000 + k * 20, out: 20 });
  t.save();
  const an = newAnalyzer(t.id, t.file);
  await advance(an);
  const tl = timeline(an);
  const bash = tl.live.filter((s) => tl.cats[s.c] === 'tool:Bash');
  assert.equal(bash.length, 1);
  assert.equal(bash[0].n, 300);
  assert.ok(bash[0].s!.length <= MAX_STEPS * 2);
  assert.equal(bash[0].s!.filter((_, i) => i % 2 === 1).reduce((x, y) => x + y, 0), bash[0].t);
  assert.equal(bash[0].b, bash[0].s![0]);
  const slack = tl.live.filter((s) => s.s).reduce((x, s) => x + Math.max(...s.s!.filter((_, i) => i % 2 === 1)), 0);
  for (const p of an.ctx.points) {
    const over = aliveAt(tl, p.n) - p.raw;
    assert.ok(over >= 0 && over <= slack, `call ${p.n} over by ${over}`);
  }
});
