import path from 'node:path';
import { idf, search, type Scored } from './bm25.ts';
import { fileTokens, stem, tokens } from './text.ts';
import { placeOfDir, recentFiles, remoteOf } from './place.ts';
import type { Index, IndexDoc } from './store.ts';

export const DAY = 86400000;
export const START_BAR = 0.1;
export const START_MIN_MATCH = 2;
export const PROMPT_BAR = 0.22;
export const PROMPT_MIN_MATCH = 2;
export const PROMPT_RARE = 0.05;
export const PROMPT_COVER = 0.4;

const CHAT = new Set(
  (
    'next done did fix fixed check checked continue carry ahead good great nice cool fine perfect awesome alright sound sounds think know mean said say tell told show give take put keep start stop finish finished run ran work works working worked wrong issue problem error bug change changes update updates add remove build test tests file files code page step steps part rest last first again better best idea plan point question answer help maybe probably actually today later time bit lot stuff something anything everything nothing little big small happen happened seem seems looks went come came thought ready wait hmm lol btw idk'
  )
    .split(' ')
    .map(stem),
);

export interface PromptTerms {
  weight: Map<string, number>;
  total: number;
}

export function promptTerms(ix: Index, prompt: string): PromptTerms {
  const n = ix.bm25.n;
  const rareMax = Math.max(2, Math.ceil(PROMPT_RARE * n));
  const weight = new Map<string, number>();
  let total = 0;
  for (const t of new Set(tokens(prompt))) {
    if (CHAT.has(t)) continue;
    const df = (ix.bm25.get(t)?.length ?? 0) / 2;
    if (df > rareMax) continue;
    const w = idf(n, df);
    weight.set(t, w);
    total += w;
  }
  return { weight, total };
}
export const REMOTE_BOOST = 1.3;

export function recency(lastMs: number, now: number): number {
  const age = Math.max(0, (now - lastMs) / DAY);
  return 0.4 + 0.6 * Math.exp(-age / 21);
}

export interface Here {
  place: string;
  git: boolean;
  remote: string | null;
  folder: string;
  files: string[];
}

export function describeHere(cwd: string, withFiles = true): Here {
  const p = placeOfDir(cwd);
  const remote = p.git ? remoteOf(p.path) : null;
  const files = withFiles ? recentFiles(cwd) : [];
  return { place: p.path, git: p.git, remote, folder: path.basename(cwd), files };
}

export function startQuery(h: Here): { terms: string[]; weights: Map<string, number> } {
  const weights = new Map<string, number>();
  const terms: string[] = [];
  const add = (ts: string[], w: number) => {
    for (const t of ts) {
      if (!weights.has(t)) terms.push(t);
      weights.set(t, Math.max(weights.get(t) ?? 0, w));
    }
  };
  add(tokens(h.folder), 2);
  add(tokens(path.basename(h.place)), 2);
  if (h.remote) add(tokens(h.remote.split('/').pop() || ''), 2);
  for (const f of h.files) add(fileTokens(f), 1);
  return { terms, weights };
}

export interface Hit extends Scored {
  final: number;
}

export function rankStart(ix: Index, h: Here, now = Date.now(), exclude = new Set<string>()): Hit[] {
  const { terms, weights } = startQuery(h);
  const hits: Hit[] = [];
  for (const s of search(ix.bm25, terms, weights)) {
    const d = ix.docs[s.doc];
    if (!d || d.p === h.place || exclude.has(d.id)) continue;
    if (s.norm < START_BAR || s.matched < Math.min(START_MIN_MATCH, terms.length)) continue;
    let f = s.score * recency(d.t, now);
    if (h.remote && d.r === h.remote) f *= REMOTE_BOOST;
    hits.push({ ...s, final: f });
  }
  hits.sort((a, b) => b.final - a.final);
  return hits;
}

export function newestElsewhere(ix: Index, h: Here, n: number, exclude = new Set<string>()): number[] {
  const out: number[] = [];
  const order = ix.docs.map((d, i) => i).sort((a, b) => ix.docs[b].t - ix.docs[a].t);
  for (const i of order) {
    const d = ix.docs[i];
    if (d.p === h.place || exclude.has(d.id)) continue;
    out.push(i);
    if (out.length >= n) break;
  }
  return out;
}

export function findDocs(ix: Index, q: string, ranked: number, plain: number, keep: (d: IndexDoc) => boolean = () => true): number[] {
  const hits = rankPrompt(ix, q, Date.now(), new Set(), null)
    .map((h) => h.doc)
    .filter((i) => keep(ix.docs[i]))
    .slice(0, ranked);
  if (hits.length) return hits;
  return search(ix.bm25, tokens(q))
    .map((h) => h.doc)
    .filter((i) => keep(ix.docs[i]))
    .slice(0, plain);
}

export function newestDocs(ix: Index, n: number, keep: (d: IndexDoc) => boolean = () => true): number[] {
  return ix.docs
    .map((_, i) => i)
    .filter((i) => keep(ix.docs[i]))
    .sort((a, b) => ix.docs[b].t - ix.docs[a].t)
    .slice(0, n);
}

export function rankPrompt(ix: Index, prompt: string, now = Date.now(), exclude = new Set<string>(), remote: string | null = null): Hit[] {
  const { weight, total } = promptTerms(ix, prompt);
  if (weight.size < PROMPT_MIN_MATCH || !total) return [];
  const cover = new Map<number, number>();
  for (const [t, w] of weight) {
    const p = ix.bm25.get(t);
    if (!p) continue;
    for (let i = 0; i < p.length; i += 2) cover.set(p[i], (cover.get(p[i]) ?? 0) + w);
  }
  const hits: Hit[] = [];
  for (const s of search(ix.bm25, [...weight.keys()])) {
    const d = ix.docs[s.doc];
    if (!d || exclude.has(d.id) || exclude.has(d.s)) continue;
    if (s.matched < PROMPT_MIN_MATCH || (cover.get(s.doc) ?? 0) / total < PROMPT_COVER || s.norm < PROMPT_BAR) continue;
    let f = s.score * recency(d.t, now);
    if (remote && d.r === remote) f *= REMOTE_BOOST;
    hits.push({ ...s, final: f });
  }
  hits.sort((a, b) => b.final - a.final);
  return hits;
}
