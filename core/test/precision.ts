import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recall, type LooseSettings } from '../src/recall.ts';
import type { Item } from '../src/model.ts';
import * as one from './corpus.ts';
import * as two from './corpus2.ts';
import * as twoB from './corpus2b.ts';
import * as three from './corpus3.ts';
import * as four from './corpus4.ts';
import * as lang from './corpus-lang.ts';

export interface Labelled { q: string; project: string; kind: string; want: string[] }
export interface TestSet { items: Item[]; queries: Labelled[]; projects: { key: string; names: string[] }[]; now: number }
export interface Score { precision_at_3: number; empty_correct: number; found: number }
export interface Row { query: Labelled; top: string[]; empty: boolean }

export const SETS: Record<'set1' | 'set2', TestSet> = {
  set1: { items: one.ITEMS, queries: one.QUERIES, projects: one.PROJECTS, now: one.NOW },
  set2: { items: two.ITEMS, queries: two.QUERIES, projects: two.PROJECTS, now: two.NOW },
};

export const SET2B: TestSet = { items: two.ITEMS, queries: twoB.QUERIES, projects: two.PROJECTS, now: two.NOW };

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

export const SET_LANG: TestSet = { items: lang.ITEMS, queries: lang.QUERIES, projects: lang.PROJECTS, now: lang.NOW };

export const SET_LANG2: TestSet = { items: lang.SECOND.items, queries: lang.SECOND.queries, projects: lang.SECOND.projects, now: lang.SECOND.now };

export const SET_LANG3: TestSet = { items: lang.THIRD.items, queries: lang.THIRD.queries, projects: lang.THIRD.projects, now: lang.THIRD.now };

export const TOOL_KINDS = new Set(['short', 'other', 'cross']);

export function reachable(set: TestSet, loose: Partial<LooseSettings> = {}): number {
  let asked = 0;
  let reached = 0;
  for (const query of set.queries) {
    if (!TOOL_KINDS.has(query.kind)) continue;
    asked++;
    const out = recall({ project: query.project, items: set.items, projects: set.projects, query: query.q, first: false, session: 'eval', seen: [], now: set.now, tool: true, loose });
    const shown = new Set([...out.delivered, ...(out.topics ?? [])]);
    if (query.want.some((id) => shown.has(id))) reached++;
  }
  return asked ? reached / asked : 0;
}

function isMain(): boolean {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const all: [string, TestSet][] = [['set1', SETS.set1], ['set2', SETS.set2], ['set3', SET3], ['set4', SET4], ['set2b', SET2B]];
  for (const [name, set] of all) {
    const s = measure(run(set));
    console.log(`${name}_precision_at_3 ${s.precision_at_3.toFixed(2)}`);
    console.log(`${name}_empty_correct ${s.empty_correct.toFixed(2)}`);
    console.log(`${name}_found ${s.found.toFixed(2)}`);
  }
  const tool: [string, TestSet][] = [['set2', SETS.set2], ['set2b', SET2B], ['set3', SET3], ['set4', SET4]];
  for (const [name, set] of tool) console.log(`tool_${name}_reachable ${reachable(set).toFixed(2)}`);
  const rows = run(SET_LANG);
  const s = measure(rows);
  console.log(`lang_precision_at_3 ${s.precision_at_3.toFixed(2)}`);
  console.log(`lang_empty_correct ${s.empty_correct.toFixed(2)}`);
  console.log(`lang_found ${s.found.toFixed(2)}`);
  for (const code of lang.LANGS) {
    const own = rows.filter((r) => (r.query as lang.LangQuery).lang === code);
    console.log(`lang_${code}_found ${measure(own).found.toFixed(2)}`);
  }
  for (const code of lang.LANGS) {
    const own = rows.filter((r) => (r.query as lang.LangQuery).lang === code);
    console.log(`lang_${code}_precision_at_3 ${measure(own).precision_at_3.toFixed(2)}`);
  }
  const rows2 = run(SET_LANG2);
  const s2 = measure(rows2);
  console.log(`lang2_precision_at_3 ${s2.precision_at_3.toFixed(2)}`);
  console.log(`lang2_empty_correct ${s2.empty_correct.toFixed(2)}`);
  console.log(`lang2_found ${s2.found.toFixed(2)}`);
  for (const code of lang.SECOND.langs) {
    const own = rows2.filter((r) => r.query.project === lang.SECOND.projects[lang.SECOND.langs.indexOf(code)].key);
    console.log(`lang2_${code}_precision_at_3 ${measure(own).precision_at_3.toFixed(2)}`);
  }
  const rows3 = run(SET_LANG3);
  const s3 = measure(rows3);
  console.log(`lang3_precision_at_3 ${s3.precision_at_3.toFixed(2)}`);
  console.log(`lang3_empty_correct ${s3.empty_correct.toFixed(2)}`);
  console.log(`lang3_found ${s3.found.toFixed(2)}`);
  for (const code of lang.THIRD.langs) {
    const own = rows3.filter((r) => r.query.project === lang.THIRD.projects[lang.THIRD.langs.indexOf(code)].key);
    console.log(`lang3_${code}_precision_at_3 ${measure(own).precision_at_3.toFixed(2)}`);
  }
}
