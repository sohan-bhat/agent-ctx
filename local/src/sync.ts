import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { Engine } from '../../service/src/engine.ts';
import { SAY } from '../../service/src/limits.ts';
import { Refusal, caller, file, folder as home, open, who, type Call } from './db.ts';
import { line, logPath, merge, note, outgoing, pages, parse, readme, type Rec } from './mirror.ts';

export interface State { device: string; folder: string; on: boolean; exported: number; synced: number; said: string }
export interface Lock { pid: number; at: number; done?: number }
export interface Done { ok: boolean; line: string; taken: number }
export interface Io { say(...lines: string[]): void; agreed(): Promise<boolean>; me: string }

interface Out { path: string; text: string; append: boolean }
interface Plan { files: Out[]; sent: number; taken: number; hidden: number; notes: number; said: string; at: number }
interface Place { folder: string; lines: string[]; make(): string | null }

export const STATE = 'mirror';
export const LOCK = 'mirror:lock';
const READ = 'mirror:read';
const INBOX = 'mirror:inbox';
const LOCK_MS = 10 * 60000;
const GIT_MS = 60000;
const GH_MS = 120000;
const DAY = 86400000;
const NOTE_BYTES = 8192;
const DEVICE = /^[a-z0-9-]{8,32}$/;
const MONTH = /^\d{4}-\d{2}\.jsonl$/;
const REPO = 'agent-ctx-memory';
const MESSAGE = 'agent-ctx sync';
const INDEX = 'pages/index.md';
const README = 'README.md';
const WRITTEN = ['log', 'pages', README];
const KNOWN = new Set([...WRITTEN, 'inbox', '.git', '.gitignore', '.gitattributes', '.DS_Store', 'LICENSE']);
const CLOUD = /^\..+\.icloud$/;
const BROWSER = who('browser');
const WAITS = new Set([SAY.minute, SAY.day, SAY.stored, SAY.full, SAY.agents, SAY.projects]);
const OFF = 'No mirror is on, so nothing was synced.';
const BUSY = 'Another sync is running on this computer, so this sync ended at once.';
const BROKE = 'The sync stopped on an error before the end, and the memory on this computer is intact.';

class Failed extends Error {}

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const isDir = (path: string): boolean => fs.lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
const isFile = (path: string): boolean => fs.lstatSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
const isFolder = (path: string): boolean => fs.statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
const fresh = (): string => randomBytes(8).toString('hex');

function git(root: string, ...args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: GIT_MS, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true });
  return { ok: !r.error && r.status === 0, out: (r.stdout ?? '').trim() };
}

function remote(root: string): string | null {
  return fs.existsSync(join(root, '.git')) ? git(root, 'remote').out.split('\n')[0] || null : null;
}

function theirs(root: string, name: string): string {
  const branch = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD').out;
  return branch ? git(root, 'rev-parse', '--verify', '--quiet', `refs/remotes/${name}/${branch}`).out : '';
}

function pull(root: string, name: string): void {
  if (!git(root, 'fetch', '--quiet', name).ok) throw new Failed('The remote of the mirror could not be reached, so nothing was synced.');
  const ahead = theirs(root, name);
  if (ahead && !git(root, 'merge', '--ff-only', '--quiet', ahead).ok) throw new Failed(`The mirror folder ${root} and the remote went separate ways, so nothing was synced. Type git -C ${root} status to look.`);
}

function push(root: string, name: string): void {
  const head = (): string => git(root, 'rev-parse', '--verify', '--quiet', 'HEAD').out;
  const before = head();
  const back = (): void => void (head() !== before && (before ? git(root, 'reset', '--quiet', '--mixed', before) : git(root, 'update-ref', '-d', 'HEAD')));
  const signed = ['-c', 'commit.gpgsign=false', ...(git(root, 'config', 'user.email').out ? [] : ['-c', 'user.name=agent-ctx', '-c', 'user.email=agent-ctx@localhost'])];
  const own = WRITTEN.filter((name) => fs.existsSync(join(root, name)) || git(root, 'ls-files', '--', name).out);
  if (own.length && (!git(root, 'add', '-A', '--', ...own).ok || (!git(root, 'diff', '--cached', '--quiet', '--', ...own).ok && !git(root, ...signed, 'commit', '--quiet', '-m', MESSAGE, '--', ...own).ok))) {
    back();
    throw new Failed(`The changes could not be committed in the mirror folder ${root}, so nothing was sent.`);
  }
  const now = head();
  if (!now || theirs(root, name) === now || git(root, 'push', '--quiet', '-u', name, 'HEAD').ok) return;
  back();
  throw new Failed('The mirror could not be pushed to the remote, so the changes of this computer are sent at the next sync.');
}

