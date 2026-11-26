import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { itemText, type Item } from '../src/model.ts';
import { namedQueries, recall } from '../src/recall.ts';
import type { HybridSettings } from '../src/hybrid.ts';
import type { Row, TestSet } from './precision.ts';

export const VECTORS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vectors.json');

export interface VectorFile { model: string; pooling: string; dim: number; entries: Record<string, string> }

export function textKey(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32);
}

export function encode(v: Int8Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
}

export function decode(s: string): Int8Array {
  const b = Buffer.from(s, 'base64');
  return new Int8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export function loadVectors(file: string = VECTORS): VectorFile | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as VectorFile;
  } catch {
    return null;
  }
}

function pooled(i: Item): boolean {
  return !i.held && (i.kind === 'card' || i.kind === 'handoff');
}

export function textsOf(set: TestSet): string[] {
  const out = new Set<string>();
  for (const i of set.items) if (pooled(i)) out.add(itemText(i));
  for (const q of set.queries) {
    out.add(q.q);
    for (const n of namedQueries(q.q, set.projects, q.project)) out.add(n.query);
  }
  return [...out];
}

export function missing(file: VectorFile | null, set: TestSet): number {
  if (!file) return textsOf(set).length;
  return textsOf(set).filter((t) => !(textKey(t) in file.entries)).length;
}

export function runHybrid(set: TestSet, file: VectorFile, hybrid: Partial<HybridSettings> = {}): Row[] {
  const vec = (text: string): Int8Array | null => {
    const e = file.entries[textKey(text)];
    return e ? decode(e) : null;
  };
  const vectors = new Map<string, Int8Array>();
  for (const i of set.items) {
    if (!pooled(i)) continue;
    const v = vec(itemText(i));
    if (v) vectors.set(i.id, v);
  }
  return set.queries.map((query) => {
    const namedVectors = new Map<string, Int8Array>();
    for (const n of namedQueries(query.q, set.projects, query.project)) {
      const v = vec(n.query);
      if (v) namedVectors.set(n.key, v);
    }
    const out = recall({ project: query.project, items: set.items, projects: set.projects, query: query.q, first: false, session: 'eval', seen: [], now: set.now, vectors, queryVector: vec(query.q), namedVectors, hybrid });
    return { query, top: out.delivered.slice(0, 3), empty: out.text === '' };
  });
}
