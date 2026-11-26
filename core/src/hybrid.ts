import type { Item } from './model.ts';
import { rankItems, type Hit } from './rank.ts';

export const DIM = 384;

export interface HybridSettings { bar: number; margin: number; gap: number; max: number }

export const HYBRID: HybridSettings = { bar: 0.48, margin: 0.2, gap: 0.01, max: 3 };

export function quantize(values: ArrayLike<number>): Int8Array {
  const out = new Int8Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i] * values[i];
  const norm = Math.sqrt(sum);
  if (!norm || !Number.isFinite(norm)) return out;
  for (let i = 0; i < values.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round((values[i] / norm) * 127)));
  return out;
}

export function cosine(a: Int8Array, b: Int8Array): number {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function median(xs: number[]): number {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function rankHybrid(items: Item[], vectors: Map<string, Int8Array>, query: string, queryVector: Int8Array | null, now: number, settings: Partial<HybridSettings> = {}): Hit[] {
  const words = rankItems(items, query, now);
  if (!queryVector || !queryVector.length || !vectors || !vectors.size) return words;
  const s = { ...HYBRID, ...settings };
  if (words.length >= s.max) return words;
  const scored: { item: Item; c: number }[] = [];
  for (const item of items ?? []) {
    if (item.held || item.kind === 'rule') continue;
    const v = vectors.get(item.id);
    if (!v || v.length !== queryVector.length) continue;
    scored.push({ item, c: cosine(queryVector, v) });
  }
  if (!scored.length) return words;
  scored.sort((x, y) => y.c - x.c);
  const mid = median(scored.map((x) => x.c));
  const best = scored[0].c;
  const out = [...words];
  const taken = new Set(words.map((h) => h.item.id));
  for (const x of scored) {
    if (out.length >= s.max) break;
    if (x.c < s.bar || x.c - mid < s.margin || x.c < best - s.gap) break;
    if (taken.has(x.item.id)) continue;
    taken.add(x.item.id);
    out.push({ item: x.item, score: x.c, matched: 0 });
  }
  return out;
}
