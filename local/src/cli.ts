import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { projectName, resolveIds, ruleLine, shortIds, type Item, type RuleBody } from '../../core/src/index.ts';
import { Refusal, caller, file, folder, open, type Db } from './db.ts';
import { apply, detect, plan, unplan, type Agent, type Change, type Paths } from './install.ts';

declare const VERSION: string;

const NAMES: Record<Agent, string> = { 'claude-code': 'Claude Code', cursor: 'Cursor', codex: 'Codex', gemini: 'Gemini CLI', 'claude-desktop': 'the Claude desktop app' };
const AGENTS = Object.keys(NAMES) as Agent[];
const FILES = ['agent-ctx.mjs', 'hook.mjs', 'LICENSES.txt'];
const BACKUP = '.agent-ctx-backup';
const SOURCE = 'npx -y github:sohan-bhat/agent-ctx';
const SIGNS = ['CLAUDECODE', 'CURSOR_AGENT', 'CODEX_SANDBOX', 'GEMINI_CLI'];
const ASKS: Agent[] = ['cursor', 'codex', 'gemini', 'claude-desktop'];
const HELD = 'because the text has the form of an instruction to an agent';

type Row = { kind: string; status: string | null; held: number; n: number };

const say = (...lines: string[]): void => void process.stdout.write(lines.map((line) => `${line}\n`).join(''));
const list = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const lead = (text: string): string => text.slice(0, 1).toUpperCase() + text.slice(1);
const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const quote = (text: string): string => (/^[\w\-./:=@%+,\\]+$/.test(text) ? text : JSON.stringify(text));
const named = (agents: Agent[]): string => list(agents.map((agent) => NAMES[agent]));
const text = (path: string): string | null => (fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : null);
const real = (change: Change): boolean => !!change.run || change.after !== change.before;

function node(): string {
  const real = fs.realpathSync(process.execPath);
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const named = join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
    try {
      if (isAbsolute(dir) && fs.realpathSync(named) === real) return named;
    } catch {
      continue;
    }
  }
  return process.execPath;
}

function paths(): Paths {
  const platform = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux';
  return { home: homedir(), app: join(folder(), 'app', FILES[0]), node: node(), platform };
}

function self(p: Paths): string {
  const started = process.argv[1] ?? '';
  if (basename(started) === 'agent-ctx' && !started.includes('_npx')) return 'agent-ctx';
  return fs.existsSync(p.app) ? `node ${quote(p.app)}` : SOURCE;
}

function enter(line: string): Promise<boolean> {
  say(line);
  return new Promise((done) => {
    const lines = createInterface({ input: process.stdin });
    let pressed = false;
    lines.once('line', () => {
      pressed = true;
      lines.close();
    });
    lines.once('close', () => done(pressed));
  });
}

async function agreed(yes: boolean): Promise<boolean> {
  if (yes || !process.stdin.isTTY) return true;
  if (await enter('Press Enter to make these changes, or Control C to stop with nothing changed.')) return true;
  say('Nothing was changed.');
  return false;
}

function program(p: Paths): { to: string; stale: string[]; missing: string[] } {
  const from = dirname(fileURLToPath(import.meta.url));
  const to = dirname(p.app);
  const same = (name: string): boolean => {
    const there = join(to, name);
    return fs.existsSync(there) && fs.readFileSync(there).equals(fs.readFileSync(join(from, name)));
  };
  const missing = FILES.filter((name) => !fs.existsSync(join(from, name)));
  const here = fs.existsSync(to) && fs.realpathSync(to) === fs.realpathSync(from);
  return { to, missing, stale: here || missing.length ? [] : FILES.filter((name) => !same(name)) };
}

function place(to: string, names: string[]): void {
  const from = dirname(fileURLToPath(import.meta.url));
  fs.mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
  fs.mkdirSync(to, { recursive: true, mode: 0o700 });
  for (const name of names) {
    const temp = join(to, `${name}.tmp`);
    fs.copyFileSync(join(from, name), temp);
    fs.chmodSync(temp, name.endsWith('.mjs') ? 0o755 : 0o644);
    fs.renameSync(temp, join(to, name));
  }
}

function clear(to: string): boolean {
  for (const name of FILES) for (const path of [join(to, name), join(to, `${name}.tmp`)]) fs.rmSync(path, { force: true });
  try {
    fs.rmdirSync(to);
  } catch {
    return false;
  }
  try {
    fs.rmdirSync(dirname(to));
  } catch {
    return true;
  }
  return true;
}

function write(steps: () => void): boolean {
  try {
    steps();
    return true;
  } catch (error) {
    const path = (error as NodeJS.ErrnoException).path;
    say(path ? `${path} could not be written, so the work stopped there.` : error instanceof Error ? error.message : 'A file could not be written, so the work stopped there.');
    return false;
  }
}

function commands(changes: Change[], task: string): void {
  for (const { run } of changes) {
    if (!run) continue;
    const done = spawnSync(run[0], run.slice(1), { stdio: 'ignore', timeout: 180000, shell: process.platform === 'win32' });
    if (!done.error && done.status === 0) continue;
    say(`The plugin could not be ${task} from here, so type the next line in a terminal.`, run.join(' '));
  }
}

