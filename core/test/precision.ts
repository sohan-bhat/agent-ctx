import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recall } from '../src/recall.ts';
import type { Item } from '../src/model.ts';
import * as one from './corpus.ts';
import * as two from './corpus2.ts';
import * as three from './corpus3.ts';
import * as four from './corpus4.ts';

export interface Labelled { q: string; project: string; kind: string; want: string[] }
export interface TestSet { items: Item[]; queries: Labelled[]; projects: { key: string; names: string[] }[]; now: number }
export interface Score { precision_at_3: number; empty_correct: number; found: number }
export interface Row { query: Labelled; top: string[]; empty: boolean }

export const SETS: Record<'set1' | 'set2', TestSet> = {
  set1: { items: one.ITEMS, queries: one.QUERIES, projects: one.PROJECTS, now: one.NOW },
  set2: { items: two.ITEMS, queries: two.QUERIES, projects: two.PROJECTS, now: two.NOW },
};

export const SET3: TestSet = { items: three.ITEMS, queries: three.QUERIES, projects: three.PROJECTS, now: three.NOW };

export const SET4: TestSet = { items: four.ITEMS, queries: four.QUERIES, projects: four.PROJECTS, now: four.NOW };

export function run(set: TestSet = SETS.set1): Row[] {
  return set.queries.map((query) => {
    const out = recall({ project: query.project, items: set.items, projects: set.projects, query: query.q, first: false, session: 'eval', seen: [], now: set.now });
    return { query, top: out.delivered.slice(0, 3), empty: out.text === '' };
  });
}

export function measure(rows: Row[] = run()): Score {
  let returned = 0;
  let right = 0;
  let quiet = 0;
  let quietWanted = 0;
  let found = 0;
  let answerable = 0;
  for (const r of rows) {
    const good = r.top.filter((id) => r.query.want.includes(id)).length;
    returned += r.top.length;
    right += good;
    if (r.query.want.length) {
      answerable++;
      if (good > 0) found++;
    } else {
      quietWanted++;
      if (r.empty) quiet++;
    }
  }
  return {
    precision_at_3: returned ? right / returned : 0,
    empty_correct: quietWanted ? quiet / quietWanted : 0,
    found: answerable ? found / answerable : 0,
  };
}

function isMain(): boolean {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const all: [string, TestSet][] = [['set1', SETS.set1], ['set2', SETS.set2], ['set3', SET3], ['set4', SET4]];
  for (const [name, set] of all) {
    const s = measure(run(set));
    console.log(`${name}_precision_at_3 ${s.precision_at_3.toFixed(2)}`);
    console.log(`${name}_empty_correct ${s.empty_correct.toFixed(2)}`);
    console.log(`${name}_found ${s.found.toFixed(2)}`);
  }
}
