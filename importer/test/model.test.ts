import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { world, repo, Transcript, ROOT } from './helpers.ts';
import { advance, newAnalyzer, timeline } from '../src/context.ts';

const ready = fs.existsSync(path.join(ROOT, 'web', 'node_modules', 'd3-hierarchy'));
const m = ready ? await import('../../web/src/lib/model.ts') : null;
type Row = { id: string; own: number; kept?: number; children?: Row[] };
const view: { treeOf: (pieces: unknown[], withKept?: boolean) => Row } | null = ready ? await import(path.join(ROOT, 'web', 'src', 'lib', 'context.ts')) : null;
const skip = ready ? false : 'the page dependencies are not installed';

const line = {
  cats: ['system', 'tool:Read', 'replies', 'summary'],
  labels: ['System prompt', '/r/a.ts', '/r/b.ts', 'Compaction summary'],
  closed: [
    { b: 2, e: 7, c: 1, l: 1, t: 2000 },
    { b: 3, e: 7, c: 1, l: 2, t: 3000 },
    { b: 1, e: 7, c: 2, t: 300, u: 1, n: 3, s: [1, 100, 3, 100, 5, 100] },
  ],
  live: [
    { b: 0, c: 0, l: 0, t: 5000, i: -1 },
    { b: 4, c: 1, l: 1, t: 1000, i: 9 },
    { b: 7, c: 3, l: 3, t: 800, i: 12 },
  ],
};

test('the model at a call holds exactly the items alive at that call', { skip }, () => {
  const at = (n: number) =>
    m!
      .blocksAt(line, n)
      .map((b) => `${b.id}:${b.tok}`)
      .sort();
  assert.deepEqual(at(0), ['#-1:5000']);
  assert.deepEqual(at(1), ['#-1:5000', '2@1/7:100']);
  assert.deepEqual(at(3), ['#-1:5000', '2@1/7:200', 'c0:2000', 'c1:3000']);
  assert.deepEqual(at(6), ['#-1:5000', '#9:1000', '2@1/7:300', 'c0:2000', 'c1:3000']);
  assert.deepEqual(at(7), ['#-1:5000', '#12:800', '#9:1000']);
  const read = m!.blocksAt(line, 6).find((b) => b.id === 'c0')!;
  assert.deepEqual([read.kind, read.label, read.file, read.birth, read.end], ['tools', '/r/a.ts', true, 2, 7]);
  assert.equal(m!.siblingKey(read), m!.siblingKey(m!.blocksAt(line, 6).find((b) => b.id === '#9')!));
});

test('a compaction keeps what it dropped beside what stands', { skip }, () => {
  const ps = m!.piecesAround(line, 7, 11300, 6800);
  const gone = ps.filter((p) => p.state === 'gone').map((p) => p.block.id).sort();
  const stand = ps.filter((p) => p.state === 'stand').map((p) => p.block.id).sort();
  assert.deepEqual(gone, ['2@1/7', 'c0', 'c1']);
  assert.deepEqual(stand, ['#-1', '#12', '#9']);
  assert.ok(Math.abs(ps.filter((p) => p.state === 'stand').reduce((a, p) => a + p.size, 0) - 6800) < 1e-9);
  const before = m!.piecesAt(line, 6, 11300);
  assert.ok(Math.abs(before.reduce((a, p) => a + p.size, 0) - 11300) < 1e-9);
  const sys = ps.find((p) => p.block.id === '#-1')!;
  assert.equal(sys.age, 7);
});

test('the table before a compaction shows how much of each kind stayed', { skip }, () => {
  const before = m!.piecesBefore(line, 7, 11300);
  const kept = view!.treeOf(before, true);
  const kind = (id: string) => kept.children!.find((k) => k.id === id)!;
  assert.equal(kind('system').kept, 1);
  assert.ok(Math.abs(kind('tools').kept! - 1000 / 6000) < 1e-9);
  assert.ok(Math.abs(kind('tools').children![0].kept! - 1000 / 6000) < 1e-9);
  const now = view!.treeOf(before);
  assert.equal(now.children!.find((k) => k.id === 'tools')!.kept, undefined);
  const sum = (n: Row): number => n.own + (n.children ?? []).reduce((a, c) => a + sum(c), 0);
  assert.ok(Math.abs(sum(kept) - 11300) < 1e-9);
  assert.ok(Math.abs(sum(now) - 6000) < 1e-9);
});