async function install(yes: boolean): Promise<number> {
  const p = paths();
  const found = detect(p);
  if (!found.length) {
    say('No agent was found on this computer, so nothing was changed.', `Supported agents are ${named(AGENTS)}.`);
    return 0;
  }
  const copy = program(p);
  if (copy.missing.length) {
    say(`${list(copy.missing)} ${copy.missing.length === 1 ? 'is' : 'are'} missing beside the program, so nothing was changed.`);
    return 1;
  }
  const changes = found.flatMap((agent) => plan(agent, p));
  const edits = changes.filter(real);
  const notes = changes.filter((change) => !real(change)).map((change) => change.what);
  say(`${lead(named(found))} ${found.length === 1 ? 'was' : 'were'} found on this computer.`);
  if (!edits.length && !copy.stale.length) {
    say(...notes, notes.length ? 'Nothing was changed.' : `${lead(named(found))} ${found.length === 1 ? 'is' : 'are'} already connected, so nothing was changed.`);
    return 0;
  }
  say(...(copy.stale.length ? [`The program is copied to ${copy.to}.`] : []), ...edits.map((change) => change.what), ...notes);
  if (!(await agreed(yes))) return 0;
  const written = write(() => {
    place(copy.to, copy.stale);
    apply(edits);
  });
  if (!written) return 1;
  commands(edits, 'installed');
  const asks = found.some((agent) => ASKS.includes(agent));
  say(`Open a new session in ${named(found)} so the memory is loaded.`, ...(asks ? ['Approve the agent-ctx server and hooks if an agent asks.'] : []), `Type ${self(p)} status to see what is connected.`);
  return 0;
}

async function uninstall(yes: boolean): Promise<number> {
  const p = paths();
  const found = detect(p);
  const recorded = fs.existsSync(join(p.home, '.claude', 'plugins', 'installed_plugins.json'));
  const changes = AGENTS.filter((agent) => agent !== 'claude-code' || (recorded && found.includes(agent))).flatMap((agent) => unplan(agent, p));
  const edits = changes.filter(real);
  const notes = changes.filter((change) => !real(change)).map((change) => change.what);
  const app = dirname(p.app);
  const copies: Change[] = [];
  for (const { file: path, run, after } of edits) {
    const kept = run ? null : text(path + BACKUP);
    if (kept === null) continue;
    if (kept === after) copies.push({ file: path + BACKUP, what: `${path + BACKUP} is removed, because ${path} is back to the text from before the install.`, before: kept, after: null });
    else notes.push(`${path + BACKUP} is kept as the copy from before the install, because ${path} has other changes since then.`);
  }
  const memory = fs.existsSync(file())
    ? [`The memory file ${file()} is kept.`, `To delete the memory, type ${p.platform === 'win32' ? `del ${JSON.stringify(`${file()}*`)}` : `rm -f ${quote(file())}*`}`]
    : ['No memory file exists, so nothing is kept.'];
  if (!edits.length && !fs.existsSync(app)) {
    say(...notes, 'No agent on this computer is connected to agent-ctx, so nothing was changed.', ...memory);
    return 0;
  }
  say(...edits.map((change) => change.what), ...copies.map((change) => change.what), ...(fs.existsSync(app) ? [`The program folder ${app} is removed.`] : []), ...notes);
  if (!(await agreed(yes))) return 0;
  const written = write(() => apply([...edits, ...copies]));
  if (!written) return 1;
  if (fs.existsSync(app) && !clear(app)) say(`${app} contains other files and stays in place.`);
  commands(edits, 'removed');
  say(...memory);
  return 0;
}

function size(bytes: number): string {
  if (bytes < 1024) return count(bytes, 'byte');
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb).toLocaleString('en-US')} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function status(): number {
  const p = paths();
  const path = file();
  const lines = [`agent-ctx ${VERSION}`];
  if (!fs.existsSync(path)) lines.push(`No memory file exists yet at ${path}.`);
  else {
    try {
      const db = open();
      try {
        const rows = db.exec("SELECT kind, json_extract(body, '$.status') AS status, held, COUNT(*) AS n FROM items GROUP BY 1, 2, 3").toArray() as Row[];
        const sum = (keep: (row: Row) => boolean): number => rows.filter(keep).reduce((n, row) => n + Number(row.n), 0);
        const pending = sum((row) => row.kind === 'rule' && row.status === 'pending' && !row.held);
        const bytes = [path, `${path}-wal`].reduce((n, part) => n + (fs.statSync(part, { throwIfNoEntry: false })?.size ?? 0), 0);
        lines.push(`The memory file is ${path} with ${size(bytes)}.`);
        lines.push(`The memory has ${count(sum((row) => row.kind === 'card'), 'card')}, ${count(sum((row) => row.kind === 'handoff'), 'handoff')} and ${count(sum((row) => row.kind === 'rule' && row.status === 'active' && !row.held), 'active rule')}.`);
        if (pending) lines.push(`${lead(count(pending, 'rule is', 'rules are'))} pending. Type ${self(p)} rules to read ${pending === 1 ? 'the rule' : 'each rule'}.`);
      } finally {
        db.close();
      }
    } catch (error) {
      lines.push(error instanceof Refusal ? error.message : `The memory file at ${path} could not be opened.`);
    }
  }
  const found = detect(p);
  const on = found.filter((agent) => !plan(agent, p).length);
  const off = found.filter((agent) => !on.includes(agent));
  lines.push(on.length ? `${lead(named(on))} ${on.length === 1 ? 'is' : 'are'} connected.` : 'No agent is connected.');
  if (off.length) lines.push(`${lead(named(off))} ${off.length === 1 ? 'was found and is' : 'were found and are'} not connected. Type ${self(p)} install to connect.`);
  say(...lines);
  return 0;
}

