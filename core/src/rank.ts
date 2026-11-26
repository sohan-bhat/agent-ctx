import { B, K1, buildBm25, idf, view, type Bm25View } from './bm25.ts';
import { itemText, type CardBody, type Item } from './model.ts';
import { projectName } from './project.ts';
import { joinPhrases, synonymsOf } from './synonyms.ts';
import { stem, tokens } from './text.ts';

export const DAY = 86400000;
export const MIN_MATCH = 2;
export const SHORT_TERMS = 6;
export const BAR = 0.22;
export const COVER = 0.45;
export const COMMON = 0.5;
export const UNKNOWN = 1;
export const LONG_MATCH = 3;
export const LONG_RARE = 2;
export const RARE = 0.05;
export const LONG_BAR = 6;
export const STAND = 1.5;
export const REL = 0.8;
export const SYN = 0.5;
export const TYPO_MIN = 5;

export interface Hit { item: Item; score: number; matched: number }

const CHAT = new Set(
  (
    'next done did fix fixed check checked continue carry ahead good great nice cool fine perfect awesome alright sound sounds think know mean said say tell told show give take put keep start stop finish finished run ran work works working worked wrong issue problem error bug change changes update updates add remove build test tests file files code page step steps part rest last first again better best idea plan point question answer help maybe probably actually today later time bit lot stuff something anything everything nothing little big small happen happened seem seems looks went come came thought ready wait hmm lol btw idk ' +
    'remember recall earlier decide decided decision decisions discuss discussed talk talked mention mentioned leave left whatever session agent ' +
    'again already still please thank thanks want wanted need try tried think guess remind somewhere somehow thing stuck fail fails failed failing broke broken break breaks write wrote written support handle sure able else another kind sort whole hey yep nope basically'
  )
    .split(' ')
    .map(stem),
);

export function recency(at: number, now: number): number {
  const age = Math.max(0, (now - at) / DAY);
  return 0.4 + 0.6 * Math.exp(-age / 21);
}

const cached = new WeakMap<Item, { body: unknown; toks: string[] }>();

function docTokens(i: Item): string[] {
  const hit = cached.get(i);
  if (hit && hit.body === i.body) return hit.toks;
  const toks = tokens(joinPhrases(itemText(i)));
  cached.set(i, { body: i.body, toks });
  return toks;
}

export function oneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const s = la < lb ? a : b;
  const l = la < lb ? b : a;
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

export function typoOf(term: string, vocab: string[]): string | null {
  if (term.length < TYPO_MIN) return null;
  let found: string | null = null;
  for (const v of vocab) {
    if (Math.abs(v.length - term.length) > 1 || !oneEdit(term, v)) continue;
    if (found) return null;
    found = v;
  }
  return found;
}

interface Alt { term: string; factor: number; df: number }
interface Term { alts: Alt[]; weight: number }
interface Acc { score: number; matched: number; evidence: number; rare: number }

