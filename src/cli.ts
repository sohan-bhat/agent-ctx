#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { claudeDir, ctxHome, store, type Store } from './core/paths.ts';
import { loadIndex, readCards } from './core/store.ts';
import { findDocs, newestDocs } from './core/rank.ts';
import { renderCard, tilde, day } from './core/format.ts';
import { applyJobs, listTranscripts } from './core/update.ts';
import { releaseLock, waitLock } from './core/lock.ts';
import { apply, backupPath, HOOKS, hookName, isOurs, planInstall, planUninstall, type HookInfo, type Plan } from './core/install.ts';
import { logError } from './core/fsx.ts';
import { doctor } from './core/doctor.ts';
import { budgetBytes, MB, WORKER_LIMIT_MS } from './core/limits.ts';
import { enforce, storeSize } from './core/budget.ts';

const VERSION = '0.1.0';
const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.extname(fileURLToPath(import.meta.url));
const hookJs = path.join(here, 'hook' + ext);
const tty = !!process.stdout.isTTY && !!process.stdin.isTTY;
const interactive = tty || !!process.env.CLAUDE_CTX_TTY;
const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[22m` : s);
const out = (s = '') => process.stdout.write(s + '\n');
const num = (n: number) => n.toLocaleString('en-US');
const many = (n: number, one: string, more = one + 's') => `${num(n)} ${n === 1 ? one : more}`;
const NAME_W = Math.max(...HOOKS.map((h) => h.name.length)) + 2;

const COMMANDS: [string, string][] = [
  ['claude-ctx', 'open the page'],
  ['claude-ctx search <words>', 'find past sessions'],
  ['claude-ctx index', 'read new transcripts into cards'],
  ['claude-ctx install', 'add the hooks to Claude Code'],
  ['claude-ctx uninstall', 'take the hooks out again'],
  ['claude-ctx status', 'show whether the hooks run'],
  ['claude-ctx doctor', 'count each record type it understood'],
];

function commandList(): string {
  const w = Math.max(...COMMANDS.map(([c]) => c.length));
  return COMMANDS.map(([c, d]) => `  ${c.padEnd(w)}  ${dim(d)}`).join('\n');
}

async function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((res) => rl.question(q, res));
  } finally {
    rl.close();
  }
}

async function cmdSearch(st: Store, words: string[]): Promise<void> {
  let q = words.join(' ').trim();
  if (!q && tty) q = (await ask('Search for: ')).trim();
  const ix = loadIndex(st);
  if (!ix || !ix.docs.length) {
    out('No cards yet, so run claude-ctx index to read your past sessions.');
    return;
  }
  let docs: number[];
  if (!q) {
    docs = newestDocs(ix, 5);
    out(dim('Newest sessions first, and words narrow the list, like claude-ctx search heat map.'));
  } else {
    docs = findDocs(ix, q, 8, 5);
    if (!docs.length) {
      out(`Nothing matches "${q}". Try fewer or different words.`);
      return;
    }
  }
  for (const c of readCards(st, ix, docs)) {
    out();
    out(renderCard(c, 900).replace(/^## (.*)$/m, (_m, h: string) => bold(h)));
    out(dim(`  ${c.id}`));
  }
}

async function cmdIndex(st: Store, full: boolean, quiet = false): Promise<void> {
  const claude = claudeDir();
  const files = listTranscripts(claude);
  if (!files.length) {
    out(`No transcripts in ${tilde(path.join(claude, 'projects'))} yet.`);
    return;
  }
  if (!(await waitLock(st.lock, WORKER_LIMIT_MS + 5000, 60000))) {
    out('Another claude-ctx update is running, so try again in a minute.');
    return;
  }
  const t0 = Date.now();
  try {
    if (full) {
      fs.rmSync(st.sessions, { recursive: true, force: true });
      fs.rmSync(st.cards, { force: true });
    }
    const total = files.reduce((a, f) => a + f.size, 0);
    if (!quiet) out(`Reading ${num(files.length)} transcripts, ${(total / 1e6).toFixed(0)} MB`);
    const res = await applyJobs(
      st,
      claude,
      files.map((f) => ({ session: f.session, transcript: f.transcript })),
      (done, n) => {
        if (process.stdout.isTTY) process.stdout.write(`\r${done} of ${n}`);
      },
    );
    if (process.stdout.isTTY) process.stdout.write('\r');
    enforce(st);
    out(`${num(res.cards)} card${res.cards === 1 ? "" : "s"} from ${num(res.sessions)} session${res.sessions === 1 ? "" : "s"} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (!quiet) out(dim(`Store ${tilde(st.home)}`));
  } finally {
    releaseLock(st.lock);
  }
}

function showPlan(p: Plan): void {
  const paint = (code: number, t: string) => (process.stdout.isTTY ? `\x1b[${code}m${t}\x1b[39m` : t);
  for (const d of p.changes) out(d.sign === '+' ? paint(32, `+ ${d.text}`) : paint(31, `- ${d.text}`));
}

