import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, Transcript } from '../test/synth.ts';

const root = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  process.stdout.write('Give a scratch folder, like node scripts/demo.ts /tmp/claude-ctx-demo\n');
  process.exit(0);
}
const claude = path.join(root, 'claude');
const code = path.join(root, 'code', 'projects');
fs.mkdirSync(claude, { recursive: true });

let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const R = 2.6;
const body = (tokens: number, flavor = 'const value = compute(input);') => {
  const line = flavor + ' ';
  return line.repeat(Math.max(1, Math.round((tokens * R) / line.length)));
};

interface Ctx {
  t: Transcript;
  cur: number;
}

function call(c: Ctx, added: number, out: number) {
  const u = { input: 4 + Math.round(rand() * 20), read: Math.max(0, c.cur - added), write: added, out };
  c.cur += out;
  return u;
}

function prompt(c: Ctx, text: string, cwd?: string) {
  c.t.prompt(text, cwd);
  c.cur += Math.round(text.length / R) + 30;
}

function reply(c: Ctx, text: string) {
  const out = Math.round(text.length / 3.5) + 40 + Math.round(rand() * 400);
  c.t.reply(text, call(c, 600, out));
}

function read(c: Ctx, file: string, tokens: number) {
  const out = 60 + Math.round(rand() * 80);
  const r = c.t.read(file, body(tokens), call(c, 300, out));
  c.cur += tokens;
  return r;
}

function bash(c: Ctx, cmd: string, tokens: number, flavor: string) {
  const out = 50 + Math.round(rand() * 60);
  const r = c.t.bash(cmd, body(tokens, flavor), call(c, 300, out));
  c.cur += tokens;
  return r;
}

function edit(c: Ctx, file: string) {
  c.t.edit(file, call(c, 400, 300 + Math.round(rand() * 600)));
  c.cur += 120;
}

function compact(c: Ctx, keep: string[], summary: string, system: number) {
  const pre = c.cur;
  const post = system + Math.round(summary.length / R) + 4000 + Math.round(rand() * 3000);
  c.t.compact(pre, post, keep, summary);
  c.cur = post;
}

function start(cwd: string, startMs: number, title: string): Ctx {
  const t = new Transcript(claude, cwd, { start: startMs });
  t.title(title);
  const system = 23000 + Math.round(rand() * 3000);
  t.shape([{ type: 'text', text: 'S'.repeat(Math.round(system * 0.35 * R)) }], [{ name: 'Read', description: 'T'.repeat(Math.round(system * 0.65 * R)) }]);
  t.attachment({ type: 'instructions', files: [{ path: path.join(cwd, 'CLAUDE.md') }] }, undefined);
  const mem = t.attachment({ type: 'instructions', files: [{ path: 'CLAUDE.md' }, { path: 'MEMORY.md' }] }, 'M'.repeat(Math.round(2400 * R)));
  t.attachment({ type: 'skill_listing', content: 'skills' }, 'K'.repeat(Math.round(1800 * R)));
  void mem;
  return { t, cur: system + 4200 };
}

const day = 86400000;
const now = Date.now();

const tide = makeRepo(path.join(code, 'tidepool-api'), 'git@github.com:example-lab/tidepool-api.git');
const tideWeb = makeRepo(path.join(code, 'tidepool-web'), 'git@github.com:example-lab/tidepool-api.git');
const kiln = makeRepo(path.join(code, 'kiln-timer'), 'git@github.com:example-lab/kiln-timer.git');
const loom = makeRepo(path.join(code, 'loom-editor'), 'git@github.com:example-lab/loom-editor.git');
const trail = makeRepo(path.join(code, 'trailhead-map'), 'git@github.com:example-lab/trailhead-map.git');
const orbit = makeRepo(path.join(code, 'orbit-notes'));