function slice(path: string, from: number, to: number): Buffer {
  const part = Buffer.alloc(to - from);
  const fd = fs.openSync(path, 'r');
  try {
    fs.readSync(fd, part, 0, part.length, from);
  } finally {
    fs.closeSync(fd);
  }
  return part;
}

function foreign(root: string, device: string, read: Record<string, number>): { recs: Rec[]; bad: number; open: string; read: Record<string, number> } {
  const next = { ...read };
  const recs: Rec[] = [];
  const base = join(root, 'log');
  let bad = 0;
  let open = '';
  for (const dir of isDir(base) ? fs.readdirSync(base).sort() : []) {
    if (dir === device || !DEVICE.test(dir) || !isDir(join(base, dir))) continue;
    for (const name of fs.readdirSync(join(base, dir)).sort()) {
      const path = join(base, dir, name);
      if (!MONTH.test(name) || !isFile(path)) continue;
      const key = `log/${dir}/${name}`;
      const size = fs.statSync(path).size;
      const from = (next[key] ?? 0) <= size ? (next[key] ?? 0) : 0;
      if (size === from) continue;
      const part = slice(path, from, size);
      const end = part.lastIndexOf(10) + 1;
      if (end < part.length) open = key;
      const got = parse(part.subarray(0, end).toString('utf8'));
      for (const rec of got.recs) {
        if (rec.device === dir) recs.push(rec);
        else bad++;
      }
      bad += got.bad;
      next[key] = from + end;
    }
  }
  return { recs, bad, open, read: next };
}

function inbox(root: string, seen: Record<string, number>): { name: string; size: number; text: string }[] {
  const base = join(root, 'inbox');
  const out: { name: string; size: number; text: string }[] = [];
  for (const name of isDir(base) ? fs.readdirSync(base).sort() : []) {
    const size = fs.lstatSync(join(base, name), { throwIfNoEntry: false });
    if (!size?.isFile() || name.startsWith('.') || seen[name] === size.size) continue;
    out.push({ name, size: size.size, text: size.size > NOTE_BYTES ? '' : fs.readFileSync(join(base, name), 'utf8') });
  }
  return out;
}

function noteId(text: string): string {
  const h = createHash('sha256').update(text).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join('-');
}

async function take(engine: Engine, state: State, root: string): Promise<Plan> {
  const now = Date.now();
  const store = engine.store;
  const logs = foreign(root, state.device, store.meta<Record<string, number>>(READ, {}));
  const known = [...new Set(logs.recs.map((r) => r.id))].flatMap((id) => store.timed(id) ?? []);
  const when: Record<string, number> = {};
  for (const r of logs.recs) if (r.op === 'drop' && r.at <= now + DAY) when[r.id] = Math.max(when[r.id] ?? 0, r.at);
  const got = engine.merged(merge(known, logs.recs, state.device, now), when);
  store.setMeta(READ, logs.read);
  const seen = store.meta<Record<string, number>>(INBOX, {});
  let notes = 0;
  for (const f of inbox(root, seen)) {
    const n = note(`inbox/${f.name}`, f.text);
    const r = n ? await engine.note(BROWSER, { id: noteId(f.text), project: n.project, text: n.text }) : null;
    if (r && !r.ok && WAITS.has(r.text)) continue;
    seen[f.name] = f.size;
    if (r?.ok && r.item) notes++;
  }
  store.setMeta(INBOX, seen);
  const changed = engine.changes(state.exported);
  const at = Date.now();
  while (Date.now() === at) continue;
  const lines = new Map<string, string[]>();
  for (const rec of outgoing(changed.items.filter((i) => i.kind !== 'dropped'), changed.removed, state.exported, state.device)) {
    try {
      const path = logPath(state.device, rec.at);
      lines.set(path, [...(lines.get(path) ?? []), line(rec)]);
    } catch {
      continue;
    }
  }
  const files: Out[] = [...lines].map(([path, rows]) => ({ path, text: `${rows.join('\n')}\n`, append: true }));
  const sent = [...lines.values()].reduce((n, rows) => n + rows.length, 0);
  if (sent || !isFile(join(root, INDEX)) || !isFile(join(root, README))) {
    for (const [path, text] of Object.entries({ [README]: readme(), ...pages(store.all(), [], at) })) {
      if (!isFile(join(root, path)) || fs.readFileSync(join(root, path), 'utf8') !== text) files.push({ path, text, append: false });
    }
  }
  const said = [logs.bad ? `${count(logs.bad, 'line')} in the logs of other computers could not be read and ${logs.bad === 1 ? 'was' : 'were'} passed over.` : '', logs.open ? `The last line of ${logs.open} is not complete, so that line is read at a later sync.` : ''].filter(Boolean).join(' ');
  return { files, sent, taken: got.put.length, hidden: got.hidden.length, notes, said, at };
}

