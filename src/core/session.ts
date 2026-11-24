import fs from 'node:fs';
import path from 'node:path';
import { readLines } from './lines.ts';
import { placeOfDir, placeOfFile, remoteOf, type Place } from './place.ts';
import { isScratchPath } from './paths.ts';
import {
  cleanSummary,
  compactSummaryText,
  cut,
  editPaths,
  isCompactBoundary,
  isToolResultLine,
  mayHaveEdit,
  parseLine,
  promptText,
  titleOf,
} from './records.ts';
import { redact } from './redact.ts';

export const PROMPT_CAP = 300;
export const LATER_CAP = 200;
export const SUMMARY_CAP = 600;
export const FILES_CAP = 30;
export const SPLIT_MIN_EDITS = 3;

export interface Turn {
  t: string;
  cwd: string;
  prompt?: string;
  files: Record<string, number>;
}

export interface SummaryMark {
  text: string;
  at: number;
  key: string;
}

export interface SessionState {
  v: 2;
  id: string;
  transcript: string;
  offset: number;
  first?: string;
  last?: string;
  title?: string;
  customTitle?: string;
  branch?: string;
  cwd?: string;
  turns: Turn[];
  summaries: SummaryMark[];
  compactions: number;
  gits: Record<string, boolean>;
}

export interface PlaceStat {
  path: string;
  git: boolean;
  prompts: number;
  edits: number;
}

export interface Card {
  id: string;
  session: string;
  part: number;
  parts: number;
  place: string;
  git: boolean;
  project: string;
  remote?: string;
  branch?: string;
  places: PlaceStat[];
  first: string;
  last: string;
  title?: string;
  summaries: string[];
  firstPrompt?: string;
  prompts: string[];
  files: string[];
  transcript: string;
  turns: number;
}

export function newState(id: string, transcript: string): SessionState {
  return { v: 2, id, transcript, offset: 0, turns: [], summaries: [], compactions: 0, gits: {} };
}

function summaryKey(text: string): string {
  return text.slice(0, 160).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function addSummary(s: SessionState, raw: string): boolean {
  const text = cut(redact(cleanSummary(raw)), SUMMARY_CAP);
  if (!text) return false;
  const key = summaryKey(text);
  if (s.summaries.some((m) => m.key === key)) return false;
  s.summaries.push({ text, at: s.turns.length, key });
  return true;
}

function currentTurn(s: SessionState, t: string, cwd: string): Turn {
  let turn = s.turns[s.turns.length - 1];
  if (!turn) {
    turn = { t, cwd, files: {} };
    s.turns.push(turn);
  }
  return turn;
}

function remember(s: SessionState, p: Place): string {
  s.gits[p.path] = p.git;
  return p.path;
}

function turnEdits(s: SessionState, t: Turn): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [f, n] of Object.entries(t.files)) {
    const key = remember(s, placeOfFile(f, t.cwd || undefined));
    out[key] = (out[key] || 0) + n;
  }
  return out;
}

const TS = /"timestamp":"(\d{4}-\d\d-\d\dT[0-9:.]+Z?)"/;

function wanted(text: string): boolean {
  if (text.includes('"type":"api-request')) return false;
  if (isToolResultLine(text)) return false;
  if (text.includes('"type":"assistant"')) return mayHaveEdit(text);
  if (text.includes('"type":"attachment"')) return false;
  return (
    text.includes('"type":"user"') ||
    text.includes('"compact_boundary"') ||
    text.includes('"type":"ai-title"') ||
    text.includes('"type":"custom-title"') ||
    text.includes('"type":"summary"')
  );
}

export async function scan(s: SessionState, claude: string): Promise<{ lines: number; bad: number }> {
  let lines = 0;
  let bad = 0;
  let size: number;
  try {
    size = fs.statSync(s.transcript).size;
  } catch {
    return { lines, bad };
  }
  if (size < s.offset) {
    const fresh = newState(s.id, s.transcript);
    Object.assign(s, fresh);
  }
  for await (const line of readLines(s.transcript, s.offset)) {
    s.offset = line.end;
    lines++;
    const text = line.text;
    if (!text) continue;
    if (!wanted(text)) {
      const m = TS.exec(text);
      if (m) {
        if (!s.first || m[1] < s.first) s.first = m[1];
        if (!s.last || m[1] > s.last) s.last = m[1];
      }
      continue;
    }
    const r = parseLine(text);
    if (!r) {
      bad++;
      continue;
    }
    const ts = typeof r.timestamp === 'string' ? r.timestamp : undefined;
    if (ts) {
      if (!s.first || ts < s.first) s.first = ts;
      if (!s.last || ts > s.last) s.last = ts;
    }
    if (typeof r.cwd === 'string' && !s.cwd) s.cwd = r.cwd;
    if (typeof r.gitBranch === 'string' && r.gitBranch && r.gitBranch !== 'HEAD') s.branch = r.gitBranch;
    const ti = titleOf(r);
    if (ti) {
      if (ti.ai) s.title = cut(redact(ti.ai), 120);
      if (ti.custom) s.customTitle = cut(redact(ti.custom), 120);
      continue;
    }
    if (isCompactBoundary(r)) {
      s.compactions++;
      continue;
    }
    const sum = compactSummaryText(r);
    if (sum) {
      addSummary(s, sum);
      continue;
    }
    const cwd = typeof r.cwd === 'string' ? r.cwd : s.cwd || '';
    const p = promptText(r);
    if (p) {
      s.turns.push({ t: ts || s.last || '', cwd, prompt: cut(redact(p), PROMPT_CAP), files: {} });
      if (cwd) remember(s, placeOfDir(cwd));
      continue;
    }
    if (r.type === 'assistant') {
      for (const f of editPaths(r)) {
        if (isScratchPath(f, claude)) continue;
        const turn = currentTurn(s, ts || '', cwd);
        turn.files[f] = (turn.files[f] || 0) + 1;
      }
    }
  }
  return { lines, bad };
}

