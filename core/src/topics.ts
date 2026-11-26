import { idf } from './bm25.ts';
import { itemText, type CardBody, type HandoffBody, type Item } from './model.ts';
import { isChat, typoOf } from './rank.ts';
import { joinPhrases, synonymsOf } from './synonyms.ts';
import { tokens } from './text.ts';

export const SHORT = 8;
export const TOPICS = 12;

export interface LooseSettings { fields: 'goal' | 'all'; weight: 'count' | 'idf'; syn: number; prefix: number }

export const LOOSE: LooseSettings = { fields: 'all', weight: 'idf', syn: 0.5, prefix: 5 };

function shared(a: string, b: string): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
}

export function shortIds(items: Item[]): Map<string, string> {
  const ids = [...new Set((items ?? []).map((i) => i?.id).filter((id): id is string => typeof id === 'string' && id.length > 0))].sort();
  const out = new Map<string, string>();
  ids.forEach((id, k) => {
    let need = SHORT;
    if (k > 0) need = Math.max(need, shared(id, ids[k - 1]) + 1);
    if (k + 1 < ids.length) need = Math.max(need, shared(id, ids[k + 1]) + 1);
    out.set(id, id.slice(0, Math.min(need, id.length)));
  });
  return out;
}

export function resolveIds(items: Item[], ids: string[]): Item[] {
  const list = (items ?? []).filter((i) => i && typeof i.id === 'string');
  const byId = new Map(list.map((i) => [i.id, i]));
  const byShort = new Map<string, Item>();
  for (const [id, s] of shortIds(list)) byShort.set(s, byId.get(id) as Item);
  const out: Item[] = [];
  for (const raw of ids ?? []) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) continue;
    let hit = byId.get(s) ?? byShort.get(s);
    if (!hit && s.length >= SHORT) {
      const starts = list.filter((i) => i.id.startsWith(s));
      if (starts.length === 1) hit = starts[0];
    }
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

function goalOf(i: Item): string {
  const b = i.body as CardBody | HandoffBody;
  return typeof b?.goal === 'string' ? b.goal : '';
}

function looseText(i: Item, fields: LooseSettings['fields']): string {
  return fields === 'goal' ? goalOf(i) : itemText(i);
}

export function looseScores(items: Item[], query: string, settings: Partial<LooseSettings> = {}): Map<string, number> {
  const s = { ...LOOSE, ...settings };
  const docs = items.map((i) => new Set(tokens(joinPhrases(looseText(i, s.fields)))));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
  const n = items.length;
  const weight = (t: string) => (s.weight === 'idf' ? idf(n, df.get(t) ?? 0) : 1);
  let vocab: Map<number, string[]> | null = null;
  const byLength = () => {
    if (vocab) return vocab;
    vocab = new Map();
    for (const t of df.keys()) {
      const list = vocab.get(t.length) ?? [];
      list.push(t);
      vocab.set(t.length, list);
    }
    return vocab;
  };
  const terms: string[] = [];
  for (const raw of new Set(tokens(joinPhrases(query ?? '')))) {
    if (isChat(raw)) continue;
    let t = raw;
    if (!df.has(t)) {
      const fix = typoOf(t, byLength());
      if (fix && !isChat(fix)) t = fix;
    }
    if (!terms.includes(t)) terms.push(t);
  }
  const out = new Map<string, number>();
  items.forEach((item, k) => {
    const d = docs[k];
    let score = 0;
    for (const t of terms) {
      let best = d.has(t) ? weight(t) : 0;
      if (s.syn > 0) for (const o of synonymsOf(t)) if (!isChat(o) && d.has(o)) best = Math.max(best, s.syn * weight(o));
      if (!best && s.prefix > 0 && t.length >= s.prefix) {
        const head = t.slice(0, s.prefix);
        for (const w of d) {
          if (w !== t && w.startsWith(head)) {
            best = Math.max(best, 0.5 * weight(w));
          }
        }
      }
      score += best;
    }
    out.set(item.id, score);
  });
  return out;
}

function ranked(items: Item[], query: string, settings: Partial<LooseSettings>): { item: Item; score: number }[] {
  const pool = (items ?? []).filter((i) => i && !i.held && (i.kind === 'card' || i.kind === 'handoff'));
  const scores = looseScores(pool, query, settings);
  return pool
    .map((item) => ({ item, score: scores.get(item.id) ?? 0 }))
    .sort((a, b) => (b.score > 0 ? 1 : 0) - (a.score > 0 ? 1 : 0) || b.score - a.score || b.item.created - a.item.created || (a.item.id < b.item.id ? -1 : 1));
}

export function topicList(items: Item[], query: string, now: number, settings: Partial<LooseSettings> = {}): { items: Item[]; more: number } {
  void now;
  const all = ranked(items, query, settings);
  return { items: all.slice(0, TOPICS).map((x) => x.item), more: Math.max(0, all.length - TOPICS) };
}

export function looseMatches(items: Item[], query: string, settings: Partial<LooseSettings> = {}): Item[] {
  return ranked(items, query, settings)
    .filter((x) => x.score > 0)
    .map((x) => x.item);
}