function write(root: string, files: Out[]): () => void {
  const done: { file: string; size: number | null; before: Buffer | null }[] = [];
  const undo = (): void => {
    for (const d of done.reverse()) {
      try {
        if (d.size === null) fs.rmSync(d.file, { force: true });
        else if (d.before) fs.writeFileSync(d.file, d.before);
        else fs.truncateSync(d.file, d.size);
      } catch {
        continue;
      }
    }
  };
  try {
    for (const f of files) {
      let file = root;
      for (const part of f.path.split('/')) {
        file = join(file, part);
        if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Failed(`${file} is a link, so nothing was written to the mirror folder.`);
      }
      const size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? null;
      fs.mkdirSync(dirname(file), { recursive: true });
      done.push({ file, size, before: f.append || size === null ? null : fs.readFileSync(file) });
      if (f.append) fs.appendFileSync(file, `${size && slice(file, size - 1, size)[0] !== 10 ? '\n' : ''}${f.text}`);
      else fs.writeFileSync(file, f.text);
    }
  } catch (e) {
    undo();
    throw e instanceof Failed ? e : new Failed(`The mirror folder ${root} could not be written, so nothing was sent.`);
  }
  return undo;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function steps(call: Call, state: State): Promise<Plan> {
  const root = state.folder;
  if (!isFolder(root)) throw new Failed(`The mirror folder ${root} is missing, so nothing was synced.`);
  const name = remote(root);
  if (name) pull(root, name);
  const plan = await call((engine) => take(engine, state, root));
  const undo = write(root, plan.files);
  try {
    if (name) push(root, name);
  } catch (e) {
    undo();
    throw e;
  }
  return plan;
}

export async function sync(): Promise<Done> {
  if (!fs.existsSync(file())) return { ok: false, line: OFF, taken: 0 };
  try {
    const db = open();
    try {
      const call = caller(db);
      const started = Date.now();
      const first = await call(async (engine) => {
        const state = engine.store.meta<State | null>(STATE, null);
        if (!state?.on) return OFF;
        const lock = engine.store.meta<Lock | null>(LOCK, null);
        if (lock && !lock.done && started - lock.at < LOCK_MS && alive(lock.pid)) return BUSY;
        engine.store.setMeta(LOCK, { pid: process.pid, at: started } satisfies Lock);
        return state;
      });
      if (typeof first === 'string') return { ok: false, line: first, taken: 0 };
      const end = (more: Partial<State>): Promise<void> =>
        call(async (engine) => {
          engine.store.setMeta(STATE, { ...first, ...engine.store.meta<Partial<State>>(STATE, {}), synced: Date.now(), ...more });
          engine.store.setMeta(LOCK, { pid: process.pid, at: started, done: Date.now() } satisfies Lock);
        });
      try {
        const plan = await steps(call, first);
        await end({ exported: plan.at, said: plan.said });
        return { ok: true, taken: plan.taken, line: `The sync is done with ${count(plan.sent, 'item')} sent, ${count(plan.taken, 'item')} taken, ${count(plan.hidden, 'item')} hidden and ${count(plan.notes, 'note')} read.` };
      } catch (e) {
        const said = e instanceof Failed ? e.message : BROKE;
        await end({ said });
        return { ok: false, line: said, taken: 0 };
      }
    } finally {
      db.close();
    }
  } catch (e) {
    return { ok: false, line: e instanceof Refusal ? e.message : BROKE, taken: 0 };
  }
}

async function stored<T>(fn: (engine: Engine) => T): Promise<T> {
  const db = open();
  try {
    return await caller(db)(async (engine) => fn(engine));
  } finally {
    db.close();
  }
}

function real(path: string): string {
  const rest: string[] = [];
  for (let at = resolve(path); ; at = dirname(at)) {
    try {
      return join(fs.realpathSync(at), ...rest);
    } catch {
      if (dirname(at) === at) return resolve(path);
      rest.unshift(basename(at));
    }
  }
}

function program(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const path = join(dir, process.platform === 'win32' ? `${name}.exe` : name);
    if (isAbsolute(dir) && fs.statSync(path, { throwIfNoEntry: false })?.isFile()) return path;
  }
  return null;
}