{
  const c = start(tide, now - 2 * 3600e3, 'Tide window alerts with rate limits');
  const sys = c.cur - 4200;
  prompt(c, 'Add tide window alerts to the tidepool api. Use the NOAA station list we already cache. Never call the live API from tests.');
  reply(c, 'Reading the station cache and the alert routes first.');
  read(c, path.join(tide, 'src/stations/cache.ts'), 5200);
  read(c, path.join(tide, 'src/routes/alerts.ts'), 3800);
  const keepA = read(c, path.join(tide, 'src/db/schema.sql'), 2400);
  for (let i = 0; i < 40; i++) {
    if (i % 7 === 0) prompt(c, pick(['Keep the alert payload under 2 KB.', 'Add a test for the spring tide case.', 'Rename window to slot in the public API.', 'Show me the failing test output again.']));
    const r = rand();
    if (r < 0.35) read(c, path.join(tide, `src/${pick(['alerts', 'stations', 'tides', 'notify'])}/${pick(['index', 'window', 'slot', 'queue', 'format'])}.ts`), 1200 + Math.round(rand() * 5200));
    else if (r < 0.6) bash(c, pick(['npm test -- alerts', 'npm run lint', 'git diff --stat', 'npm test -- stations']), 700 + Math.round(rand() * 4200), 'PASS src/alerts/window.test.ts 14 tests');
    else if (r < 0.8) edit(c, path.join(tide, `src/alerts/${pick(['window', 'slot', 'format'])}.ts`));
    else reply(c, 'The window math now handles the slack water edge.');
  }
  compact(c, [keepA.use, keepA.result], 'The user is adding tide window alerts to the tidepool api. src/alerts/window.ts computes alert slots from the cached station list in src/stations/cache.ts. Tests run with npm test and avoid the live API. Open work is the spring tide case.', sys);
  prompt(c, 'Now wire the alerts into the push queue with a retry budget of three.');
  for (let i = 0; i < 55; i++) {
    const r = rand();
    if (r < 0.3) read(c, path.join(tide, `src/${pick(['notify', 'queue', 'alerts'])}/${pick(['push', 'retry', 'budget', 'index'])}.ts`), 1500 + Math.round(rand() * 6000));
    else if (r < 0.58) bash(c, pick(['npm test -- queue', 'npm run typecheck', 'docker compose logs queue --tail 200', 'npm test -- notify']), 900 + Math.round(rand() * 5200), 'queue worker retry 2 of 3 backoff 400ms');
    else if (r < 0.8) edit(c, path.join(tide, `src/notify/${pick(['push', 'retry'])}.ts`));
    else reply(c, 'Retries now stop after the third failure and log the station id.');
    if (i % 11 === 0) prompt(c, pick(['Use exponential backoff, not a fixed delay.', 'Log the station id on every retry.', 'Keep the queue in Postgres, no Redis.']));
  }
  compact(c, [], 'Alerts now go through the push queue in src/notify/push.ts with exponential backoff and three retries. The queue stays in Postgres. Typecheck passes.', sys);
  prompt(c, 'Last thing, add rate limits per user on the alerts route.', tideWeb);
  for (let i = 0; i < 38; i++) {
    const r = rand();
    if (r < 0.35) read(c, path.join(tide, `src/routes/${pick(['alerts', 'limits', 'auth'])}.ts`), 1400 + Math.round(rand() * 5000));
    else if (r < 0.6) bash(c, pick(['npm test -- limits', 'npm run lint', 'curl -s localhost:8787/health']), 600 + Math.round(rand() * 3200), 'ok limits 429 after 30 requests');
    else if (r < 0.85) edit(c, path.join(tide, `src/routes/${pick(['alerts', 'limits'])}.ts`));
    else reply(c, 'Per user limits are in, 30 requests a minute.');
  }
  c.t.save();
}

{
  const c = start(kiln, now - 26 * 3600e3, 'Cone 6 firing schedule');
  prompt(c, 'Add a cone 6 firing schedule with a slow cool to the kiln timer.');
  for (let i = 0; i < 24; i++) {
    const r = rand();
    if (r < 0.4) read(c, path.join(kiln, `src/${pick(['schedule', 'ramp', 'cone'])}.ts`), 900 + Math.round(rand() * 3000));
    else if (r < 0.7) edit(c, path.join(kiln, `src/${pick(['schedule', 'ramp'])}.ts`));
    else bash(c, 'cargo test', 800 + Math.round(rand() * 2000), 'test ramp::slow_cool ok');
  }
  c.t.save();
}

const quick: [string, string, string, number][] = [
  [loom, 'Undo stack for the pattern grid', 'Add undo and redo to the loom pattern grid.', 3],
  [trail, 'Elevation profile under the map', 'Draw an elevation profile under the trail map.', 5],
  [orbit, 'Backlinks panel', 'Show backlinks for the open note in a side panel.', 8],
  [tideWeb, 'Station picker search', 'Make the station picker searchable by name and id.', 12],
  [loom, 'Export patterns as SVG', 'Export the current pattern as an SVG file.', 17],
  [trail, 'Offline tiles', 'Cache map tiles for offline use on the trail.', 23],
];
for (const [dir, title, text, days] of quick) {
  const c = start(dir, now - days * day, title);
  prompt(c, text);
  for (let i = 0; i < 8 + Math.round(rand() * 10); i++) {
    const r = rand();
    if (r < 0.45) read(c, path.join(dir, `src/${pick(['app', 'grid', 'panel', 'map', 'export'])}.ts`), 800 + Math.round(rand() * 2400));
    else if (r < 0.8) edit(c, path.join(dir, `src/${pick(['grid', 'panel', 'map'])}.ts`));
    else reply(c, 'Done, the change is in.');
  }
  c.t.save();
}

for (const dir of fs.readdirSync(path.join(claude, 'projects'))) {
  for (const f of fs.readdirSync(path.join(claude, 'projects', dir))) {
    const file = path.join(claude, 'projects', dir, f);
    const stamps = fs.readFileSync(file, 'utf8').match(/"timestamp":"[^"]+"/g) ?? [];
    const last = stamps.length ? new Date(stamps[stamps.length - 1].slice(13, -1)) : new Date();
    fs.utimesSync(file, last, last);
  }
}
process.stdout.write(`${claude}\n`);
