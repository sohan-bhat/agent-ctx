import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN } from './service.mjs';

const OWN = /^mcp__plugin_agent-ctx_agent-ctx__/;

async function query(sql) {
  const r = await fetch(`${ORIGIN}/cdn-cgi/local/explorer/api/local/observability/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) });
  const j = await r.json();
  if (!j.success) throw new Error(`The trace query failed. ${JSON.stringify(j.errors)}`);
  const cols = j.result.columns;
  return j.result.rows.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const at = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, at)];
}

function transcript(proofs, name) {
  const file = join(proofs, `${name}.jsonl`);
  const out = { own: 0, hooks: 0, errors: [] };
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'tool_use' && OWN.test(c.name)) out.own++;
    if (e.type === 'system' && e.subtype === 'hook_response' && e.outcome !== 'success') out.errors.push(`${e.hook_name} ${String(e.stderr || e.output || '').slice(0, 120)}`);
  }
  const debug = join(proofs, `${name}.debug.log`);
  if (existsSync(debug)) out.hooks = readFileSync(debug, 'utf8').split('\n').filter((l) => l.includes('Hooks: mcp_tool calling')).length;
  return out;
}

export async function latency(proofs) {
  const runs = readFileSync(join(proofs, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.side !== 'none');
  const per = [];
  const clean = [];
  for (const r of runs) {
    const spans = await query(
      `SELECT s.trace_id AS trace, s.duration_ms AS ms, s.outcome AS outcome, json_extract(s.attributes, '$."http.response.status_code"') AS status, (SELECT COUNT(*) FROM spans c WHERE c.trace_id = s.trace_id AND c.name = 'durable_object_subrequest') AS dobj FROM spans s WHERE s.parent_id IS NULL AND s.name = 'POST' AND json_extract(s.attributes, '$."url.full"') = '${ORIGIN}/mcp' AND s.start_ms BETWEEN ${r.start} AND ${r.end + 2000} ORDER BY s.start_ms`,
    );
    const calls = spans.filter((s) => s.dobj > 0);
    const t = transcript(proofs, r.name);
    const bad = spans.filter((s) => s.outcome !== 'ok' || Number(s.status) >= 400).length;
    const row = { name: r.name, posts: spans.length, toolCalls: calls.length, modelCalls: t.own, hookCallsSeenByClient: t.hooks, serverErrors: bad, clientHookErrors: t.errors };
    per.push(row);
    if (t.own === 0 && calls.length === t.hooks) clean.push(...calls.map((s) => s.ms));
  }
  const sorted = [...clean].sort((a, b) => a - b);
  return {
    note: 'A hook call is a POST to /mcp whose trace reaches the person object. Latency uses only runs where the model called no agent-ctx tool and the count of such posts equals the hook calls in the client debug log.',
    hookCalls: sorted.length,
    medianMs: pct(sorted, 50),
    p95Ms: pct(sorted, 95),
    maxMs: sorted.at(-1) ?? null,
    serverErrors: per.reduce((n, r) => n + r.serverErrors, 0),
    clientHookErrors: per.reduce((n, r) => n + r.clientHookErrors.length, 0),
    runs: per,
  };
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (main) {
  const proofs = process.argv[2];
  if (!proofs) {
    console.log('Give the proofs folder that holds runs.jsonl, as in node test-e2e/latency.mjs proofs/continue-1');
    process.exit(0);
  }
  const out = await latency(proofs);
  writeFileSync(join(proofs, 'latency.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ ...out, runs: undefined }, null, 1));
  for (const r of out.runs) console.log(JSON.stringify(r));
}
