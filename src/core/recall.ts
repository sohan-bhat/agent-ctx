import os from 'node:os';
import path from 'node:path';
import type { Store } from './paths.ts';
import { loadIndex, readCards, type Index, type IndexDoc } from './store.ts';
import { findDocs, newestDocs } from './rank.ts';
import { placeOfDir } from './place.ts';
import { cardSummary, cleanPrompt, day, renderCard, shortFile, tilde } from './format.ts';
import { cleanSummary, cut } from './records.ts';
import type { Card } from './session.ts';

export const RESULT_CAP = 6000;
export const DEFAULT_COUNT = 5;
export const MAX_COUNT = 10;
export const BRIEF_FILES = 5;
export const CLOSING = 'These are notes from past sessions, as background to check against the files before use.';
export const EMPTY = 'No cards yet, so run claude-ctx index to read past sessions.';

export interface Brief {
  id: string;
  title: string;
  project: string;
  folder: string;
  branch?: string;
  last: string;
  summary: string;
  asked: string[];
  files: string[];
}

export interface Full {
  id: string;
  title: string;
  project: string;
  folder: string;
  branch?: string;
  first: string;
  last: string;
  prompts: number;
  summaries: string[];
  asked: string[];
  files: string[];
  others: string[];
  dropped: number;
}

export interface ListResult {
  text: string;
  data: { sessions: Brief[]; note: string };
}

export interface FullResult {
  text: string;
  data: { session: Full; note: string } | null;
}