function placeStats(s: SessionState): PlaceStat[] {
  const m = new Map<string, PlaceStat>();
  const get = (p: string) => {
    let st = m.get(p);
    if (!st) {
      st = { path: p, git: !!s.gits[p], prompts: 0, edits: 0 };
      m.set(p, st);
    }
    return st;
  };
  for (const t of s.turns) {
    if (t.prompt && t.cwd) get(placeOfDirCached(s, t.cwd)).prompts++;
    for (const [p, n] of Object.entries(turnEdits(s, t))) get(p).edits += n;
  }
  return [...m.values()];
}

function placeOfDirCached(s: SessionState, cwd: string): string {
  const p = placeOfDir(cwd);
  s.gits[p.path] = p.git;
  return p.path;
}

function rankPlaces(stats: PlaceStat[]): PlaceStat[] {
  return [...stats].sort((a, b) => b.edits - a.edits || b.prompts - a.prompts);
}

export function assignTurns(s: SessionState, qualified: string[]): string[] {
  const q = new Set(qualified);
  const own: (string | null)[] = s.turns.map((t) => {
    let best: string | null = null;
    let bestN = 0;
    for (const [p, n] of Object.entries(turnEdits(s, t))) {
      if (q.has(p) && n > bestN) {
        best = p;
        bestN = n;
      }
    }
    if (best) return best;
    if (t.cwd) {
      const cp = placeOfDirCached(s, t.cwd);
      if (q.has(cp)) return cp;
    }
    return null;
  });
  const out: string[] = new Array(own.length);
  let prev: string | null = null;
  for (let i = 0; i < own.length; i++) {
    if (own[i]) prev = own[i];
    out[i] = (own[i] ?? prev) as string;
  }
  let next: string | null = null;
  for (let i = own.length - 1; i >= 0; i--) {
    if (own[i]) next = own[i];
    if (!out[i]) out[i] = (next ?? qualified[0]) as string;
  }
  return out;
}

export function summaryPlaces(s: SessionState, owners: string[], main: string): string[][] {
  const res: string[][] = [];
  let from = 0;
  for (const m of s.summaries) {
    const to = Math.min(m.at, owners.length);
    const set = new Set<string>();
    for (let i = from; i < to; i++) set.add(owners[i]);
    if (!set.size) set.add(owners[Math.max(0, to - 1)] ?? main);
    res.push([...set]);
    from = Math.max(from, to);
  }
  return res;
}

function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]);
  return out;
}

export function deriveCards(s: SessionState): Card[] {
  const stats = rankPlaces(placeStats(s));
  const fallback = s.cwd ? placeOfDirCached(s, s.cwd) : '';
  const main = stats[0]?.path ?? fallback;
  const qualified = stats.filter((p) => p.edits >= SPLIT_MIN_EDITS).map((p) => p.path);
  const split = qualified.length >= 2;
  const owners = split ? assignTurns(s, qualified) : s.turns.map(() => main);
  const sumOwners = summaryPlaces(s, owners, main);
  const groups = split ? qualified : [main];
  const cards: Card[] = [];
  groups.forEach((place, gi) => {
    const turns = s.turns.filter((_, i) => owners[i] === place);
    const prompts = turns.filter((t) => t.prompt).map((t) => t.prompt as string);
    const fileCount = new Map<string, number>();
    for (const t of turns) for (const [f, n] of Object.entries(t.files)) fileCount.set(f, (fileCount.get(f) || 0) + n);
    const files = [...fileCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, FILES_CAP)
      .map(([f]) => f);
    const summaries = s.summaries.filter((_, i) => sumOwners[i]?.includes(place)).map((m) => m.text);
    const times = turns.map((t) => t.t).filter(Boolean).sort();
    const git = !!s.gits[place];
    cards.push({
      id: split ? `${s.id}:${gi + 1}` : s.id,
      session: s.id,
      part: gi + 1,
      parts: groups.length,
      place,
      git,
      project: path.basename(place) || place,
      remote: git ? remoteOf(place) ?? undefined : undefined,
      branch: s.branch,
      places: stats,
      first: (split ? times[0] : s.first) || s.first || '',
      last: (split ? times[times.length - 1] : s.last) || s.last || '',
      title: s.customTitle || s.title,
      summaries,
      firstPrompt: prompts[0],
      prompts: spread(prompts.slice(1), 5).map((p) => cut(p, LATER_CAP)),
      files,
      transcript: s.transcript,
      turns: prompts.length,
    });
  });
  return cards.filter((c) => c.turns > 0 || c.summaries.length > 0 || c.files.length > 0 || c.title);
}
