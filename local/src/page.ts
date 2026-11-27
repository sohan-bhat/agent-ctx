import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { body, buildExport, err, pageApi, type PageMemory } from '../../service/src/api.ts';
import { Refusal, caller, file, folder, open, typed, type Db } from './db.ts';
import { apply, detect, plan, unplan, type Agent, type Change, type Paths } from './install.ts';

export interface Kit {
  paths(): Paths;
  program(p: Paths): { to: string; stale: string[]; missing: string[] };
  place(to: string, names: string[]): void;
  signs: string[];
}

interface Steps { connected: boolean; command: string | null; lines: string[]; write: (() => void) | null }

const NAME = 'agent-ctx-page.tgz';
const SUMS = 'SHA256SUMS';
const RELEASES = 'https://github.com/sohan-bhat/agent-ctx/releases/latest/download';
const AGENTS: Agent[] = ['claude-code', 'cursor', 'codex', 'gemini', 'claude-desktop'];
const BACKUP = '.agent-ctx-backup';
const refused = (): string => `Type ${typed()} page in a terminal to open the memory page.`;
const STALE = 'These changes are different now. Read the lines again.';
const QUIET = 30;
const FIRST = 300;
const HELD = 20000;
const LOOK = 250;
const BLOCK = 512;
const BODY_MAX = 64 * 1024;
const PACKED_MAX = 32 * 1024 * 1024;
const UNPACKED_MAX = 128 * 1024 * 1024;
const PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHIELD = ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options'];
const PLAIN = 'text/plain; charset=utf-8';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const say = (line: string): void => void process.stdout.write(`${line}\n`);
const real = (change: Change): boolean => !!change.run || change.after !== change.before;
const text = (path: string): string | null => (fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : null);
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export function opener(platform: string, address: string): string[] {
  if (platform === 'darwin') return ['open', address];
  if (platform === 'win32') return ['cmd', '/c', 'start', '', address];
  return ['xdg-open', address];
}

async function get(address: string): Promise<Buffer> {
  const res = await fetch(address, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(String(res.status));
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > PACKED_MAX) throw new Error('size');
  return bytes;
}

function unpack(packed: Buffer): [string, Buffer][] {
  const tar = gunzipSync(packed, { maxOutputLength: UNPACKED_MAX });
  const out: [string, Buffer][] = [];
  const field = (head: Buffer, from: number, size: number): string => {
    const part = head.subarray(from, from + size);
    const end = part.indexOf(0);
    return part.toString('utf8', 0, end < 0 ? size : end);
  };
  for (let at = 0; at + BLOCK <= tar.length; ) {
    const head = tar.subarray(at, at + BLOCK);
    if (head.every((b) => b === 0)) break;
    const size = parseInt(field(head, 124, 12).trim() || '0', 8);
    const kind = field(head, 156, 1) || '0';
    const name = [field(head, 345, 155), field(head, 0, 100)].filter(Boolean).join('/').replace(/^(\.\/)+/, '');
    at += BLOCK;
    if (!Number.isSafeInteger(size) || size < 0 || at + size > tar.length) throw new Error('size');
    const data = tar.subarray(at, at + size);
    at += Math.ceil(size / BLOCK) * BLOCK;
    if (kind === '5' || kind === 'x' || kind === 'g') continue;
    if (kind !== '0' || !name.split('/').every((part) => PART.test(part) || part === '_headers')) throw new Error('entry');
    out.push([name, Buffer.from(data)]);
  }
  if (!out.some(([name]) => name === 'index.html')) throw new Error('index');
  return out;
}

