import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { world, repo, Transcript } from './helpers.ts';
import { advance, newAnalyzer, largest, decisions, fileNamed, commandNamed, normalizeCommand } from '../src/core/context.ts';

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
