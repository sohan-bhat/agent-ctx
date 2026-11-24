import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './paths.ts';
import { cutFile, readJson } from './fsx.ts';
import { alive } from './lock.ts';
import { pruneItems } from './items.ts';
import { loadCards, writeCardsAndIndex, type IndexFile } from './store.ts';
import { budgetBytes, shares } from './limits.ts';

export const SEEN_DAYS = 7;
export const ITEM_DAYS = 30;
const DAY = 86_400_000;
const LEFTOVER_MS = 10 * 60_000;
const QUICK_LOCK_MS = 60_000;

export function storeSize(home: string): number {
  let total = 0;
  const walk = (dir: string) => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch {}
      }
    }
  };
  walk(home);
  return total;
}

function entries(dir: string): { path: string; name: string; size: number; mtime: number; dir: boolean }[] {
  const out: { path: string; name: string; size: number; mtime: number; dir: boolean }[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = path.join(dir, name);
    try {
      const s = fs.statSync(p);
      out.push({ path: p, name, size: s.size, mtime: s.mtimeMs, dir: s.isDirectory() });
    } catch {}
  }
  return out;
}

function remove(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

export function sweepLeftovers(st: Store, now = Date.now()): number {
  let n = 0;
  const pendingBase = path.basename(st.pending);
  const index = readJson<IndexFile>(st.index);
  for (const dir of [st.home, st.sessions, st.seen]) {
    for (const e of entries(dir)) {
      if (!e.dir && e.name.endsWith('.tmp') && now - e.mtime > LEFTOVER_MS) {
        remove(e.path);
        n++;
      } else if (dir === st.home && !e.dir && e.name.startsWith(pendingBase + '.') && e.name.endsWith('.claim')) {
        const pid = Number(e.name.slice(pendingBase.length + 1, -'.claim'.length));
        if (pid === process.pid || (alive(pid) && now - e.mtime < LEFTOVER_MS)) continue;
        try {
          const text = fs.readFileSync(e.path, 'utf8');
          if (text.trim()) fs.appendFileSync(st.pending, text.endsWith('\n') ? text : text + '\n');
        } catch {}
        remove(e.path);
        n++;
      } else if (dir === st.home && e.dir && e.name.endsWith('.lock') && now - e.mtime > QUICK_LOCK_MS) {
        remove(e.path);
        n++;
      } else if (dir === st.home && !e.dir && /^terms-.*\.jsonl$/.test(e.name) && index && e.name !== index.terms && now - e.mtime > LEFTOVER_MS) {
        remove(e.path);
        n++;
      }
    }
  }
  return n;
}

function sweepSeen(st: Store, now: number): void {
  for (const e of entries(st.seen)) if (now - e.mtime > SEEN_DAYS * DAY) remove(e.path);
}

function sessionAges(st: Store): Map<string, number> {
  const ages = new Map<string, number>();
  const ix = readJson<IndexFile>(st.index);
  for (const d of ix?.docs ?? []) ages.set(d.s, Math.max(ages.get(d.s) ?? 0, d.t));
  return ages;
}

function pruneSessions(st: Store, max: number, ages: Map<string, number>): number {
  const files = entries(st.sessions).filter((e) => !e.dir && e.name.endsWith('.json'));
  let total = files.reduce((a, e) => a + e.size, 0);
  if (total <= max) return 0;
  const key = (e: { name: string; mtime: number }) => ages.get(e.name.slice(0, -5)) ?? 0;
  files.sort((a, b) => key(a) - key(b) || a.mtime - b.mtime);
  let n = 0;
  for (const e of files) {
    if (total <= max) break;
    remove(e.path);
    total -= e.size;
    n++;
  }
  return n;
}

export interface Kept {
  before: number;
  after: number;
  budget: number;
  leftovers: number;
  items: number;
  sessions: number;
  cards: number;
}

export function enforce(st: Store, opts: { budget?: number; now?: number } = {}): Kept {
  const budget = opts.budget ?? budgetBytes();
  const now = opts.now ?? Date.now();
  const share = shares(budget);
  const before = storeSize(st.home);
  const leftovers = sweepLeftovers(st, now);
  for (const f of [st.log, st.trace]) {
    try {
      cutFile(f, share.log);
    } catch {}
  }
  sweepSeen(st, now);
  const ages = sessionAges(st);
  const items = pruneItems(st, (it) => {
    if (it.session === '*') return true;
    const seen = Math.max(ages.get(it.session) ?? 0, Date.parse(it.at) || 0);
    return now - seen <= ITEM_DAYS * DAY;
  });
  let sessions = pruneSessions(st, share.sessions, ages);
  let cards = 0;
  let cardBytes = 0;
  try {
    cardBytes = fs.statSync(st.cards).size;
  } catch {}
  if (cardBytes > share.cards) {
    const all = loadCards(st);
    cards = all.length - writeCardsAndIndex(st, all, share.cards).docs.length;
  }
  let after = storeSize(st.home);
  if (after > budget) {
    sessions += pruneSessions(st, Math.max(0, share.sessions - (after - budget)), sessionAges(st));
    after = storeSize(st.home);
  }
  if (after > budget) {
    const all = loadCards(st);
    const room = Math.max(0, Math.floor(share.cards - (after - budget) * 0.8));
    cards += all.length - writeCardsAndIndex(st, all, room).docs.length;
    after = storeSize(st.home);
  }
  return { before, after, budget, leftovers, items, sessions, cards };
}