async function files(): Promise<string | null> {
  const named = process.env.AGENT_CTX_PAGE_DIR;
  const dir = named || join(folder(), 'app', 'page');
  if (fs.existsSync(join(dir, 'index.html'))) return dir;
  if (named) {
    say(`No page files were found in ${dir}, so nothing was started.`);
    return null;
  }
  const base = (process.env.AGENT_CTX_RELEASES || RELEASES).replace(/\/+$/, '');
  let packed: Buffer;
  let sums: string;
  try {
    [packed, sums] = await Promise.all([get(`${base}/${NAME}`), get(`${base}/${SUMS}`).then((bytes) => bytes.toString('utf8'))]);
  } catch {
    say(`The page files could not be fetched from ${base}, so nothing was changed.`);
    return null;
  }
  const hash = createHash('sha256').update(packed).digest('hex');
  const listed = sums.split('\n').map((line) => /^([0-9a-f]{64})\s+\*?(?:\.\/)?(\S+)\s*$/i.exec(line)).find((row) => row?.[2] === NAME);
  if (listed?.[1].toLowerCase() !== hash) {
    say(`The fetched page files do not match the hash in ${SUMS}, so nothing was kept.`);
    return null;
  }
  let entries: [string, Buffer][];
  try {
    entries = unpack(packed);
  } catch {
    say('The fetched page files could not be unpacked, so nothing was kept.');
    return null;
  }
  const temp = `${dir}.${process.pid}.tmp`;
  try {
    for (const [name, data] of entries) {
      const to = join(temp, ...name.split('/'));
      fs.mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
      fs.writeFileSync(to, data, { mode: 0o644 });
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(temp, dir);
  } catch {
    fs.rmSync(temp, { recursive: true, force: true });
    say(`The page files could not be written to ${dir}, so nothing was started.`);
    return null;
  }
  say(`The page files were fetched once and are kept in ${dir}.`);
  return dir;
}

function shield(dir: string): Record<string, string> {
  const out: Record<string, string> = { 'cache-control': 'no-store' };
  for (const line of (text(join(dir, '_headers')) ?? '').split('\n')) {
    const row = /^\s+([A-Za-z-]+):\s*(\S.*?)\s*$/.exec(line);
    if (row && SHIELD.includes(row[1].toLowerCase())) out[row[1].toLowerCase()] = row[2];
  }
  return out;
}

function steps(kit: Kit, agent: Agent, p: Paths): Steps {
  const connected = !plan(agent, p).length;
  const changes = connected ? unplan(agent, p) : plan(agent, p);
  const run = changes.find((change) => change.run)?.run;
  if (run) return { connected, command: run.join(' '), lines: [], write: null };
  const edits = changes.filter(real);
  const notes = changes.filter((change) => !real(change)).map((change) => change.what);
  if (connected) {
    const copies: Change[] = [];
    for (const { file: path, after } of edits) {
      const kept = text(path + BACKUP);
      if (kept === null) continue;
      if (kept === after) copies.push({ file: path + BACKUP, what: `${path + BACKUP} is removed, because ${path} is back to the text from before the install.`, before: kept, after: null });
      else notes.push(`${path + BACKUP} is kept as the copy from before the install, because ${path} has other changes since then.`);
    }
    const all = [...edits, ...copies];
    return { connected, command: null, lines: [...all.map((change) => change.what), ...notes], write: edits.length ? () => apply(all) : null };
  }
  const copy = kit.program(p);
  if (copy.missing.length) return { connected, command: null, lines: [`${copy.missing.join(' and ')} ${copy.missing.length === 1 ? 'is' : 'are'} missing beside the program, so no agent can be connected from this page.`], write: null };
  const lead = copy.stale.length && edits.length ? [`The program is copied to ${copy.to}.`] : [];
  const write = (): void => {
    kit.place(copy.to, copy.stale);
    apply(edits);
  };
  return { connected, command: null, lines: [...lead, ...edits.map((change) => change.what), ...notes], write: edits.length ? write : null };
}

async function scrub(db: Db): Promise<void> {
  for (let tries = 0; tries < 4; tries++) {
    try {
      db.exec('VACUUM');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      return;
    } catch {
      await pause(50);
    }
  }
}

function same(given: string, token: string): boolean {
  const mark = (text: string): Buffer => createHash('sha256').update(text).digest();
  return timingSafeEqual(mark(given), mark(token));
}

async function sent(req: IncomingMessage): Promise<Buffer | null> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    size += (part as Buffer).length;
    if (size > BODY_MAX) return null;
    parts.push(part as Buffer);
  }
  return Buffer.concat(parts);
}

