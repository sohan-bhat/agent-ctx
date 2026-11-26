import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recall } from '../src/recall.ts';
import { ITEMS, NOW, PROJECTS, QUERIES, type Query } from './corpus.ts';

export interface Score { precision_at_3: number; empty_correct: number; found: number }
export interface Row { query: Query; top: string[]; empty: boolean }

export function run(): Row[] {
  return QUERIES.map((query) => {
    const out = recall({ project: query.project, items: ITEMS, projects: PROJECTS, query: query.q, first: false, session: 'eval', seen: [], now: NOW });
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
  const s = measure();
  console.log(`precision_at_3 ${s.precision_at_3.toFixed(2)}`);
  console.log(`empty_correct ${s.empty_correct.toFixed(2)}`);
  console.log(`found ${s.found.toFixed(2)}`);
}