function github(target: string, io: Io): Place | null {
  const path = program('gh');
  const gh = (...args: string[]) => spawnSync(path ?? 'gh', args, { encoding: 'utf8', timeout: GH_MS, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  if (!path || gh('auth', 'status').status !== 0) {
    io.say('The gh program is missing or not signed in, so the mirror is made by hand in three steps.', `First make a private repository named ${REPO} on github.com.`, `Then type git clone ADDRESS ${target} with the address of that repository.`, `Then type ${io.me} mirror on ${target}`);
    return null;
  }
  const make = (): string | null => {
    if (remote(target)) return null;
    if (fs.existsSync(target) && (!isFolder(target) || fs.readdirSync(target).length)) return `${target} exists and is no clone of the repository, so no mirror was turned on.`;
    const seen = gh('repo', 'view', REPO, '--json', 'isPrivate', '--jq', '.isPrivate');
    if (seen.status === 0 && seen.stdout.trim() !== 'true') return `The repository ${REPO} in your account is public, so no mirror was turned on. Make the repository private first.`;
    if (seen.status !== 0 && gh('repo', 'create', REPO, '--private').status !== 0) return `The repository ${REPO} could not be made in your account, so no mirror was turned on.`;
    fs.mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    if (gh('repo', 'clone', REPO, target).status !== 0) return `The repository ${REPO} could not be cloned to ${target}, so no mirror was turned on.`;
    git(target, 'config', '--local', 'credential.https://github.com.helper', '');
    git(target, 'config', '--local', '--add', 'credential.https://github.com.helper', `!${JSON.stringify(path)} auth git-credential`);
    return null;
  };
  return { folder: target, make, lines: [`A private repository named ${REPO} is made in your GitHub account, or used again when one exists.`, `The repository is cloned to ${target}, and each sync is pushed to that repository.`] };
}

function place(target: string, io: Io): Place | null {
  const written = 'The folders log and pages and the file README.md are written there at each sync, and the memory file stays on this computer.';
  if (target === 'github') return github(join(home(), 'mirror'), io);
  if (target === 'icloud') {
    const drive = [join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), join(homedir(), 'iCloudDrive')].find(isFolder);
    if (!drive) {
      io.say('iCloud Drive was not found in the home folder, so no mirror was turned on.');
      return null;
    }
    const dir = join(drive, 'agent-ctx');
    const make = (): null => {
      fs.mkdirSync(dir, { recursive: true });
      return null;
    };
    return { folder: dir, make, lines: [`The mirror is turned on for the folder ${dir} in iCloud Drive.`, written] };
  }
  const dir = resolve(target);
  if (!isFolder(dir)) {
    io.say(`${dir} is not a folder on this computer, so no mirror was turned on.`);
    return null;
  }
  return { folder: dir, make: () => null, lines: [`The mirror is turned on for the folder ${dir}.`, written, ...(remote(dir) ? ['Each sync is pushed to the remote of that folder, so keep the repository there private.'] : [])] };
}

function refused(dir: string): string | null {
  const mine = real(home());
  const there = real(dir);
  if (there !== join(mine, 'mirror') && (there === mine || mine.startsWith(there + sep) || there.startsWith(mine + sep))) return `The folder ${dir} contains the agent-ctx folder of this computer or lies inside that folder, so no mirror was turned on there.`;
  const other = (isFolder(there) ? fs.readdirSync(there) : []).sort().find((name) => !KNOWN.has(name) && !CLOUD.test(name));
  return other === undefined ? null : `The folder ${dir} holds other files such as ${other.replace(/[^\w.-]+/g, '').slice(0, 40)}, so no mirror was turned on there. A mirror needs an empty folder or a folder that already holds a mirror.`;
}

async function turn(target: string, io: Io, renew: boolean, lines: (dir: string) => string[]): Promise<string | null> {
  const where = place(target, io);
  if (!where) return null;
  const no = refused(where.folder);
  if (no) {
    io.say(no);
    return null;
  }
  io.say(...lines(where.folder), ...where.lines.slice(renew ? 1 : 0));
  if (!(await io.agreed())) return null;
  const failed = where.make();
  if (failed) {
    io.say(failed);
    return null;
  }
  await stored((engine) => {
    const old = engine.store.meta<State | null>(STATE, null);
    const same = !renew && !!old && old.folder === where.folder;
    if (!same) for (const key of [READ, INBOX]) engine.store.dropMeta(key);
    engine.store.setMeta(STATE, { device: renew || !old ? fresh() : old.device, folder: where.folder, on: true, exported: same ? old.exported : 0, synced: same ? old.synced : 0, said: '' } satisfies State);
  });
  return where.folder;
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${count(minutes, 'minute')} ago`;
  return minutes < 1440 ? `${count(Math.floor(minutes / 60), 'hour')} ago` : `${count(Math.floor(minutes / 1440), 'day')} ago`;
}

async function status(io: Io): Promise<number> {
  const state = fs.existsSync(file()) ? await stored((engine) => engine.store.meta<State | null>(STATE, null)) : null;
  if (state?.on) {
    io.say(`A mirror is on in the folder ${state.folder}.`, state.synced ? `The last sync ended ${ago(Date.now() - state.synced)}.` : 'No sync has ended yet.', ...(state.said ? [state.said] : []), `Type ${io.me} sync to sync now, or ${io.me} mirror off to stop.`);
    return 0;
  }
  io.say(
    'No mirror is on, so the memory exists only on this computer.',
    `Type ${io.me} mirror on github for a private repository named ${REPO} in your GitHub account.`,
    `Type ${io.me} mirror on icloud for the folder agent-ctx in iCloud Drive.`,
    `Type ${io.me} mirror on FOLDER for a folder that another program keeps in sync.`,
    `Type ${io.me} restore to fill an empty memory from a mirror.`,
  );
  return 0;
}

async function restore(target: string | undefined, io: Io): Promise<number> {
  const before = fs.existsSync(file()) ? await stored((engine) => ({ items: engine.store.count('items'), state: engine.store.meta<State | null>(STATE, null) })) : { items: 0, state: null };
  if (before.items) {
    io.say('The memory on this computer is not empty, so nothing was restored and nothing was overwritten.');
    return 1;
  }
  const known = target ?? before.state?.folder ?? [join(home(), 'mirror'), join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'agent-ctx'), join(homedir(), 'iCloudDrive', 'agent-ctx')].find(isFolder);
  if (!known) {
    io.say(`No mirror was found for this computer. Type ${io.me} restore github, ${io.me} restore icloud or ${io.me} restore FOLDER.`);
    return 1;
  }
  const dir = await turn(known, io, true, (d) => [`The memory of this computer is filled from the mirror in ${d}.`, 'This computer gets a new device name in the mirror, and every rule arrives as pending.']);
  if (!dir) return 1;
  const done = await sync();
  if (!done.ok) {
    io.say(done.line);
    return 1;
  }
  io.say(`${count(done.taken, 'item was', 'items were')} restored from ${dir}.`, `Type ${io.me} rules to read each pending rule.`);
  return 0;
}

export async function command(name: string, args: string[], io: Io): Promise<number> {
  if (name === 'restore') return restore(args[0], io);
  if (name === 'sync') {
    const done = await sync();
    io.say(done.line);
    return done.ok ? 0 : 1;
  }
  const [verb, target] = args;
  if (verb === undefined) return status(io);
  if (verb === 'off') {
    const state = fs.existsSync(file()) ? await stored((engine) => engine.store.meta<State | null>(STATE, null)) : null;
    if (!state?.on) {
      io.say('No mirror is on, so nothing was changed.');
      return 0;
    }
    await stored((engine) => engine.store.setMeta(STATE, { ...state, on: false } satisfies State));
    io.say(`The mirror is off, and the folder ${state.folder} stays as found.`);
    return 0;
  }
  if (verb !== 'on' || !target) {
    io.say(`Type ${io.me} mirror on github, ${io.me} mirror on icloud, ${io.me} mirror on FOLDER or ${io.me} mirror off.`);
    return 1;
  }
  const dir = await turn(target, io, false, () => []);
  if (!dir) return 1;
  io.say(`The mirror is on in ${dir}.`, (await sync()).line);
  return 0;
}
