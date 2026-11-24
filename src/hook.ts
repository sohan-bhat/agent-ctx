import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ctxHome, store, type Store } from './core/paths.ts';
import { atomicWrite, logError, readJson } from './core/fsx.ts';
import { loadIndex, readCards } from './core/store.ts';
import { describeHere, newestElsewhere, rankPrompt, rankStart } from './core/rank.ts';
import { renderCards } from './core/format.ts';
import { drainQueue, pinsFor, renderPins, renderPutBack } from './core/items.ts';
import { addPending } from './core/update.ts';

export const START_CAP = 6000;
export const PROMPT_CAP = 1500;
export const QUEUE_CAP = 3000;
export const PIN_CAP = 4000;
export const MAX_START_CARDS = 5;
export const MAX_PROMPT_CARDS = 3;

interface Input {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: string;
  prompt?: string;
  reason?: string;
  trigger?: string;
  compact_summary?: string;
}

function seenFile(st: Store, session: string): string {
  return path.join(st.seen, session.replace(/[^A-Za-z0-9_-]/g, '_') + '.json');
}

function loadSeen(st: Store, session: string): string[] {
  return readJson<string[]>(seenFile(st, session)) ?? [];
}

function addSeen(st: Store, session: string, ids: string[]): void {
  if (!ids.length) return;
  const all = [...new Set([...loadSeen(st, session), ...ids])];
  atomicWrite(seenFile(st, session), JSON.stringify(all));
}

function sessionStart(st: Store, inp: Input): string {
  const session = inp.session_id ?? '';
  const out: string[] = [];
  let room = START_CAP;
  if ((inp.source === 'compact' || inp.source === 'resume') && session) {
    const q = renderPutBack(drainQueue(st, session), Math.min(QUEUE_CAP, room));
    if (q) {
      out.push(q);
      room -= q.length + 2;
    }
  }
  if (inp.source === 'resume' || inp.source === 'fork') return out.join('\n\n');
  const ix = loadIndex(st);
  if (ix && ix.docs.length && inp.cwd && room > 600) {
    const here = describeHere(inp.cwd);
    const exclude = new Set(ix.docs.filter((d) => d.s === session).map((d) => d.id));
    const hits = rankStart(ix, here, Date.now(), exclude).slice(0, MAX_START_CARDS);
    let header = 'Recall from claude-ctx, past sessions from other folders that fit this one, as background to check before use.';
    let docs = hits.map((h) => h.doc);
    if (!docs.length) {
      docs = newestElsewhere(ix, here, 3, exclude);
      header = 'Recall from claude-ctx, the latest work in other folders since nothing there fits this one, as background only.';
    }
    const cards = readCards(st, ix, docs);
    const text = renderCards(cards, room, header);
    if (text) {
      out.push(text);
      if (session) addSeen(st, session, cards.map((c) => c.id));
    }
  }
  return out.join('\n\n');
}

function userPrompt(st: Store, inp: Input): string {
  const session = inp.session_id ?? '';
  const out: string[] = [];
  if (session) {
    const q = renderPutBack(drainQueue(st, session), QUEUE_CAP);
    if (q) out.push(q);
  }
  const prompt = (inp.prompt ?? '').trim();
  if (prompt && !prompt.startsWith('/')) {
    const ix = loadIndex(st);
    if (ix && ix.docs.length) {
      const seen = new Set(session ? loadSeen(st, session) : []);
      if (session) seen.add(session);
      const here = inp.cwd ? describeHere(inp.cwd, false) : null;
      const hits = rankPrompt(ix, prompt, Date.now(), seen, here?.remote ?? null).slice(0, MAX_PROMPT_CARDS);
      if (hits.length) {
        const cards = readCards(st, ix, hits.map((h) => h.doc));
        const text = renderCards(cards, PROMPT_CAP, 'Recall from claude-ctx for this prompt, as background only.');
        if (text) {
          out.push(text);
          if (session) addSeen(st, session, cards.map((c) => c.id));
        }
      }
    }
  }
  return out.join('\n\n');
}

function workerPath(): string {
  const here = fileURLToPath(import.meta.url);
  return path.join(path.dirname(here), 'worker' + path.extname(here));
}

export function spawnWorker(): number | undefined {
  const child = spawn(process.execPath, [workerPath()], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  return child.pid;
}

function queueUpdate(st: Store, inp: Input, summary?: string): string {
  if (!inp.session_id || !inp.transcript_path) return '';
  addPending(st, { session: inp.session_id, transcript: inp.transcript_path, summary });
  spawnWorker();
  return '';
}

function preCompact(st: Store, inp: Input): string {
  if (!inp.session_id) return '';
  return renderPins(pinsFor(st, inp.session_id), PIN_CAP);
}

export function handle(event: string, inp: Input, st: Store): string {
  switch (event) {
    case 'session-start':
      return sessionStart(st, inp);
    case 'prompt':
      return userPrompt(st, inp);
    case 'session-end':
      return queueUpdate(st, inp);
    case 'post-compact':
      return queueUpdate(st, inp, typeof inp.compact_summary === 'string' ? inp.compact_summary : undefined);
    case 'pre-compact':
      return preCompact(st, inp);
    default:
      return '';
  }
}

function main(): void {
  const t0 = performance.now();
  const guard = setTimeout(() => process.exit(0), 5000);
  guard.unref();
  const event = process.argv[2] ?? '';
  let st: Store | null = null;
  try {
    st = store(ctxHome());
    let inp: Input = {};
    if (!process.stdin.isTTY) {
      const raw = fs.readFileSync(0, 'utf8');
      if (raw.trim()) inp = JSON.parse(raw) as Input;
    }
    const out = handle(event, inp, st);
    if (out) process.stdout.write(out + '\n');
    try {
      atomicWrite(st.last, JSON.stringify({ event, at: Date.now(), chars: out ? out.length + 1 : 0, ms: Math.round(performance.now() - t0) }));
    } catch {}
  } catch (e) {
    if (st) logError(st.log, `hook ${event}`, e);
  }
  process.exitCode = 0;
  if (process.env.CLAUDE_CTX_PROFILE) process.stderr.write(`claude-ctx-profile ${t0.toFixed(2)} ${performance.now().toFixed(2)}\n`);
}

main();
