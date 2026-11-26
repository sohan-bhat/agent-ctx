import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS } from '../core/test/corpus2.ts';
import { QUERIES } from '../core/test/corpus2b.ts';
import { GALE, PANTRY } from '../core/test/corpus.ts';
import { paths, runClaude, spentSoFar } from './claude.mjs';
import { open } from './mcp.mjs';
import { jarFrom, page } from './oauth.mjs';

export const SEEDED = [GALE, PANTRY];
export const RECALL = 'mcp__agent-ctx__recall';
const TOOLS = [RECALL, 'Read'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const nameOf = (key) => key.split('/').pop();
const remoteOf = (key) => `git@github.com:${key.split('/').slice(1).join('/')}.git`;

function args(item) {
  const b = item.body;
  const decisions = [...(b.decisions ?? []).map((d) => (d.why ? `${d.what}, because ${d.why}` : d.what)), ...(b.last ? [b.last] : [])];
  const out = { repo: `https://${item.project}`, goal: b.goal };
  if (b.changed?.length) out.changed = b.changed.map((c) => c.path);
  if (decisions.length) out.decisions = decisions;
  if (b.commands?.length) out.commands = b.commands;
  if (b.dead_ends?.length) out.dead_ends = b.dead_ends;
  if (b.open?.length) out.open = b.open;
  return out;
}

export function cards() {
  return ITEMS.filter((i) => i.kind === 'card' && SEEDED.includes(i.project)).sort((a, b) => a.created - b.created);
}

export function queries() {
  return QUERIES.filter((q) => q.kind === 'other' && SEEDED.includes(q.project)).slice(0, 10);
}

async function seed(secretsFile, out) {
  const s = JSON.parse(readFileSync(secretsFile, 'utf8'));
  const agent = await open(s.B.access);
  const list = cards();
  let ok = 0;
  for (const item of list) {
    const r = await agent.call('checkpoint', args(item));
    if (r.isError || r.error) throw new Error(`Card ${item.id} was not saved, ${r.text || JSON.stringify(r.error)}`);
    ok++;
    await sleep(1100);
  }
  const sp = await page(jarFrom(s.cookie), 'GET', '/space');
  const map = {};
  for (const item of list) {
    const found = sp.json.items.find((i) => i.kind === 'card' && i.project === item.project && i.body.goal === item.body.goal);
    if (found) map[item.id] = { id: found.id, goal: item.body.goal, body: item.body };
  }
  writeFileSync(out, JSON.stringify(map, null, 1) + '\n');
  return { saved: ok, mapped: Object.keys(map).length };
}

function project(root, key, n) {
  const dir = join(root, String(n), nameOf(key));
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remoteOf(key)]);
  writeFileSync(join(dir, 'README.md'), `# ${nameOf(key)}\n`);
  return dir;
}

export function prompt(q) {
  return `check agent-ctx for what we decided about ${q.q} and tell me in one sentence`;
}

async function run(p, root) {
  const done = new Set(existsSync(p.ledger) ? readFileSync(p.ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).name) : []);
  let n = 0;
  for (const q of queries()) {
    n++;
    const name = `t${String(n).padStart(2, '0')}-${q.want[0]}`;
    if (done.has(name)) continue;
    const cwd = project(root, q.project, n);
    const r = await runClaude(p, { name, side: 'A', cwd, prompts: [prompt(q)], tools: TOOLS, layout: 'tools', model: 'haiku' });
    console.log(`${r.row.n} ${name} ${r.row.cost.toFixed(5)}`);
  }
}

