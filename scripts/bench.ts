import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { store } from '../src/core/paths.ts';
import { writeCardsAndIndex } from '../src/core/store.ts';
import type { Card } from '../src/core/session.ts';

const N = Number(process.argv[2]) || 2000;
const RUNS = Number(process.argv[3]) || 40;
const hook = path.resolve(process.argv[4] || 'dist/hook.js');
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'claude-ctx-bench-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
const home = path.join(root, 'ctx');
const claude = path.join(root, 'claude');
const code = path.join(root, 'code');
fs.mkdirSync(claude, { recursive: true });

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const syll = ['ka', 'lo', 'mi', 'ren', 'tas', 'vo', 'pel', 'dri', 'sun', 'gor', 'bel', 'nix', 'tha', 'quo', 'zem', 'fal'];
const vocab: string[] = [];
for (let i = 0; i < 4000; i++) vocab.push(syll[Math.floor(rand() * 16)] + syll[Math.floor(rand() * 16)] + (rand() < 0.5 ? syll[Math.floor(rand() * 16)] : ''));
const zipf = () => vocab[Math.floor(Math.pow(rand(), 2.2) * vocab.length)];
const words = (n: number) => Array.from({ length: n }, zipf).join(' ');

const cards: Card[] = [];
for (let i = 0; i < N; i++) {
  const place = path.join(code, `proj${i % 120}`);
  cards.push({
    id: `s${i}`,
    session: `s${i}`,
    part: 1,
    parts: 1,
    place,
    git: true,
    project: `proj${i % 120}`,
    remote: `me/proj${i % 120}`,
    branch: 'main',
    places: [{ path: place, git: true, prompts: 5, edits: 9 }],
    first: new Date(Date.now() - (i + 2) * 3600e3).toISOString(),
    last: new Date(Date.now() - i * 3600e3).toISOString(),
    title: words(5),
    summaries: [words(90), words(90), words(90)],
    firstPrompt: words(45),
    prompts: [words(30), words(30), words(30), words(30), words(30)],
    files: Array.from({ length: 12 }, () => `${place}/src/${zipf()}${zipf()}.ts`),
    transcript: `/nowhere/s${i}.jsonl`,
    turns: 12,
  });
}
const t0 = performance.now();
writeCardsAndIndex(store(home), cards);
const buildMs = performance.now() - t0;
const here = path.join(code, 'proj7');
fs.mkdirSync(path.join(here, '.git'), { recursive: true });
fs.writeFileSync(path.join(here, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:me/proj7.git\n');
for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(here, `${zipf()}.ts`), 'x');

const env = { ...process.env, CLAUDE_CTX_HOME: home, CLAUDE_CONFIG_DIR: claude, HOME: root, CLAUDE_CTX_PROFILE: '1' };
function bare(): number[] {
  const out: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    spawnSync(process.execPath, ['-e', '0'], { env });
    out.push(performance.now() - s);
  }
  return out.sort((a, b) => a - b);
}
function time(args: string[], input: string, extra: NodeJS.ProcessEnv = {}): { wall: number[]; work: number[]; over: number[] } {
  const wall: number[] = [];
  const work: number[] = [];
  const over: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const b0 = performance.now();
    spawnSync(process.execPath, ['-e', '0'], { env });
    const base = performance.now() - b0;
    const s = performance.now();
    const r = spawnSync(process.execPath, args, { input, env: { ...env, ...extra }, encoding: 'utf8' });
    const w = performance.now() - s;
    wall.push(w);
    over.push(w - base);
    if (r.status !== 0) throw new Error(r.stderr);
    const m = r.stderr.match(/claude-ctx-profile ([\d.]+) ([\d.]+)/);
    if (m) work.push(Number(m[2]) - Number(m[1]));
  }
  const sort = (a: number[]) => a.sort((x, y) => x - y);
  return { wall: sort(wall), work: sort(work), over: sort(over) };
}
const q = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(1) : '-');
const report = (name: string, r: { wall: number[]; work: number[]; over: number[] }) =>
  console.log(`${name.padEnd(14)} work median ${q(r.work, 0.5)} ms p95 ${q(r.work, 0.95)} ms | wall minus bare node median ${q(r.over, 0.5)} ms p95 ${q(r.over, 0.95)} ms | wall median ${q(r.wall, 0.5)} ms`);
const sz = (f: string) => (fs.statSync(path.join(home, f)).size / 1e6).toFixed(2);
console.log(`${N} cards, cards.jsonl ${sz('cards.jsonl')} MB, index.json ${sz('index.json')} MB, index build ${buildMs.toFixed(0)} ms, ${RUNS} runs each`);
const start = JSON.stringify({ session_id: 'bench', cwd: here, source: 'startup', hook_event_name: 'SessionStart' });
report('session-start', time([hook, 'session-start'], start));
const prompt = JSON.stringify({ session_id: 'bench-p', cwd: here, prompt: words(25), hook_event_name: 'UserPromptSubmit' });
const tp = time([hook, 'prompt'], prompt);
fs.rmSync(path.join(home, 'seen'), { recursive: true, force: true });
report('prompt', tp);
const cache = path.join(root, 'compile-cache');
spawnSync(process.execPath, [hook, 'prompt'], { input: prompt, env: { ...env, NODE_COMPILE_CACHE: cache }, encoding: 'utf8' });
fs.rmSync(path.join(home, 'seen'), { recursive: true, force: true });
report('prompt cached', time([hook, 'prompt'], prompt, { NODE_COMPILE_CACHE: cache }));
fs.rmSync(path.join(home, 'seen'), { recursive: true, force: true });
const b = bare();
console.log(`${'bare node'.padEnd(14)} wall median ${q(b, 0.5)} ms p95 ${q(b, 0.95)} ms`);
report('pre-compact', time([hook, 'pre-compact'], JSON.stringify({ session_id: 'bench' })));
report('session-end', time([hook, 'session-end'], JSON.stringify({ session_id: 'nope', transcript_path: path.join(claude, 'none.jsonl') })));
const so = spawnSync(process.execPath, [hook, 'session-start'], { input: start, env, encoding: 'utf8' });
console.log(`session-start printed ${so.stdout.length} chars`);
const busy = () => fs.existsSync(path.join(home, 'lock')) || (fs.existsSync(path.join(home, 'pending.jsonl')) && fs.statSync(path.join(home, 'pending.jsonl')).size > 0);
for (const end = Date.now() + 20000; busy() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50));
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(root, { recursive: true, force: true });