test('lot areas in the layout sum to the tokens and stay inside the corner region', { skip }, () => {
  const w = world('model');
  const r = repo(w, 'kiln');
  const t = new Transcript(w.claude, r);
  t.shape([{ type: 'text', text: 'S'.repeat(26000) }], []);
  let cur = 12000;
  for (let turn = 0; turn < 8; turn++) {
    t.prompt(`Step ${turn} of the ramp.`);
    for (let k = 0; k < 12; k++) {
      cur += 900;
      if (k % 3 === 0) t.read(path.join(r, `src/ramp${(turn + k) % 7}.ts`), 'R'.repeat(900 + 400 * k), { input: 5, read: cur, out: 40 });
      else if (k % 3 === 1) t.bash('cargo test', 'ok '.repeat(10 + 30 * k), { input: 5, read: cur, out: 30 });
      else t.reply('Ramp updated.', { input: 5, read: cur, write: 50, out: 90 });
    }
    if (turn === 4) {
      t.compact(cur, 9000, [], 'Ramp work continues.');
      cur = 9000;
    }
  }
  t.save();
  const an = newAnalyzer(t.id, t.file);
  return advance(an).then(() => {
    const tl = timeline(an);
    for (const p of an.ctx.points) {
      const blocks = m!.blocksAt(tl, p.n);
      assert.equal(blocks.reduce((a, b) => a + b.tok, 0), p.raw, `call ${p.n}`);
      for (const [win, side] of [[200_000, 10], [1_000_000, 10], [p.total, 7]]) {
        const pl = m!.plan(m!.piecesAt(tl, p.n, p.total), win, side);
        const per = pl.window / (side * side);
        const area = pl.lots.reduce((a, l) => a + (l.x1 - l.x0) * (l.z1 - l.z0), 0);
        assert.ok(Math.abs(area * per - p.total) <= p.total * 1e-9 + 1e-6, `call ${p.n} window ${win}`);
        for (const l of pl.lots) {
          assert.ok(Math.abs((l.x1 - l.x0) * (l.z1 - l.z0) * per - l.piece.size) <= l.piece.size * 1e-9 + 1e-6);
          assert.ok(l.x0 >= -1e-9 && l.z0 >= -1e-9 && l.x1 <= pl.region + 1e-9 && l.z1 <= pl.region + 1e-9);
        }
        assert.ok(Math.abs(pl.region * pl.region * per - p.total) <= p.total * 1e-9 + 1e-6);
      }
    }
    const cut = an.ctx.compactions[0];
    const around = m!.piecesAround(tl, cut.n, an.ctx.points[cut.n - 1].total, an.ctx.points[cut.n].total);
    const pl = m!.plan(around, 200_000, 10);
    const gone = pl.lots.filter((l) => l.piece.state === 'gone');
    assert.ok(gone.length > 0);
    assert.ok(gone.every((l) => l.piece.block.end === cut.n || l.piece.block.members?.every((b) => b.end === cut.n)));
  });
});

test('the view after a compaction stands the new context in the near corner over the old foundations', { skip }, () => {
  const before = m!.piecesBefore(line, 7, 11300);
  assert.deepEqual(before.filter((p) => p.state === 'gone').map((p) => p.block.id).sort(), ['2@1/7', 'c0', 'c1']);
  assert.deepEqual(before.filter((p) => p.state === 'stand').map((p) => p.block.id).sort(), ['#-1', '#9']);
  const now = m!.plan(m!.piecesAt(line, 7, 6800), 200_000, 10, undefined, true);
  const summary = now.lots.find((l) => l.piece.block.kind === 'summary')!;
  assert.deepEqual([summary.x0, summary.z0], [0, 0]);
  const old = m!.plan(before, 200_000, 10);
  assert.ok(old.region > now.region);
  const system = old.lots.find((l) => l.piece.block.kind === 'system')!;
  assert.ok(Math.abs(system.x1 - old.region) < 1e-9 && Math.abs(system.z1 - old.region) < 1e-9);
});

test('height grows with the calls carried and stops at the cap', { skip }, () => {
  assert.equal(m!.heightShare(0), 0);
  assert.equal(m!.heightShare(m!.AGE_CAP), 1);
  assert.equal(m!.heightShare(m!.AGE_CAP * 5), 1);
  assert.ok(m!.heightShare(10) < m!.heightShare(100));
  assert.ok(Math.abs(m!.heightShare(10) - Math.log10(11) / Math.log10(1001)) < 1e-12);
});
