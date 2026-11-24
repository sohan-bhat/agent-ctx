import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
import { scratch, makeRepo, removeScratch, Transcript } from './synth.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOOK = process.env.CLAUDE_CTX_HOOK_JS ?? path.join(ROOT, 'src', 'hook.ts');
export const CLI = process.env.CLAUDE_CTX_CLI_JS ?? path.join(ROOT, 'src', 'cli.ts');
export const GUARD = path.join(ROOT, 'test', 'netguard.mjs');

export interface World {
  root: string;
  claude: string;
  ctxHome: string;
  code: string;
  env: NodeJS.ProcessEnv;
  repos: Record<string, string>;
}

const worlds: World[] = [];

after(async () => {
  await waitFor(() => worlds.every(workerIdle), 15000);
  removeScratch();
});

export function world(name: string, extraEnv: NodeJS.ProcessEnv = {}): World {
  const root = scratch(name);
  const claude = path.join(root, 'claude');
  const ctxHome = path.join(root, 'ctx-home');
  const code = path.join(root, 'code');
  fs.mkdirSync(claude, { recursive: true });
  fs.mkdirSync(code, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: path.join(root, 'home'),
    CLAUDE_CONFIG_DIR: claude,
    CLAUDE_CTX_HOME: ctxHome,
    CLAUDE_CTX_SCRATCH: process.env.CLAUDE_CTX_SCRATCH,
    CLAUDE_CTX_NO_OPEN: '1',
    ...extraEnv,
  };
  fs.mkdirSync(env.HOME as string, { recursive: true });
  const w: World = { root, claude, ctxHome, code, env, repos: {} };
  worlds.push(w);
  return w;
}

export function repo(w: World, name: string, remote?: string): string {
  const dir = makeRepo(path.join(w.code, name), remote);
  w.repos[name] = dir;
  return dir;
}

export function runHook(w: World, event: string, input: unknown, env: NodeJS.ProcessEnv = {}) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [HOOK, event], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...w.env, ...env },
    encoding: 'utf8',
    timeout: 20000,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { stdout: r.stdout, stderr: r.stderr, status: r.status, ms };
}

export function runCli(w: World, args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    input: opts.input ?? '',
    env: { ...w.env, ...(opts.env ?? {}) },
    cwd: opts.cwd ?? w.root,
    encoding: 'utf8',
    timeout: 120000,
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

export async function waitFor(fn: () => boolean, ms = 15000, step = 25): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return fn();
}

export function workerIdle(w: World): boolean {
  return !fs.existsSync(path.join(w.ctxHome, 'lock')) && !(fs.existsSync(path.join(w.ctxHome, 'pending.jsonl')) && fs.statSync(path.join(w.ctxHome, 'pending.jsonl')).size > 0);
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export { Transcript };
