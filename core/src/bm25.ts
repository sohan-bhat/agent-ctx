export const K1 = 1.2;
export const B = 0.75;

export interface Postings {
  [term: string]: number[];
}

export interface Bm25Data {
  n: number;
  avgdl: number;
  dl: number[];
  terms: Postings;
}

export interface Bm25View {
  n: number;
  avgdl: number;
  dl: number[];
  get(term: string): number[] | undefined;
}

export function buildBm25(docs: string[][]): Bm25Data {
  const terms: Postings = Object.create(null);
  const dl: number[] = [];
  let total = 0;
  docs.forEach((toks, i) => {
    dl.push(toks.length);
    total += toks.length;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, n] of tf) {
      let p = terms[t];
      if (!p) p = terms[t] = [];
      p.push(i, n);
    }
  });
  return { n: docs.length, avgdl: docs.length ? total / docs.length : 0, dl, terms };
}

export function view(data: Bm25Data): Bm25View {
  return { n: data.n, avgdl: data.avgdl, dl: data.dl, get: (t) => data.terms[t] };
}

export function bucketOf(term: string, buckets: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < term.length; i++) {
    h ^= term.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % buckets;
}

export function idf(n: number, df: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

export interface Scored {
  doc: number;
  score: number;
  norm: number;
  matched: number;
}

export const COMMON = 0.5;

export function search(data: Bm25View, query: string[], weights?: Map<string, number>): Scored[] {
  const q = new Map<string, number>();
  for (const t of query) q.set(t, (q.get(t) || 0) + (weights?.get(t) ?? 1));
  const n = data.n;
  const acc = new Float64Array(n);
  const hit = new Uint16Array(n);
  const touched: number[] = [];
  const avg = data.avgdl || 1;
  const dl = data.dl;
  let max = 0;
  for (const [t, qw] of q) {
    const p = data.get(t);
    if (!p) continue;
    const df = p.length / 2;
    if (n >= 20 && df / n > COMMON) continue;
    const w = idf(n, df) * qw;
    max += w * (K1 + 1);
    for (let i = 0; i < p.length; i += 2) {
      const doc = p[i];
      const tf = p[i + 1];
      const s = (w * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dl[doc]) / avg));
      if (hit[doc] === 0) touched.push(doc);
      acc[doc] += s;
      hit[doc]++;
    }
  }
  const out: Scored[] = [];
  for (const doc of touched) out.push({ doc, score: acc[doc], norm: max ? acc[doc] / max : 0, matched: hit[doc] });
  out.sort((a, b) => b.score - a.score);
  return out;
}