async function rules(args: string[]): Promise<number> {
  const p = paths();
  const me = self(p);
  const [verb, asked] = args;
  if (verb !== undefined && ((verb !== 'accept' && verb !== 'reject') || !asked)) {
    say(`Type ${me} rules to list the pending rules, ${me} rules accept ID to turn a rule on, or ${me} rules reject ID to turn a rule down.`);
    return 1;
  }
  if (verb && (!process.stdin.isTTY || !process.stdout.isTTY || SIGNS.some((sign) => process.env[sign] !== undefined))) {
    say(`A rule is turned on or down by a person at a terminal, so type ${me} rules ${verb} ID in a terminal of your own.`);
    return 1;
  }
  if (!fs.existsSync(file())) {
    say('No rule is pending.');
    return verb ? 1 : 0;
  }
  let db: Db;
  try {
    db = open();
  } catch (error) {
    say(error instanceof Refusal ? error.message : `The memory file at ${file()} could not be opened.`);
    return 1;
  }
  try {
    return await caller(db)(async (engine) => {
      const all = engine.store.rules().sort((a, b) => a.created - b.created);
      const waiting = all.filter((item) => (item.body as RuleBody).status === 'pending');
      const pending = waiting.filter((item) => !item.held);
      const held = waiting.filter((item) => item.held);
      const ids = shortIds(all);
      const short = (item: Item): string => ids.get(item.id) ?? item.id;
      if (!verb) {
        const rows = pending.map((item) => {
          const body = item.body as RuleBody;
          const where = body.scope === 'all' ? 'all projects' : `the project ${projectName(item.project) || 'unknown'}`;
          return `${short(item)} ${ruleLine(body)} for ${where}, proposed in ${item.origin.agent} on ${new Date(item.created).toISOString().slice(0, 10)}`;
        });
        say(pending.length ? `${lead(count(pending.length, 'rule is', 'rules are'))} pending.` : 'No rule is pending.', ...rows);
        if (pending.length) say(`Type ${me} rules accept ID to turn a rule on, or ${me} rules reject ID to turn a rule down.`);
        if (held.length) say(`${lead(count(held.length, 'rule is', 'rules are'))} held and ${held.length === 1 ? 'stays' : 'stay'} off, ${HELD}.`);
        return 0;
      }
      const hit = resolveIds(waiting, [asked ?? ''])[0];
      if (!hit) {
        say(`No pending rule has the id ${(asked ?? '').replace(/[^\w-]+/g, '').slice(0, 40)}. Type ${me} rules to list the pending rules.`);
        return 1;
      }
      if (verb === 'accept' && hit.held) {
        say(`Rule ${short(hit)} is held and stays off, ${HELD}.`);
        return 1;
      }
      await engine.setRule(hit.id, verb === 'accept' ? 'active' : 'off');
      say(verb === 'accept' ? `Rule ${short(hit)} is active, and every agent reads the rule as your own words from the next session on.` : `Rule ${short(hit)} is turned down and stays off.`);
      return 0;
    });
  } finally {
    db.close();
  }
}

function about(): string[] {
  return [
    `agent-ctx ${VERSION} is one memory on this computer, shared by every agent you use.`,
    `The memory is kept in one file at ${file()} and nothing stays open in the background.`,
    'agent-ctx install      connect every agent found on this computer',
    'agent-ctx status       the memory file and the connected agents',
    'agent-ctx rules        the pending rules, with accept ID and reject ID',
    'agent-ctx uninstall    take agent-ctx out and keep the memory',
  ];
}

export async function run(args: string[]): Promise<number> {
  const command = args.find((arg) => !arg.startsWith('-'));
  const has = (flag: string): boolean => args.includes(flag);
  if (has('--help') || has('-h')) {
    say(...about());
    return 0;
  }
  if (has('--version')) {
    say(VERSION);
    return 0;
  }
  if (command === undefined || command === 'install') return install(has('--yes'));
  if (command === 'uninstall') return uninstall(has('--yes'));
  if (command === 'status') return status();
  if (command === 'rules') return rules(args.slice(args.indexOf('rules') + 1).filter((arg) => !arg.startsWith('-')));
  process.stderr.write(`${[`No command named ${command.replace(/[^\w.-]+/g, '').slice(0, 40)} exists in this version.`, ...about()].join('\n')}\n`);
  return 1;
}