async function confirm(q: string, yes: boolean, hint: string): Promise<boolean> {
  if (yes) return true;
  if (!interactive) {
    out(dim(hint));
    return false;
  }
  const ok = /^y(es)?$/i.test((await ask(q)).trim());
  if (!ok) out('Nothing was changed.');
  return ok;
}

function othersLine(p: Plan): string {
  return p.others ? `Your ${many(p.others, 'other hook')} and your settings stay as they are.` : 'Your settings stay as they are.';
}

function listHooks(hooks: HookInfo[]): string {
  const names = hooks.map((h) => h.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
}

async function firstRead(st: Store): Promise<void> {
  const claude = claudeDir();
  const files = listTranscripts(claude);
  if (!files.length) return;
  const label = 'Reading your past sessions';
  out(label);
  const t0 = Date.now();
  let locked = false;
  try {
    locked = await waitLock(st.lock, WORKER_LIMIT_MS + 5000, 60000);
    if (!locked) throw new Error('the store stayed locked');
    const res = await applyJobs(
      st,
      claude,
      files.map((f) => ({ session: f.session, transcript: f.transcript })),
      (done, n) => {
        if (process.stdout.isTTY) process.stdout.write(`\r${done} of ${n}`);
      },
    );
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');
    enforce(st);
    const secs = (Date.now() - t0) / 1000;
    out(`${many(res.sessions, 'session')} read in ${secs < 10 ? secs.toFixed(1) : secs.toFixed(0)} s`);
  } catch (e) {
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');
    logError(st.log, 'install index', e);
    out('Reading past sessions failed, so run claude-ctx index once.');
  } finally {
    if (locked) releaseLock(st.lock);
  }
}

async function cmdInstall(args: string[], yes: boolean): Promise<void> {
  const file = path.join(claudeDir(), 'settings.json');
  if (!fs.existsSync(hookJs)) {
    out(`The hook file ${hookJs} is missing, so run npm run build first.`);
    return;
  }
  let p: Plan;
  try {
    p = planInstall(file, process.execPath, hookJs);
  } catch {
    out(`Nothing was changed because ${tilde(file)} is not valid JSON, so fix the file and run claude-ctx install again.`);
    return;
  }
  const n = p.missing.length;
  if (!n) {
    out(`All ${HOOKS.length} claude-ctx hooks are already in place.`);
    return;
  }
  if (args.includes('--lines')) {
    out(`Lines for ${tilde(file)}`);
    showPlan(p);
  } else {
    out(bold(`claude-ctx adds ${many(n, 'hook')} to Claude Code`));
    out();
    for (const h of p.missing) out(`  ${h.name.padEnd(NAME_W)}${h.does}`);
    out();
    out('Nothing is removed and your context is never cleared.');
    if (p.exists) {
      out(othersLine(p));
      out(`The current file is kept at ${tilde(backupPath(file))}`);
    } else out(`A new ${tilde(file)} is made to hold the hooks.`);
    out('Undo with claude-ctx uninstall');
  }
  out();
  if (!(await confirm(n === 1 ? 'Add the hook? y or n ' : 'Add the hooks? y or n ', yes, 'Run claude-ctx install --yes to add the hooks.'))) return;
  apply(p);
  const st = store(ctxHome());
  if (!loadIndex(st)) await firstRead(st);
  out(`${many(n, 'hook')} added.`);
  out('Sessions already open miss the opening recall.');
  out('New Claude Code sessions in any folder open with a recall of your work elsewhere, and the claude-ctx command shows the page.');
}

async function cmdUninstall(args: string[], yes: boolean): Promise<void> {
  const file = path.join(claudeDir(), 'settings.json');
  let p: Plan;
  try {
    p = planUninstall(file, hookJs);
  } catch {
    out(`Nothing was changed because ${tilde(file)} is not valid JSON.`);
    return;
  }
  if (!p.changes.length) {
    out('No claude-ctx hooks found.');
    return;
  }
  if (args.includes('--lines')) {
    out(`Lines to take out of ${tilde(file)}`);
    showPlan(p);
  } else {
    const home = tilde(ctxHome());
    out(bold(`claude-ctx removes ${many(p.ours, 'hook')} from Claude Code`));
    out();
    out(othersLine(p));
    out(`Your cards stay in ${home} until you run rm -r ${home}`);
  }
  out();
  if (!(await confirm(p.ours === 1 ? 'Remove the hook? y or n ' : 'Remove the hooks? y or n ', yes, 'Run claude-ctx uninstall --yes to remove the hooks.'))) return;
  apply(p);
  out(`${many(p.ours, 'hook')} removed.`);
}

async function cmdDoctor(st: Store): Promise<void> {
  const claude = claudeDir();
  const rep = await doctor(claude, (i, n) => {
    if (process.stdout.isTTY) process.stdout.write(`\r${i + 1} of ${n}`);
  });
  if (process.stdout.isTTY) process.stdout.write('\r');
  out(`${num(rep.transcripts)} transcripts in ${tilde(path.join(claude, 'projects'))}, ${(rep.bytes / 1e6).toFixed(0)} MB, ${num(rep.lines)} records`);
  out(`${num(rep.unreadable)} records unreadable`);
  const block = (title: string, o: Record<string, number>) => {
    out();
    out(bold(title));
    const rows = Object.entries(o).sort((a, b) => b[1] - a[1]);
    const w = Math.max(0, ...rows.map(([k]) => k.length));
    for (const [k, v] of rows) out(`  ${k.padEnd(w)}  ${num(v)}`);
  };
  block('Understood', rep.understood);
  block('Skipped', rep.skipped);
  out();
  out(bold('Read from them'));
  const c = rep.checks;
  out(`  usage blocks         ${num(c.usage)} of ${num(c.replies)} replies`);
  out(`  compactions          ${num(c.compactions)}, ${num(c.compactionsWithTokens)} with token counts`);
  out(`  compaction summaries ${num(c.summaries)}`);
  out(`  AI titles            ${num(c.titles)}`);
  out(`  prompts              ${num(c.prompts)}`);
  out(`  file edits           ${num(c.edits)}`);
  out(`  request shapes       ${num(c.shapes)}`);
  const ix = loadIndex(st);
  out();
  out(ix ? `Store ${tilde(st.home)} holds ${num(ix.docs.length)} cards, indexed ${day(ix.built)}` : `Store ${tilde(st.home)} is empty, so run claude-ctx index.`);
}

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function cmdStatus(st: Store): void {
  const file = path.join(claudeDir(), 'settings.json');
  const rows: [string, string][] = [];
  let settings: Record<string, any> = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  const events = HOOKS.filter((hk) => Array.isArray(settings.hooks?.[hk.event]) && (settings.hooks[hk.event] as any[]).some((g) => (g?.hooks ?? []).some((h: any) => isOurs(h?.command, hookJs))));
  const missing = HOOKS.filter((hk) => !events.includes(hk));
  const plugin = Object.entries(settings.enabledPlugins ?? {}).some(([k, v]) => k.startsWith('ctx@') && v);
  if (events.length) rows.push(['Hooks', `${events.length} of ${HOOKS.length} in ${tilde(file)}${missing.length ? `, missing ${listHooks(missing)}` : ''}`]);
  else if (plugin) rows.push(['Hooks', 'from the ctx plugin']);
  else rows.push(['Hooks', 'not installed, run claude-ctx install']);
  const ix = loadIndex(st);
  const mb = (n: number) => `${n / MB < 10 ? (n / MB).toFixed(1) : Math.round(n / MB)} MB`;
  rows.push(['Store', `${mb(storeSize(st.home))} of ${mb(budgetBytes())}`]);
  rows.push(['Cards', ix ? `${num(ix.docs.length)}, indexed ${ago(Date.parse(ix.built))}` : 'none yet, run claude-ctx index']);
  let last: { event: string; at: number; chars: number; ms: number } | null = null;
  try {
    last = JSON.parse(fs.readFileSync(st.last, 'utf8'));
  } catch {}
  rows.push(['Last hook', last ? `${hookName(last.event)}, ${ago(last.at)}, printed ${num(last.chars)} characters in ${last.ms} ms` : 'none has run yet']);
  let err = '';
  try {
    const lines = fs.readFileSync(st.log, 'utf8').trim().split('\n');
    err = lines[lines.length - 1] ?? '';
  } catch {}
  rows.push(['Last error', err ? err.slice(0, 160) : 'none']);
  for (const [k, v] of rows) out(`${bold(k.padEnd(10))} ${v}`);
}

async function cmdOpen(st: Store, args: string[]): Promise<void> {
  const ix = loadIndex(st);
  if ((!ix || !ix.docs.length) && listTranscripts(claudeDir()).length) {
    out('No cards yet, so reading past sessions into cards first.');
    await cmdIndex(st, false, true);
  }
  const { serve } = await import('./server.ts');
  await serve(st, { open: !args.includes('--no-open') && !process.env.CLAUDE_CTX_NO_OPEN, port: Number(process.env.CLAUDE_CTX_PORT) || 0 });
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const st = store(ctxHome());
  const yes = rest.includes('--yes') || rest.includes('-y');
  switch (cmd) {
    case undefined:
    case 'open':
    case '--no-open':
      return cmdOpen(st, cmd === '--no-open' ? [cmd, ...rest] : rest);
    case 'search':
    case 's':
      return cmdSearch(st, rest);
    case 'index':
      return cmdIndex(st, rest.includes('--full'));
    case 'install':
      return cmdInstall(rest, yes);
    case 'uninstall':
      return cmdUninstall(rest, yes);
    case 'doctor':
      return cmdDoctor(st);
    case 'status':
      return cmdStatus(st);
    case 'help':
    case '--help':
    case '-h':
      out(commandList());
      return;
    case 'version':
    case '--version':
    case '-v':
      out(VERSION);
      return;
    default: {
      const near = COMMANDS.map(([c]) => c.split(' ')[1]).filter(Boolean).find((c) => c && (c.startsWith(cmd.slice(0, 2)) || cmd.startsWith(c.slice(0, 3))));
      out(near ? `There is no ${cmd} command, the closest is claude-ctx ${near}.` : `There is no ${cmd} command.`);
      out(commandList());
    }
  }
}

process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
});

main().catch((e) => {
  process.stderr.write(`claude-ctx: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
