import { read as readFd } from 'node:fs';
import type { EventArgs, Part } from '../../service/src/engine.ts';
import { blank, fits, hears, read, repeats, write, type Host } from './hook.ts';

const WAIT = 1000;
const GIVE_UP = 3000;
const ASKED = 30 * 60000;
const ASKED_CHARS = 800;
const SAID = 7 * 86400000;
const ID_MAX = 200;
const CHUNK = 65536;
const FRAME = 'claude-code';
const MAIN = 'agent-ctx.mjs';
const KICK = 60000;
const MIRROR = 'mirror';
const KICKED = 'mirror:kick';

interface Asked { at: number; prompt: string }

const ARGS = process.argv.slice(2);

function option(name: string): string | undefined {
  const joined = ARGS.find((a) => a.startsWith(`${name}=`));
  if (joined) return joined.slice(name.length + 1);
  const at = ARGS.indexOf(name);
  return at >= 0 ? ARGS[at + 1] : undefined;
}

function stream(): Promise<string> {
  return new Promise((done) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (part: string) => (text += part));
    process.stdin.on('end', () => done(text));
    process.stdin.on('error', () => done(''));
  });
}

function input(): Promise<string> {
  return new Promise((done) => {
    const parts: Buffer[] = [];
    const next = (): void =>
      readFd(0, Buffer.allocUnsafe(CHUNK), 0, CHUNK, null, (error, n, part) => {
        if (error?.code === 'EAGAIN' && !parts.length) return void stream().then(done);
        if (error || n === 0) return done(Buffer.concat(parts).toString('utf8'));
        parts.push(part.subarray(0, n));
        next();
      });
    next();
  });
}

function plain(text: string): string {
  if (!text) return '';
  try {
    const inner = (JSON.parse(text) as { hookSpecificOutput?: { additionalContext?: unknown } }).hookSpecificOutput?.additionalContext;
    return typeof inner === 'string' ? inner : '';
  } catch {
    return '';
  }
}

async function sync(): Promise<void> {
  const [{ spawn }, { fileURLToPath }] = await Promise.all([import('node:child_process'), import('node:url')]);
  const whole = (globalThis as { Bun?: { isStandaloneExecutable?: boolean } }).Bun?.isStandaloneExecutable;
  spawn(process.execPath, [...(whole ? [] : [fileURLToPath(new URL(MAIN, import.meta.url))]), 'sync'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function run(): Promise<string> {
  const started = Date.now();
  const host = option('--agent') as Host | undefined;
  if (!host || !fits(host, process.env)) return '';
  const a = read(host, await input(), option('--event'));
  if (!a?.event) return '';
  const event = a.event;
  const [{ clean, stripOwn, stripPrivate }, { fitEvent }, { caller, local, open, who }] = await Promise.all([import('../../core/src/index.ts'), import('../../service/src/limits.ts'), import('./db.ts')]);
  const db = open(WAIT);
  let due = false;
  try {
    db.patience(started + WAIT - Date.now());
    return await caller(db)(async (engine) => {
      const c = who(host);
      const send = async (args: EventArgs, part?: Part): Promise<string> => {
        const fit = fitEvent({ ...args, host: FRAME });
        return fit ? local(plain((await engine.event(c, fit, part)).text)) : '';
      };
      const known = !!a.session && a.session.length <= ID_MAX;
      const late = !hears(host, 'UserPromptSubmit') && known;
      const key = `asked:${a.session}`;
      const now = Date.now();
      const words = (): string => clean(stripOwn(stripPrivate(a.prompt ?? '')), ASKED_CHARS);
      const note = (prefix: string, age: number): void => {
        for (const row of engine.store.q<{ k: string; v: string }>('SELECT k, v FROM meta WHERE k >= ? AND k < ?', `${prefix}:`, `${prefix};`)) {
          if (now - (JSON.parse(row.v) as Asked).at > age) engine.store.dropMeta(row.k);
        }
        if (a.prompt) engine.store.setMeta(`${prefix}:${a.session}`, { at: now, prompt: words() } satisfies Asked);
      };
      if (event === 'UserPromptSubmit' && repeats(host) && known && a.prompt) {
        if (engine.store.meta<Asked | null>(`said:${a.session}`, null)?.prompt === words()) return '';
        note('said', SAID);
      }
      if (event === 'UserPromptSubmit' && late) {
        await send(a, 'store');
        note('asked', ASKED);
        return '';
      }
      let text = '';
      if (late && hears(host, event)) {
        const asked = engine.store.meta<Asked | null>(key, null);
        if (asked) {
          engine.store.dropMeta(key);
          if (now - asked.at <= ASKED) text = await send({ event: 'UserPromptSubmit', session: a.session, cwd: a.cwd, model: a.model, prompt: asked.prompt }, 'recall');
        }
      }
      const own = await send(a);
      if ((event === 'SessionStart' || event === 'Stop') && engine.store.meta<{ on?: boolean } | null>(MIRROR, null)?.on && now - engine.store.meta<number>(KICKED, 0) >= KICK) {
        engine.store.setMeta(KICKED, now);
        due = true;
      }
      return write(host, event, text || own);
    });
  } finally {
    db.close();
    if (due) await sync().catch(() => undefined);
  }
}

let printed = false;

function end(out = ''): void {
  const text = printed ? '' : out || blank(option('--agent'));
  printed = true;
  if (text) process.stdout.write(text, () => process.exit(0));
  else process.exit(0);
}

process.emitWarning = () => undefined;
process.on('uncaughtException', () => end());
process.on('unhandledRejection', () => end());
setTimeout(end, GIVE_UP).unref();
run().then(end, () => end());
