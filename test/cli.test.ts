import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { world, repo, runCli, Transcript, HOOK } from './helpers.ts';
import { HOOKS } from '../src/core/install.ts';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const ask = { CLAUDE_CTX_TTY: '1' };
const others = {
  model: 'opus',
  hooks: {
    PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo mine' }, { type: 'command', command: 'echo two' }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: 'echo hello' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }],
  },
};
const settingsOf = (w: { claude: string }) => path.join(w.claude, 'settings.json');
const readSettings = (w: { claude: string }) => JSON.parse(fs.readFileSync(settingsOf(w), 'utf8'));

test('install names every missing hook in plain words, counts other hooks and writes nothing on no', () => {
  const w = world('install');
  fs.writeFileSync(settingsOf(w), JSON.stringify(others, null, 2) + '\n');
  const shown = strip(runCli(w, ['install'], { input: 'n\n', env: ask }).stdout);
  assert.match(shown, /^claude-ctx adds 5 hooks to Claude Code\n/);
  for (const h of HOOKS) assert.ok(shown.includes(`  ${h.name}`) && shown.includes(h.does), h.name);
  assert.ok(!/[{}"'`]/.test(shown), 'no brace or quote character');
  assert.ok(!shown.includes('SessionStart') && !shown.includes('session-start'));
  assert.ok(shown.includes('Nothing is removed and your context is never cleared.'));
  assert.ok(shown.includes('Your 4 other hooks and your settings stay as they are.'));
  assert.ok(shown.includes('settings.json.claude-ctx-backup'));
  assert.ok(shown.includes('Undo with claude-ctx uninstall'));
  assert.ok(shown.includes('Add the hooks? y or n'));
  assert.ok(shown.includes('Nothing was changed.'));
  assert.deepEqual(readSettings(w), others, 'nothing written on no');
  assert.ok(!fs.existsSync(settingsOf(w) + '.claude-ctx-backup'));
  const quiet = strip(runCli(w, ['install']).stdout);
  assert.ok(quiet.includes('Run claude-ctx install --yes to add the hooks.'));
  assert.deepEqual(readSettings(w), others);
});

test('install --lines shows the exact lines, a yes writes them, keeps a backup, and uninstall removes only its own', () => {
  const w = world('install-lines');
  fs.writeFileSync(settingsOf(w), JSON.stringify(others, null, 2) + '\n');
  const dry = strip(runCli(w, ['install', '--lines'], { input: 'n\n', env: ask }).stdout);
  assert.ok(dry.includes('session-start'));
  assert.ok(dry.includes('Add the hooks? y or n'));
  const lines = dry.split('\n');
  const removed = lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  const added = lines.filter((l) => l.startsWith('+ ')).map((l) => l.slice(2));
  const plus = new Set(added);
  assert.ok(added.length > 20);
  for (const l of removed) assert.ok(plus.has(l + ','), `only a comma changes on ${l}`);
  assert.deepEqual(readSettings(w), others, 'nothing written on no');
  const yes = runCli(w, ['install', '--lines'], { input: 'y\n', env: ask });
  assert.equal(yes.status, 0);
  const after = readSettings(w);
  assert.equal(after.model, 'opus');
  for (const h of HOOKS) assert.ok(JSON.stringify(after.hooks[h.event]).includes(path.basename(HOOK)), h.event);
  assert.equal(after.hooks.SessionStart.length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsOf(w) + '.claude-ctx-backup', 'utf8')), others);
  const written = fs.readFileSync(settingsOf(w), 'utf8').split('\n');
  for (const l of plus) assert.ok(written.includes(l), 'every shown line is written');
  const again = strip(runCli(w, ['install'], { input: 'y\n', env: ask }).stdout);
  assert.equal(again.trim(), 'All 5 claude-ctx hooks are already in place.');
  const un = strip(runCli(w, ['uninstall'], { input: 'n\n', env: ask }).stdout);
  assert.match(un, /^claude-ctx removes 5 hooks from Claude Code\n/);
  assert.ok(un.includes('Your 4 other hooks and your settings stay as they are.'));
  assert.ok(un.includes(`Your cards stay in ${w.ctxHome} until you run rm -r ${w.ctxHome}`));
  assert.ok(un.includes('Remove the hooks? y or n'));
  assert.ok(!/[{}"'`]/.test(un));
  assert.equal(readSettings(w).hooks.SessionEnd.length, 1, 'nothing removed on no');
  const unLines = strip(runCli(w, ['uninstall', '--lines']).stdout);
  assert.ok(unLines.split('\n').some((l) => l.startsWith('- ') && l.includes('session-end')));
  const gone = strip(runCli(w, ['uninstall', '--yes']).stdout);
  assert.ok(gone.includes('5 hooks removed.'));
  assert.deepEqual(readSettings(w), others);
  assert.ok(strip(runCli(w, ['uninstall', '--yes']).stdout).includes('No claude-ctx hooks'));
});

test('a partly installed file lists only the missing hooks and keeps the others as they are', () => {
  const w = world('install-part');
  runCli(w, ['install', '--yes']);
  const full = readSettings(w);
  const part = structuredClone(full);
  delete part.hooks.UserPromptSubmit;
  delete part.hooks.SessionEnd;
  fs.writeFileSync(settingsOf(w), JSON.stringify(part, null, 2) + '\n');
  const shown = strip(runCli(w, ['install']).stdout);
  assert.match(shown, /^claude-ctx adds 2 hooks to Claude Code\n/);
  const listed = HOOKS.filter((h) => shown.includes(`  ${h.name}`)).map((h) => h.event);
  assert.deepEqual(listed, ['UserPromptSubmit', 'SessionEnd']);
  assert.ok(shown.includes('Your settings stay as they are.'));
  const s1 = strip(runCli(w, ['status']).stdout);
  assert.match(s1, /Hooks\s+3 of 5 in .*, missing Your prompt and Session end/);
  const done = strip(runCli(w, ['install', '--yes']).stdout);
  assert.ok(done.includes('2 hooks added.'));
  const after = readSettings(w);
  for (const ev of ['SessionStart', 'PreCompact', 'PostCompact']) assert.deepEqual(after.hooks[ev], part.hooks[ev], ev);
  for (const h of HOOKS) assert.equal(after.hooks[h.event].length, 1, h.event);
});

test('install works when settings.json does not exist yet and stops on broken JSON', () => {
  const w = world('install2');
  const settings = settingsOf(w);
  const shown = strip(runCli(w, ['install'], { input: 'n\n', env: ask }).stdout);
  assert.ok(shown.includes(`A new ${settings} is made to hold the hooks.`));
  assert.ok(!shown.includes('backup') && !shown.includes('stay as they are'));
  assert.ok(!fs.existsSync(settings));
  runCli(w, ['install', '--yes']);
  const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.ok(s.hooks.UserPromptSubmit);
  assert.ok(!fs.existsSync(settings + '.claude-ctx-backup'));
  fs.writeFileSync(settings, '{ broken');
  const r = runCli(w, ['install', '--yes']);
  assert.ok(r.stdout.includes('is not valid JSON'));
  assert.equal(fs.readFileSync(settings, 'utf8'), '{ broken');
  fs.writeFileSync(settings, '[1, 2]');
  assert.ok(runCli(w, ['install', '--yes']).stdout.includes('not valid JSON'));
  assert.equal(fs.readFileSync(settings, 'utf8'), '[1, 2]');
});

test('a yes reads past sessions on an empty store only, and a failed read leaves the hooks in place', () => {
  const w = world('install-read');
  const a = repo(w, 'kiln-curve');
  const t = new Transcript(w.claude, a);
  t.prompt('Plot the firing curve for the test kiln');
  t.title('Kiln firing curve');
  t.save();
  const first = strip(runCli(w, ['install'], { input: 'y\n', env: ask }).stdout);
  assert.ok(first.includes('Reading your past sessions\n'));
  assert.match(first, /\n1 session read in [\d.]+ s\n/);
  assert.ok(first.indexOf('Reading your past sessions') < first.indexOf('5 hooks added.'));
  assert.ok(first.includes('Sessions already open miss the opening recall.'));
  assert.ok(first.includes('New Claude Code sessions in any folder open with a recall of your work elsewhere, and the claude-ctx command shows the page.'));
  assert.ok(fs.existsSync(path.join(w.ctxHome, 'index.json')));
  runCli(w, ['uninstall', '--yes']);
  const second = strip(runCli(w, ['install', '--yes']).stdout);
  assert.ok(!second.includes('Reading'), 'no read when the store has an index');
  assert.ok(second.includes('5 hooks added.'));
  const v = world('install-fail');
  const b = repo(v, 'loom-draft');
  const u = new Transcript(v.claude, b);
  u.prompt('Draft the loom threading plan');
  u.save();
  const blocker = path.join(v.root, 'blocker');
  fs.writeFileSync(blocker, 'a file where the store folder should be');
  const failed = strip(runCli(v, ['install', '--yes'], { env: { CLAUDE_CTX_HOME: path.join(blocker, 'ctx') } }).stdout);
  assert.ok(failed.includes('Reading past sessions failed, so run claude-ctx index once.'));
  assert.ok(failed.includes('5 hooks added.'));
  const kept = readSettings(v);
  for (const h of HOOKS) assert.ok(kept.hooks[h.event], h.event);
});

test('index, search and the guiding missing argument', () => {
  const w = world('search');
  const a = repo(w, 'kiln-timer');
  const b = repo(w, 'bread-notes');
  const t1 = new Transcript(w.claude, a);
  t1.prompt('Add a cone 6 firing schedule to the kiln timer');
  t1.edit(path.join(a, 'schedule.ts'));
  t1.title('Kiln firing schedule');
  t1.save();
  const t2 = new Transcript(w.claude, b);
  t2.prompt('Write a sourdough starter feeding log');
  t2.title('Sourdough starter log');
  t2.save();
  const empty = runCli(w, ['search', 'kiln']);
  assert.ok(empty.stdout.includes('claude-ctx index'));
  const ix = runCli(w, ['index']);
  assert.equal(ix.status, 0);
  assert.ok(ix.stdout.includes('2 cards from 2 sessions'));
  const s = strip(runCli(w, ['search', 'firing', 'schedule']).stdout);
  assert.ok(s.includes('Kiln firing schedule'));
  assert.ok(!s.includes('Sourdough'));
  const none = runCli(w, ['search']);
  assert.ok(none.stdout.includes('Newest sessions'));
  assert.ok(none.stdout.includes('Sourdough starter log'));
  const miss = runCli(w, ['search', 'zebra', 'crossing']);
  assert.ok(miss.stdout.includes('Nothing matches'));
  const typo = runCli(w, ['serch']);
  assert.ok(typo.stdout.includes('the closest is claude-ctx search'));
  assert.equal(typo.status, 0);
});

test('doctor counts what it understood and what it skipped', () => {
  const w = world('doctor');
  const a = repo(w, 'one');
  const t = new Transcript(w.claude, a);
  t.prompt('hello there');
  t.reply('hi', { input: 5, read: 100, write: 50 });
  t.noise();
  t.title('Greeting');
  t.compact(1000, 100, [], 'Said hello.');
  t.save();
  fs.appendFileSync(t.file, 'not json at all\n');
  const r = strip(runCli(w, ['doctor']).stdout);
  assert.ok(r.includes('1 transcripts'));
  assert.ok(r.includes('1 records unreadable'));
  assert.match(r, /future-record-kind\s+1/);
  assert.match(r, /queue-operation\s+1/);
  assert.match(r, /system\/compact_boundary\s+1/);
  assert.match(r, /usage blocks\s+1 of 1 replies/);
  assert.match(r, /compactions\s+1, 1 with token counts/);
  assert.match(r, /AI titles\s+1/);
  assert.match(r, /prompts\s+1/);
  assert.match(r, /\nThe mcp command loads and exits on a closed pipe in \d+ ms\.\n$/);
  assert.ok(!fs.existsSync(path.join(w.ctxHome, 'claude-ctx.log')));
});

test('status says whether the hooks run, how many cards exist, the last hook and the last error', async () => {
  const { runHook } = await import('./helpers.ts');
  const w = world('status');
  const a = repo(w, 'pottery-log');
  const t = new Transcript(w.claude, a);
  t.prompt('Track kiln loads for the pottery log');
  t.title('Kiln load tracker');
  t.save();
  let s = strip(runCli(w, ['status']).stdout);
  assert.match(s, /Hooks\s+not installed, run claude-ctx install/);
  assert.match(s, /Cards\s+none yet/);
  assert.match(s, /Last hook\s+none has run yet/);
  assert.match(s, /Last error\s+none/);
  fs.writeFileSync(path.join(w.claude, 'settings.json'), JSON.stringify({ enabledPlugins: { 'ctx@claude-ctx': true } }));
  assert.match(strip(runCli(w, ['status']).stdout), /Hooks\s+from the ctx plugin/);
  runCli(w, ['install', '--yes']);
  runCli(w, ['index']);
  runHook(w, 'session-start', { session_id: 'x1', cwd: w.code, source: 'startup' });
  fs.appendFileSync(path.join(w.ctxHome, 'claude-ctx.log'), '2026-11-23T10:00:00.000Z hook prompt Error: something broke\n');
  s = strip(runCli(w, ['status']).stdout);
  assert.match(s, /Hooks\s+5 of 5 in /);
  assert.match(s, /Cards\s+1, indexed just now/);
  assert.match(s, /Last hook\s+Session start, just now, printed [\d,]+ characters in \d+ ms/);
  assert.match(s, /Last error\s+.*something broke/);
  assert.ok(s.split('\n').filter(Boolean).length <= 5);
});

test('the page command builds the index first on an empty store and says so in one line', async () => {
  const { spawn } = await import('node:child_process');
  const { CLI, waitFor } = await import('./helpers.ts');
  const w = world('firstrun');
  const a = repo(w, 'loom');
  const t = new Transcript(w.claude, a);
  t.prompt('Weave a twill pattern');
  t.save();
  const child = spawn(process.execPath, [CLI, '--no-open'], { env: w.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  assert.ok(await waitFor(() => out.includes('open at'), 20000));
  child.kill('SIGINT');
  await new Promise((r) => child.once('exit', r));
  const lines = out.trim().split('\n');
  assert.equal(lines[0], 'No cards yet, so reading past sessions into cards first.');
  assert.ok(lines[1].startsWith('1 card from 1 session in'));
  assert.ok(fs.existsSync(path.join(w.ctxHome, 'cards.jsonl')));
});
