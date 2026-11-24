import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Transcript, makeRepo } from '../test/synth.ts';

const N = Number(process.argv[2]) || 300;
const src = path.resolve(process.argv[3] || path.join(import.meta.dirname, '..'));
const load = (m: string) => import(pathToFileURL(path.join(src, 'src', 'core', m)).href);
const { store } = await load('paths.ts');
const { applyJobs, listTranscripts } = await load('update.ts');
const { loadCards } = await load('store.ts');
const { renderCard } = await load('format.ts');
const budget = fs.existsSync(path.join(src, 'src', 'core', 'budget.ts')) ? await load('budget.ts') : null;

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'claude-ctx-size-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
const claude = path.join(root, 'claude');
const st = store(path.join(root, 'ctx'));

const nouns = ['kiln', 'loom', 'sail', 'hive', 'menu', 'winch', 'tide', 'orchard', 'quilt', 'trail', 'glaze', 'mast'];
const verbs = ['chart', 'tune', 'draft', 'log', 'export', 'fix', 'plot', 'check'];
const pick = <T>(a: T[], i: number) => a[i % a.length];
const reminder = '<system-reminder>Called the Read tool with the following input and a long tools list</system-reminder>';
const tools = '<tools-used-before-summary>Read, Edit, Bash, Grep, Glob</tools-used-before-summary>';
for (let i = 0; i < N; i++) {
  const noun = pick(nouns, i);
  const repo = makeRepo(path.join(root, 'code', `${noun}-${i % 40}`));
  const t = new Transcript(claude, repo, { start: Date.parse('2026-10-01T00:00:00Z') + i * 3_600_000 });
  for (let k = 0; k < 10; k++) {
    t.prompt(`${pick(verbs, i + k)} the ${noun} ${pick(nouns, i + k + 3)} table step ${k} and keep the ${pick(nouns, k)} notes short`);
    if (k % 2 === 0) t.edit(path.join(repo, 'src', `${noun}${k}.ts`));
    if (k % 3 === 0) t.read(path.join(repo, 'README.md'), 'line\n'.repeat(80));
    if (k % 4 === 0) t.bash('npm test', 'ok 12 tests\n'.repeat(20));
    t.reply(`Done with step ${k} for the ${noun}.`);
    if (k === 6 || k === 9) {
      const summary = [
        `1. Primary Request and Intent:\n   ${reminder} The person asked to ${pick(verbs, i)} the ${noun} tables and keep notes short.`,
        `2. Key Technical Concepts:\n   - ${tools}\n   - TypeScript, Node`,
        `3. Files and Code Sections:\n   - src/${noun}0.ts\n      <div class="x">markup</div>`,
        '4. Errors and fixes:\n   - none',
        `8. Current Work:\n   Finished step ${k} of the ${noun} tables. <artifact-content-authored-by-others>notice</artifact-content-authored-by-others>`,
        '9. Optional Next Step:\n   Check the export.',
      ].join('\n');
      t.compact(150000, 30000, [], summary);
    }
  }
  t.title(`${noun} tables ${i}`);
  t.save();
}
const files = listTranscripts(claude);
await applyJobs(st, claude, files.map((f: { session: string; transcript: string }) => ({ session: f.session, transcript: f.transcript })));
if (budget) budget.enforce(st);
const bytes = (dir: string): number =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? bytes(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
const total = bytes(st.home);
const sizes = loadCards(st)
  .map((c: unknown) => renderCard(c, 1500).length)
  .sort((a: number, b: number) => a - b);
const q = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor(p * sizes.length))];
console.log(`${N} sessions, store ${total} bytes, ${Math.round(total / N)} bytes a session`);
console.log(`card text median ${q(0.5)} chars, 90th percentile ${q(0.9)} chars`);