function queryTerms(query: string, index: Bm25View, vocab: () => string[], n: number): Term[] {
  const dfOf = (t: string) => (index.get(t)?.length ?? 0) / 2;
  const common = (df: number) => n >= 4 && df / n > COMMON;
  const out: Term[] = [];
  const seen = new Set<string>();
  for (const raw of new Set(tokens(joinPhrases(query)))) {
    if (CHAT.has(raw)) continue;
    let t = raw;
    let df = dfOf(t);
    if (!df) {
      const fix = typoOf(t, vocab());
      if (fix && !CHAT.has(fix)) {
        t = fix;
        df = dfOf(t);
      }
    }
    if (seen.has(t) || common(df)) continue;
    seen.add(t);
    const alts: Alt[] = df ? [{ term: t, factor: 1, df }] : [];
    for (const s of synonymsOf(t)) {
      const d = dfOf(s);
      if (d && !CHAT.has(s) && !common(d) && !alts.some((a) => a.term === s)) alts.push({ term: s, factor: SYN, df: d });
    }
    out.push({ alts, weight: idf(n, df) * (df ? 1 : UNKNOWN) });
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function rankItems(items: Item[], query: string, now: number): Hit[] {
  const pool = (items ?? []).filter((i) => !i.held && i.kind !== 'rule');
  if (!pool.length || !(query ?? '').trim()) return [];
  const data = buildBm25(pool.map(docTokens));
  const index = view(data);
  const n = pool.length;
  const avg = data.avgdl || 1;
  let vocab: string[] | null = null;
  const terms = queryTerms(query, index, () => (vocab ??= Object.keys(data.terms)), n);
  if (!terms.length || !terms.some((t) => t.alts.length)) return [];
  const long = terms.length > SHORT_TERMS;
  const total = terms.reduce((a, t) => a + t.weight, 0);
  const rareMax = Math.max(2, Math.round(RARE * n));
  let best = 0;
  for (const t of terms) best += Math.max(0, ...t.alts.map((a) => a.factor * idf(n, a.df))) * (K1 + 1);
  const acc = new Map<number, Acc>();
  for (const t of terms) {
    const top = new Map<number, { c: number; w: number; rare: boolean }>();
    for (const a of t.alts) {
      const p = index.get(a.term) as number[];
      const w = a.factor * idf(n, a.df);
      for (let k = 0; k < p.length; k += 2) {
        const doc = p[k];
        const tf = p[k + 1];
        const c = (w * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * data.dl[doc]) / avg));
        const prev = top.get(doc);
        if (!prev || c > prev.c) top.set(doc, { c, w, rare: a.df <= rareMax });
      }
    }
    for (const [doc, v] of top) {
      const s = acc.get(doc) ?? { score: 0, matched: 0, evidence: 0, rare: 0 };
      s.score += v.c;
      s.matched++;
      s.evidence += v.w;
      if (v.rare) s.rare++;
      acc.set(doc, s);
    }
  }
  if (!acc.size) return [];
  const mid = median([...acc.values()].map((s) => s.score));
  const lone = acc.size <= 2;
  const need = Math.min(MIN_MATCH, terms.length);
  const kept: { doc: number; s: Acc }[] = [];
  for (const [doc, s] of acc) {
    const pass = long
      ? s.matched >= LONG_MATCH && s.rare >= LONG_RARE && s.evidence >= LONG_BAR
      : s.matched >= need && (best ? s.score / best : 0) >= BAR && (total ? s.evidence / total : 0) >= COVER;
    if (!pass || !(lone || s.score >= STAND * mid)) continue;
    kept.push({ doc, s });
  }
  if (!kept.length) return [];
  const top = Math.max(...kept.map((k) => k.s.score));
  return kept
    .filter((k) => k.s.score >= REL * top)
    .map((k) => {
      const item = pool[k.doc];
      return { item, score: k.s.score * recency(item.created, now), matched: k.s.matched };
    })
    .sort((a, b) => b.score - a.score);
}

function sessionOf(i: Item): string | null {
  return i.origin?.session ? `${i.origin.agent}\u0001${i.origin.session}` : null;
}

export function recent(items: Item[], n: number): Item[] {
  const pool = (items ?? []).filter((i) => (i.kind === 'card' || i.kind === 'handoff') && !i.held);
  const written = new Set<string>();
  for (const i of pool) {
    const s = sessionOf(i);
    if (s && i.kind === 'card' && !(i.body as CardBody).auto) written.add(s);
  }
  return pool
    .filter((i) => {
      const s = sessionOf(i);
      return !(i.kind === 'card' && (i.body as CardBody).auto && s && written.has(s));
    })
    .sort((a, b) => b.created - a.created)
    .slice(0, Math.max(0, n));
}

export function plainWords(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function namesOf(p: { key: string; names: string[] }): string[] {
  return [projectName(p.key), ...(p.names ?? [])].map(plainWords).filter((x) => x.length >= 2);
}

export function namedProjects(query: string, projects: { key: string; names: string[] }[], current: string): string[] {
  const q = ` ${plainWords(query)} `;
  const out: string[] = [];
  for (const p of projects ?? []) {
    if (p.key === current || out.includes(p.key)) continue;
    if (namesOf(p).some((name) => q.includes(` ${name} `))) out.push(p.key);
  }
  return out;
}