function homeOf(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function folderFilter(folder?: string): ((d: IndexDoc) => boolean) | undefined {
  const f = (folder ?? '').trim().replace(/\/+$/, '');
  if (!f) return undefined;
  const name = f.toLowerCase();
  if (!f.includes('/') && !f.startsWith('~') && f !== '.') return (d) => d.n.toLowerCase() === name || path.basename(d.p).toLowerCase() === name;
  const abs = path.resolve(homeOf(f));
  const top = placeOfDir(abs).path;
  return (d) => d.p === abs || d.p.startsWith(abs + '/') || d.p === top || d.r === name;
}

function asked(c: Card, n: number, all: boolean): string[] {
  const list = all ? [c.firstPrompt, ...c.prompts] : [c.firstPrompt, c.prompts[c.prompts.length - 1]];
  const out: string[] = [];
  for (const p of list) {
    if (!p) continue;
    const q = cleanPrompt(p, n);
    if (q && !out.includes(q)) out.push(q);
  }
  return out;
}

function titleOf(c: Card): string {
  return c.title ? cut(c.title, 90) : c.project;
}

export function briefOf(c: Card): Brief {
  return {
    id: c.id,
    title: titleOf(c),
    project: c.project,
    folder: c.place,
    ...(c.branch ? { branch: c.branch } : {}),
    last: day(c.last),
    summary: cardSummary(c),
    asked: asked(c, 100, false),
    files: c.files.slice(0, BRIEF_FILES).map((f) => shortFile(f, c.place)),
  };
}

function withIndex<T>(st: Store, empty: T, fn: (ix: Index) => T): T {
  const ix = loadIndex(st);
  if (!ix) return empty;
  try {
    return ix.docs.length ? fn(ix) : empty;
  } finally {
    ix.close();
  }
}

function listOf(cards: Card[], count: number, none: string): ListResult {
  if (!cards.length) return { text: none, data: { sessions: [], note: none } };
  const per = Math.max(300, Math.floor((RESULT_CAP - CLOSING.length) / Math.max(1, Math.min(count, cards.length))) - 60);
  const parts: string[] = [];
  const sessions: Brief[] = [];
  let used = CLOSING.length;
  let json = JSON.stringify({ sessions: [], note: CLOSING }).length;
  for (const c of cards) {
    const part = `${renderCard(c, per)}\nId ${c.id}`;
    const b = briefOf(c);
    const size = JSON.stringify(b).length + 1;
    if (used + part.length + 2 > RESULT_CAP || json + size > RESULT_CAP) break;
    parts.push(part);
    sessions.push(b);
    used += part.length + 2;
    json += size;
  }
  parts.push(CLOSING);
  return { text: parts.join('\n\n'), data: { sessions, note: CLOSING } };
}

export function searchResult(st: Store, words: string, folder: string | undefined, count: number): ListResult {
  const q = words.trim();
  if (!q) return recentResult(st, folder, count);
  const keep = folderFilter(folder);
  const where = folder?.trim() ? ` in ${cut(folder.trim(), 200)}` : '';
  const none = `Nothing matches "${cut(q, 100)}"${where}, so try fewer or other words.`;
  return withIndex(st, listOf([], count, EMPTY), (ix) => listOf(readCards(st, ix, findDocs(ix, q, count, count, keep)), count, none));
}

export function recentResult(st: Store, folder: string | undefined, count: number): ListResult {
  const keep = folderFilter(folder);
  const none = folder?.trim() ? `No past sessions in ${cut(folder.trim(), 200)}.` : EMPTY;
  return withIndex(st, listOf([], count, EMPTY), (ix) => listOf(readCards(st, ix, newestDocs(ix, count, keep)), count, none));
}

function fullOf(c: Card, others: string[]): Full {
  return {
    id: c.id,
    title: titleOf(c),
    project: c.project,
    folder: c.place,
    ...(c.branch ? { branch: c.branch } : {}),
    first: day(c.first),
    last: day(c.last),
    prompts: c.turns,
    summaries: c.summaries.map((s) => cleanSummary(s)).filter(Boolean),
    asked: asked(c, 300, true),
    files: c.files.map((f) => shortFile(f, c.place)),
    others,
    dropped: 0,
  };
}

function fullText(f: Full): string {
  const lines = [`## ${f.title} | ${f.project} | ${f.last}`, `Folder ${tilde(f.folder)}${f.branch ? ` on ${f.branch}` : ''}`, `Id ${f.id}`];
  lines.push(`${f.prompts} ${f.prompts === 1 ? 'prompt' : 'prompts'} from ${f.first} to ${f.last}`);
  if (f.dropped) lines.push(`${f.dropped} earlier ${f.dropped === 1 ? 'summary' : 'summaries'} left out to stay under ${RESULT_CAP} characters`);
  for (const s of f.summaries) lines.push(`Summary ${s}`);
  for (const a of f.asked) lines.push(`Asked "${a}"`);
  if (f.files.length) lines.push(`Files ${f.files.join(', ')}`);
  if (f.others.length) lines.push(`Other parts ${f.others.join(', ')}`);
  lines.push('', CLOSING);
  return lines.join('\n');
}

function fits(f: Full): boolean {
  return fullText(f).length <= RESULT_CAP && JSON.stringify({ session: f, note: CLOSING }).length <= RESULT_CAP;
}

function shrink(f: Full): Full {
  const g: Full = { ...f, summaries: [...f.summaries], asked: [...f.asked], files: [...f.files] };
  const older = () => {
    g.summaries.shift();
    g.dropped++;
  };
  while (!fits(g)) {
    if (g.files.length > 10) g.files.pop();
    else if (g.summaries.length > 1) older();
    else if (g.asked.length > 2) g.asked.pop();
    else if (g.files.length > BRIEF_FILES) g.files.pop();
    else if (g.summaries.length && g.summaries[0].length > 200) g.summaries[0] = cut(g.summaries[0], Math.floor(g.summaries[0].length * 0.7));
    else if (g.asked.length > 1) g.asked.pop();
    else if (g.files.length) g.files.pop();
    else if (g.summaries.length) older();
    else break;
  }
  return g;
}

export function pickCard(ix: Index, id: string): { doc: number; others: string[] } | null {
  const want = id.trim();
  if (!want) return null;
  const parts = (s: string) => ix.docs.map((d, i) => ({ d, i })).filter((x) => x.d.s === s);
  let doc = ix.docs.findIndex((d) => d.id === want);
  if (doc < 0) {
    const same = parts(want);
    if (same.length) doc = same.sort((a, b) => a.d.id.localeCompare(b.d.id))[0].i;
  }
  if (doc < 0 && want.length >= 6) {
    const hits = ix.docs.map((d, i) => ({ d, i })).filter((x) => x.d.id.startsWith(want));
    const sessions = new Set(hits.map((x) => x.d.s));
    if (sessions.size === 1) doc = hits.sort((a, b) => a.d.id.localeCompare(b.d.id))[0].i;
  }
  if (doc < 0) return null;
  const d = ix.docs[doc];
  return { doc, others: parts(d.s).map((x) => x.d.id).filter((x) => x !== d.id).sort() };
}

export function sessionResult(st: Store, id: string): FullResult {
  const missing = { text: `No past session has the id ${cut(id.trim(), 100)}, and search or recent show the ids.`, data: null };
  return withIndex<FullResult>(st, { text: EMPTY, data: null }, (ix) => {
    const hit = pickCard(ix, id);
    if (!hit) return missing;
    const [c] = readCards(st, ix, [hit.doc]);
    if (!c) return missing;
    const f = shrink(fullOf(c, hit.others));
    let text = fullText(f);
    if (text.length > RESULT_CAP) text = text.slice(0, RESULT_CAP);
    return { text, data: { session: f, note: CLOSING } };
  });
}
