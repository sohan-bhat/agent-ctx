import fs from 'node:fs';
import path from 'node:path';
import { projectsDir, type Store } from './paths.ts';
import { readJsonl } from './fsx.ts';
import { addSummary, deriveCards, newState, scan, type Card } from './session.ts';
import { loadCards, loadSession, saveSession, upsertCards, writeCardsAndIndex, type Index } from './store.ts';

export interface Job {
  session: string;
  transcript: string;
  summary?: string;
  at?: number;
}

export function listTranscripts(claude: string): { session: string; transcript: string; size: number; mtime: number }[] {
  const root = projectsDir(claude);
  const out: { session: string; transcript: string; size: number; mtime: number }[] = [];
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return out;
  }
  for (const d of dirs) {
    const dp = path.join(root, d);
    let ents: string[];
    try {
      ents = fs.readdirSync(dp);
    } catch {
      continue;
    }
    for (const f of ents) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(dp, f);
      try {
        const stt = fs.statSync(p);
        if (!stt.isFile()) continue;
        out.push({ session: f.slice(0, -6), transcript: p, size: stt.size, mtime: stt.mtimeMs });
      } catch {}
    }
  }
  return out;
}

export interface UpdateResult {
  sessions: number;
  cards: number;
  lines: number;
  bad: number;
  index: Index | null;
}

export async function applyJobs(st: Store, claude: string, jobs: Job[], onProgress?: (done: number, total: number) => void): Promise<UpdateResult> {
  const merged = new Map<string, Job & { summaries: string[] }>();
  for (const j of jobs) {
    if (!j || typeof j.session !== 'string' || typeof j.transcript !== 'string') continue;
    const m = merged.get(j.session) ?? { ...j, summaries: [] };
    if (j.summary) m.summaries.push(j.summary);
    m.transcript = j.transcript || m.transcript;
    merged.set(j.session, m);
  }
  let cards: Card[] = loadCards(st);
  let lines = 0;
  let bad = 0;
  let done = 0;
  for (const j of merged.values()) {
    let s = loadSession(st, j.session);
    if (!s || s.transcript !== j.transcript) s = s ? { ...s, transcript: j.transcript } : newState(j.session, j.transcript);
    const r = await scan(s, claude);
    lines += r.lines;
    bad += r.bad;
    for (const sum of j.summaries) addSummary(s, sum);
    saveSession(st, s);
    cards = upsertCards(cards, s.id, deriveCards(s));
    done++;
    onProgress?.(done, merged.size);
  }
  const index = merged.size ? writeCardsAndIndex(st, cards) : null;
  return { sessions: merged.size, cards: index ? index.docs.length : cards.length, lines, bad, index };
}

export function claimPending(st: Store): Job[] {
  const claimed = `${st.pending}.${process.pid}.claim`;
  try {
    fs.renameSync(st.pending, claimed);
  } catch {
    return [];
  }
  const jobs = readJsonl<Job>(claimed);
  try {
    fs.unlinkSync(claimed);
  } catch {}
  return jobs;
}

export function addPending(st: Store, job: Job): void {
  fs.mkdirSync(path.dirname(st.pending), { recursive: true });
  fs.appendFileSync(st.pending, JSON.stringify({ ...job, at: Date.now() }) + '\n');
}

export function hasPending(st: Store): boolean {
  try {
    return fs.statSync(st.pending).size > 0;
  } catch {
    return false;
  }
}