export async function page(kit: Kit): Promise<number> {
  const p = kit.paths();
  if (kit.signs.some((sign) => process.env[sign] !== undefined)) {
    say(`The memory page is opened by a person at a terminal, so type ${typed()} page in a terminal of your own.`);
    return 1;
  }
  const dir = await files();
  if (!dir) return 1;
  let db: Db;
  try {
    db = open();
  } catch (error) {
    say(error instanceof Refusal ? error.message : `The memory file at ${file()} could not be opened.`);
    return 1;
  }
  const guard = shield(dir);
  const token = randomBytes(24).toString('base64url');
  const call = caller(db);
  const memory: PageMemory = {
    me: () => call((e) => e.me()),
    space: () => call((e) => e.space()),
    pin: (item, on) => call((e) => e.pin(item, on)),
    keep: (item) => call((e) => e.keep(item)),
    putBack: (item) => call((e) => e.putBack(item)),
    remove: (item) => call((e) => e.remove(item)),
    addRule: (rule) => call((e) => e.addRule(rule)),
    setRule: (item, status, line) => call((e) => e.setRule(item, status, line)),
    mergeProjects: (from, into) => call((e) => e.mergeProjects(from, into)),
    exportAll: () => call(async (e) => buildExport(e.exported())),
  };
  let origin = '';
  let over = false;
  const api = pageApi<object>({
    origin: () => origin,
    who: async () => ({ person: 'local', login: 'local' }),
    memory: () => memory,
    erase: async () => {
      await call((e) => e.wipe());
      await scrub(db);
    },
  });
  const found = (name: string): Agent | null => AGENTS.find((agent) => agent === name && detect(p).includes(agent)) ?? null;

  api.get('/live', async (c) => {
    const seen = Number(c.req.query('v'));
    const until = Date.now() + HELD;
    let v = db.changes();
    while (v === seen && Date.now() < until && !over && !c.req.raw.signal.aborted) {
      await pause(LOOK);
      if (!over) v = db.changes();
    }
    return c.json({ v });
  });

  api.get('/agents', (c) => c.json({ agents: detect(p).map((agent) => ({ id: agent, connected: !plan(agent, p).length })) }));

  api.get('/agents/:id/plan', (c) => {
    const agent = found(c.req.param('id'));
    if (!agent) return err(404, 'No such agent.');
    const { connected, command, lines, write } = steps(kit, agent, p);
    return c.json({ connected, command, lines, ready: !!write });
  });

  api.post('/agents/:id', async (c) => {
    const agent = found(c.req.param('id'));
    const b = await body(c.req.raw);
    if (!agent) return err(404, 'No such agent.');
    if (!b || typeof b.on !== 'boolean' || !Array.isArray(b.lines)) return err(400, 'Send on as true or false, and the lines you saw.');
    const now = steps(kit, agent, p);
    if (now.command) return err(400, 'Type the command in a terminal.');
    if (!now.write || b.on === now.connected || JSON.stringify(b.lines) !== JSON.stringify(now.lines)) return err(409, STALE);
    try {
      now.write();
    } catch {
      return err(409, STALE);
    }
    return c.json({ connected: !now.connected });
  });

  const reply = (res: ServerResponse, status: number, type: string, data: string | Buffer, more: Record<string, string> = {}): void => {
    res.writeHead(status, { ...more, ...guard, 'content-type': type });
    res.end(data);
  };

  const fromFiles = (req: IncomingMessage, res: ServerResponse, path: string): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, PLAIN, 'Only GET is accepted here.\n');
    let name: string;
    try {
      name = decodeURIComponent(path);
    } catch {
      return reply(res, 404, PLAIN, 'Not found.\n');
    }
    const parts = name === '/' ? ['index.html'] : name.slice(1).split('/');
    const at = parts.every((part) => PART.test(part)) ? join(dir, ...parts) : '';
    if (!at || !fs.statSync(at, { throwIfNoEntry: false })?.isFile()) return reply(res, 404, PLAIN, 'Not found.\n');
    reply(res, 200, TYPES[extname(at)] ?? 'application/octet-stream', req.method === 'HEAD' ? '' : fs.readFileSync(at));
  };

  const fromMemory = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    const bare = req.method === 'GET' || req.method === 'HEAD';
    const data = bare ? Buffer.alloc(0) : await sent(req);
    if (!data) return reply(res, 413, PLAIN, 'The request is too large.\n');
    const gone = new AbortController();
    res.once('close', () => gone.abort());
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
    const answer = await api.fetch(new Request(`${origin}${path}`, { method: req.method, headers, body: bare ? undefined : data, signal: gone.signal }));
    const more: Record<string, string> = {};
    for (const name of ['content-disposition', 'content-type']) if (answer.headers.has(name)) more[name] = answer.headers.get(name) ?? '';
    reply(res, answer.status, more['content-type'] ?? PLAIN, Buffer.from(await answer.arrayBuffer()), more);
  };

  return new Promise<number>((done) => {
    let active = 0;
    let quiet = 0;
    let loaded = false;
    const server = createServer((req, res) => {
      const address = req.url ?? '';
      const cut = address.indexOf('/', 1);
      const given = address.slice(1, cut < 0 ? address.length : cut);
      const from = req.headers.origin;
      if (req.headers.host !== origin.slice(7) || (from !== undefined && from !== origin) || !address.startsWith('/') || !same(given, token)) {
        return reply(res, 403, PLAIN, `${refused()}\n`);
      }
      loaded = true;
      quiet = 0;
      active++;
      res.once('close', () => active--);
      const rest = address.slice(1 + token.length);
      const mark = rest.indexOf('?');
      const path = mark < 0 ? rest : rest.slice(0, mark);
      if (path === '') return reply(res, 308, PLAIN, '', { location: `/${token}/` });
      if (path !== '/api' && !path.startsWith('/api/')) return fromFiles(req, res, path);
      fromMemory(req, res, rest.slice(4) || '/').catch(() => {
        if (!res.headersSent) reply(res, 500, PLAIN, 'The call failed.\n');
        else res.end();
      });
    });
    const end = (): void => {
      if (over) return;
      over = true;
      clearInterval(clock);
      server.close();
      server.closeAllConnections();
      db.close();
      done(0);
    };
    const clock = setInterval(() => {
      quiet = active ? 0 : quiet + 1;
      if (quiet >= (loaded ? QUIET : FIRST)) end();
    }, 1000);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, end);
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const address = `${origin}/${token}/`;
      say(`The memory page is open at ${address} and stays open until 30 seconds after you close the page.`);
      if (process.env.AGENT_CTX_NO_OPEN !== undefined) return;
      const [command, ...args] = opener(process.platform, address);
      spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
    });
  });
}
