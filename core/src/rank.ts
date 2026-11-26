import { buildBm25, idf, search, view } from './bm25.ts';
import { itemText, type CardBody, type Item } from './model.ts';
import { projectName } from './project.ts';
import { stem, tokens } from './text.ts';

export const DAY = 86400000;
export const MIN_MATCH = 2;
export const BAR = 0.22;
export const COVER = 0.45;
export const REL = 0.8;
export const COMMON = 0.5;
export const UNKNOWN = 1;

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

export function rankItems(items: Item[], query: string, now: number): Hit[] {
  const pool = (items ?? []).filter((i) => !i.held && i.kind !== 'rule');
  if (!pool.length || !(query ?? '').trim()) return [];
  const docs = pool.map((i) => tokens(itemText(i)));
  const index = view(buildBm25(docs));
  const n = pool.length;
  const weight = new Map<string, number>();
  let total = 0;
  for (const t of new Set(tokens(query))) {
    if (CHAT.has(t)) continue;
    const df = (index.get(t)?.length ?? 0) / 2;
    if (n >= 4 && df / n > COMMON) continue;
    const w = idf(n, df) * (df ? 1 : UNKNOWN);
    weight.set(t, w);
    total += w;
  }
  const known = [...weight.keys()].filter((t) => index.get(t));
  if (!known.length || !total) return [];
  const need = Math.min(MIN_MATCH, weight.size);
  const cover = new Map<number, number>();
  for (const t of known) {
    const p = index.get(t) as number[];
    for (let i = 0; i < p.length; i += 2) cover.set(p[i], (cover.get(p[i]) ?? 0) + (weight.get(t) ?? 0));
  }
  const raw: { hit: Hit; base: number }[] = [];
  for (const s of search(index, known)) {
    if (s.matched < need || s.norm < BAR || (cover.get(s.doc) ?? 0) / total < COVER) continue;
    const item = pool[s.doc];
    raw.push({ hit: { item, score: s.score * recency(item.created, now), matched: s.matched }, base: s.score });
  }
  if (!raw.length) return [];
  const best = Math.max(...raw.map((r) => r.base));
  return raw
    .filter((r) => r.base >= REL * best)
    .map((r) => r.hit)
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
