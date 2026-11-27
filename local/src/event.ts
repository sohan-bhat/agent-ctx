import { read as readFd } from 'node:fs';
import type { EventArgs, Part } from '../../service/src/engine.ts';
import { fits, hears, read, write, type Host } from './hook.ts';

const WAIT = 1000;
const GIVE_UP = 3000;
const ASKED = 30 * 60000;
const ASKED_CHARS = 800;
const ID_MAX = 200;
const CHUNK = 65536;
const FRAME = 'claude-code';
const MAIN = 'agent-ctx.mjs';
const KICK = 60000;
const MIRROR = 'mirror';
const KICKED = 'mirror:kick';

interface Asked { at: number; prompt: string }

function agent(args: string[]): string | undefined {
  const joined = args.find((a) => a.startsWith('--agent='));
  if (joined) return joined.slice(8);
  const at = args.indexOf('--agent');
  return at >= 0 ? args[at + 1] : undefined;
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
  spawn(process.execPath, [fileURLToPath(new URL(MAIN, import.meta.url)), 'sync'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function run(): Promise<string> {
  const started = Date.now();
  const host = agent(process.argv.slice(2)) as Host | undefined;
  if (!host || !fits(host, process.env)) return '';
  const a = read(host, await input());
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
      const late = !hears(host, 'UserPromptSubmit') && !!a.session && a.session.length <= ID_MAX;
      const key = `asked:${a.session}`;
      const now = Date.now();
      if (event === 'UserPromptSubmit' && late) {
        await send(a, 'store');
        for (const row of engine.store.q<{ k: string; v: string }>("SELECT k, v FROM meta WHERE k >= 'asked:' AND k < 'asked;'")) {
          if (now - (JSON.parse(row.v) as Asked).at > ASKED) engine.store.dropMeta(row.k);
        }
        if (a.prompt) engine.store.setMeta(key, { at: now, prompt: clean(stripOwn(stripPrivate(a.prompt)), ASKED_CHARS) } satisfies Asked);
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

process.emitWarning = () => undefined;
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));
setTimeout(() => process.exit(0), GIVE_UP).unref();
run().then(
  (out) => {
    if (out) process.stdout.write(out, () => process.exit(0));
    else process.exit(0);
  },
  () => process.exit(0),
);
