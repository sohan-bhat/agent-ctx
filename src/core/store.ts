import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, ensureDir, readJson, readJsonl } from './fsx.ts';
import type { Store } from './paths.ts';
import { bucketOf, buildBm25, type Bm25View } from './bm25.ts';
import { fileTokens, tokens } from './text.ts';
import { shares } from './limits.ts';
import type { Card, SessionState } from './session.ts';

export interface IndexDoc {
  id: string;
  s: string;
  o: number;
  l: number;
  t: number;
  p: string;
  g: number;
  r?: string;
  n: string;
  d: number;
}

export interface IndexFile {
  v: 2;
  terms: string;
  built: string;
  size: number;
  n: number;
  avgdl: number;
  buckets: number;
  offsets: number[];
  docs: IndexDoc[];
}

export interface Index extends IndexFile {
  bm25: Bm25View;
}

export function termsFile(st: Store, name: string): string {
  return path.join(path.dirname(st.index), path.basename(name));
}

export function cardTokens(c: Card): string[] {
  const out: string[] = [];
  const title = tokens(c.title || '');
  for (let i = 0; i < 3; i++) out.push(...title);
  const proj = tokens(c.project);
  out.push(...proj, ...proj);
  for (const s of c.summaries) out.push(...tokens(s));
  if (c.firstPrompt) out.push(...tokens(c.firstPrompt));
  for (const p of c.prompts) out.push(...tokens(p));
  for (const f of c.files) {
    const ft = fileTokens(f);
    out.push(...ft, ...ft);
  }
  return out;
}

export function loadCards(st: Store): Card[] {
  return readJsonl<Card>(st.cards);
}

export function writeCardsAndIndex(st: Store, all: Card[], maxBytes: number = shares().cards): Index {
  all.sort((a, b) => (b.last || '').localeCompare(a.last || ''));
  const docs: IndexDoc[] = [];
  const parts: string[] = [];
  const cards: Card[] = [];
  let off = 0;
  for (const c of all) {
    const line = JSON.stringify(c) + '\n';
    const len = Buffer.byteLength(line);
    if (off + len > maxBytes && cards.length) break;
    cards.push(c);
    docs.push({
      id: c.id,
      s: c.session,
      o: off,
      l: len - 1,
      t: Date.parse(c.last || c.first || '') || 0,
      p: c.place,
      g: c.git ? 1 : 0,
      r: c.remote,
      n: c.project,
      d: 0,
    });
    parts.push(line);
    off += len;
  }
  const body = parts.join('');
  atomicWrite(st.cards, body);
  const bm = buildBm25(cards.map(cardTokens));
  bm.dl.forEach((v, i) => (docs[i].d = v));
  const nterms = Object.keys(bm.terms).length;
  const buckets = Math.max(64, 1 << Math.ceil(Math.log2(Math.max(1, nterms / 12))));
  const groups: Record<string, number[]>[] = Array.from({ length: buckets }, () => ({}));
  for (const t in bm.terms) groups[bucketOf(t, buckets)][t] = bm.terms[t];
  const offsets: number[] = [0];
  const lines: string[] = [];
  let at = 0;
  for (const g of groups) {
    const line = JSON.stringify(g) + '\n';
    lines.push(line);
    at += Buffer.byteLength(line);
    offsets.push(at);
  }
  const terms = `terms-${Date.now().toString(36)}${process.pid.toString(36)}.jsonl`;
  atomicWrite(termsFile(st, terms), lines.join(''));
  const file: IndexFile = { v: 2, terms, built: new Date().toISOString(), size: Buffer.byteLength(body), n: bm.n, avgdl: bm.avgdl, buckets, offsets, docs };
  atomicWrite(st.index, JSON.stringify(file));
  try {
    for (const f of fs.readdirSync(st.home)) if (/^terms-.*\.jsonl$/.test(f) && f !== terms) fs.rmSync(path.join(st.home, f), { force: true });
  } catch {}
  return attach(st, file);
}

function attach(st: Store, file: IndexFile): Index {
  const dl = file.docs.map((d) => d.d);
  const cache = new Map<number, Record<string, number[]>>();
  let fd: number | null = null;
  const bucket = (b: number): Record<string, number[]> => {
    let g = cache.get(b);
    if (g) return g;
    g = {};
    try {
      fd ??= fs.openSync(termsFile(st, file.terms), 'r');
      const len = file.offsets[b + 1] - file.offsets[b];
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, file.offsets[b]);
      g = JSON.parse(buf.toString('utf8')) as Record<string, number[]>;
    } catch {}
    cache.set(b, g);
    return g;
  };
  const bm25: Bm25View = {
    n: file.n,
    avgdl: file.avgdl,
    dl,
    get: (t) => {
      const g = bucket(bucketOf(t, file.buckets));
      return Object.prototype.hasOwnProperty.call(g, t) ? g[t] : undefined;
    },
  };
  return { ...file, bm25 };
}

export function loadIndex(st: Store): Index | null {
  const ix = readJson<IndexFile>(st.index);
  if (!ix || ix.v !== 2 || !Array.isArray(ix.docs) || !Array.isArray(ix.offsets)) return null;
  return attach(st, ix);
}

export function readCards(st: Store, ix: Index, docIdx: number[]): Card[] {
  const out: Card[] = [];
  let fd: number;
  try {
    fd = fs.openSync(st.cards, 'r');
  } catch {
    return out;
  }
  try {
    let all: Card[] | null = null;
    for (const i of docIdx) {
      const d = ix.docs[i];
      if (!d) continue;
      let card: Card | null = null;
      try {
        const buf = Buffer.alloc(d.l);
        fs.readSync(fd, buf, 0, d.l, d.o);
        const c = JSON.parse(buf.toString('utf8')) as Card;
        if (c.id === d.id) card = c;
      } catch {}
      if (!card) {
        all ??= loadCards(st);
        card = all.find((c) => c.id === d.id) ?? null;
      }
      if (card) out.push(card);
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

export function sessionFile(st: Store, id: string): string {
  return path.join(st.sessions, id.replace(/[^A-Za-z0-9_-]/g, '_') + '.json');
}

export function loadSession(st: Store, id: string): SessionState | null {
  const s = readJson<SessionState>(sessionFile(st, id));
  return s && s.v === 2 ? s : null;
}

export function saveSession(st: Store, s: SessionState): void {
  ensureDir(st.sessions);
  atomicWrite(sessionFile(st, s.id), JSON.stringify(s));
}

export function upsertCards(existing: Card[], session: string, fresh: Card[]): Card[] {
  return [...existing.filter((c) => c.session !== session), ...fresh];
}