export function analyse(file, q, map) {
  const calls = [];
  const results = new Map();
  let final = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'tool_use' && c.name === RECALL) calls.push({ id: c.id, input: c.input ?? {} });
    if (e.type === 'user') for (const c of e.message?.content ?? []) if (c.type === 'tool_result') results.set(c.tool_use_id, (Array.isArray(c.content) ? c.content.map((x) => x.text ?? '').join('') : String(c.content ?? '')));
    if (e.type === 'result') final = String(e.result ?? '');
  }
  const wanted = q.want.map((w) => map[w]).filter(Boolean);
  const shorts = wanted.map((w) => w.id.slice(0, 8));
  const withQuery = calls.filter((c) => typeof c.input.query === 'string' && c.input.query.trim());
  const first = withQuery[0];
  const firstText = first ? results.get(first.id) ?? '' : '';
  const topicList = /TOPICS/.test(firstText);
  const hits = !topicList && /EARLIER|HANDOFF/.test(firstText);
  const idCalls = calls.filter((c) => Array.isArray(c.input.ids) && c.input.ids.length);
  const askedRight = idCalls.some((c) => c.input.ids.some((id) => shorts.some((s) => String(id).startsWith(s.slice(0, 8)) || s.startsWith(String(id)))));
  const marker = (b) => b.decisions?.[0]?.what ?? b.changed?.[0]?.path ?? b.commands?.[0] ?? String(b.last ?? '').slice(0, 40);
  const fullBlock = (text) => wanted.some((w) => text.includes(marker(w.body)));
  const readRight = idCalls.some((c) => fullBlock(results.get(c.id) ?? '')) || (hits && fullBlock(firstText));
  const chars = calls.reduce((n, c) => n + JSON.stringify(c.input).length + (results.get(c.id) ?? '').length, 0);
  return {
    recallWithQuery: !!first,
    query: first?.input.query ?? null,
    topicList,
    hits,
    gotListOrHits: topicList || hits,
    wantedInList: shorts.some((s) => firstText.includes(s)),
    recallWithIds: idCalls.length > 0,
    idsAsked: idCalls.flatMap((c) => c.input.ids),
    askedRight,
    readRight,
    recallCalls: calls.length,
    recallChars: chars,
    recallTokensEstimate: Math.round(chars / 4),
    final,
  };
}

export function count(proofs, mapFile) {
  const map = JSON.parse(readFileSync(mapFile, 'utf8'));
  const qs = queries();
  const rows = qs.map((q, i) => {
    const name = `t${String(i + 1).padStart(2, '0')}-${q.want[0]}`;
    const file = join(proofs, `${name}.jsonl`);
    if (!existsSync(file)) return null;
    return { name, query: q.q, want: q.want, facts: q.want.map((w) => map[w]?.body), ...analyse(file, q, map) };
  }).filter(Boolean);
  return {
    runs: rows.length,
    recallWithQuery: rows.filter((r) => r.recallWithQuery).length,
    gotListOrHits: rows.filter((r) => r.gotListOrHits).length,
    recallWithIds: rows.filter((r) => r.recallWithIds).length,
    readRight: rows.filter((r) => r.readRight).length,
    rows,
  };
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (main) {
  const [cmd] = process.argv.slice(2);
  const tmp = process.env.E2E_TMP;
  const proofs = process.env.E2E_PROOFS;
  const root = process.env.E2E_PROJECTS;
  if (!['seed', 'run', 'count', 'list'].includes(cmd) || !proofs || (cmd !== 'list' && cmd !== 'count' && !tmp) || (cmd === 'run' && !root)) {
    console.log('Set E2E_PROOFS, E2E_TMP and E2E_PROJECTS, then give list, seed, run or count.');
    process.exit(cmd ? 1 : 0);
  }
  const mapFile = join(proofs, 'seeded-cards.json');
  if (cmd === 'list') for (const q of queries()) console.log(`${q.want.join(',')} | ${prompt(q)}`);
  if (cmd === 'seed') console.log(JSON.stringify(await seed(join(tmp, 'secrets.json'), mapFile)));
  if (cmd === 'run') {
    try {
      await run(paths(tmp, proofs), root);
    } catch (e) {
      console.log(e instanceof Error ? e.message : String(e));
    }
    console.log(`Spent ${spentSoFar(join(proofs, 'runs.jsonl')).toFixed(5)} dollars in this folder.`);
  }
  if (cmd === 'count') {
    const c = count(proofs, mapFile);
    writeFileSync(join(proofs, 'counts.json'), JSON.stringify(c, null, 1) + '\n');
    console.log(JSON.stringify({ ...c, rows: undefined }));
    for (const r of c.rows) console.log(JSON.stringify({ name: r.name, q: r.query, topicList: r.topicList, hits: r.hits, wantedInList: r.wantedInList, ids: r.idsAsked, askedRight: r.askedRight, readRight: r.readRight, calls: r.recallCalls, tokens: r.recallTokensEstimate, final: r.final.slice(0, 220) }));
  }
}
