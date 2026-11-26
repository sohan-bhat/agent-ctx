import { env } from 'cloudflare:workers';
import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import worker from '../src/index.ts';
import type { Person } from '../src/person.ts';
import { newItem } from '../../core/src/index.ts';
import { RESOURCE, connect, devSignIn, fromSomewhere, refresh, send, textOf, type Jar, type Tokens } from '../test/helpers.ts';

const vars = env as unknown as { LOAD_PEOPLE?: string; LOAD_PLANT?: string };
const PEOPLE = Number(vars.LOAD_PEOPLE ?? '1000');
const PLANT = vars.LOAD_PLANT === '1';
const IN_FLIGHT = 20;
const ROUNDS = 100;
const ROUND_MS = 1300;
const MARK = /mk\d+q/g;
const TOPICS = ['barcode scanner', 'expiry reminders', 'shopping list', 'shelf labels', 'recipe import', 'stock counts'];

type Kind = 'recall first' | 'recall query' | 'event prompt' | 'checkpoint' | 'handoff' | 'rule' | 'event edit' | 'event command' | 'event stop';
const MIX: [Kind, number][] = [
  ['recall first', 10],
  ['recall query', 25],
  ['event prompt', 25],
  ['checkpoint', 12],
  ['handoff', 4],
  ['rule', 2],
  ['event edit', 12],
  ['event command', 4],
  ['event stop', 6],
];
const READS = new Set<Kind>(['recall first', 'recall query', 'event prompt']);

interface Kv { reads: number; writes: number }
interface Agent { label: string; tokens: Tokens; token: string; kv: Kv; client: Client }
interface Op { kind: Kind; agent: number; project: number }
interface Who { n: number; mark: string; jar: Jar; agents: Agent[]; ops: Op[]; stub: DurableObjectStub<Person> }
interface Sample { ms: number; read: number; written: number; kvReads: number; kvWrites: number }

function rng(seed: number): (n: number) => number {
  let s = seed >>> 0 || 1;
  return (n) => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) % n;
  };
}

function countingKv(c: Kv): KVNamespace {
  const kv = env.OAUTH_KV;
  return new Proxy(kv, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        if (prop === 'get' || prop === 'getWithMetadata' || prop === 'list') c.reads++;
        if (prop === 'put' || prop === 'delete') c.writes++;
        return (v as (...x: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

function counted(c: Kv) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw = input instanceof URL ? input.href : input;
    const req = typeof raw === 'string' ? new Request(raw.startsWith('http') ? raw : `${new URL(RESOURCE).origin}${raw}`, init) : raw;
    req.headers.set('Host', new URL(RESOURCE).host);
    fromSomewhere(req);
    const ctx = createExecutionContext();
    const res = await worker.fetch(req as Request<unknown, IncomingRequestCfProperties>, { ...env, OAUTH_KV: countingKv(c) } as Env, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
}

async function pool<T>(items: T[], fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(IN_FLIGHT, items.length) }, async () => {
    while (next < items.length) {
      const x = items[next++];
      await fn(x);
    }
  });
  await Promise.all(lanes);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function foreign(text: string, own: string): string[] {
  return [...new Set(text.match(MARK) ?? [])].filter((m) => m !== own);
}

async function loadavg(label: string): Promise<{ label: string; load: number[]; freeMb: number }> {
  const r = (await (await fetch('https://load.invalid/loadavg')).json()) as { load: number[]; freeMb: number };
  return { label, load: r.load.map((x) => Math.round(x * 100) / 100), freeMb: r.freeMb };
}

function plan(n: number): Op[] {
  const r = rng(n * 7919 + 17);
  const ops: Op[] = MIX.flatMap(([kind, count]) => Array.from({ length: count }, () => ({ kind, agent: r(3), project: r(3) })));
  for (let i = ops.length - 1; i > 0; i--) {
    const j = r(i + 1);
    [ops[i], ops[j]] = [ops[j], ops[i]];
  }
  return ops;
}

async function agentFor(jar: Jar, kind: 'dcr' | 'claude-code', label: string): Promise<Agent> {
  const tokens = await connect(jar, kind, ['read', 'write'], kind === 'dcr' ? label : undefined);
  const a = { label, tokens, token: tokens.access, kv: { reads: 0, writes: 0 } } as Agent;
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), { fetch: counted(a.kv), authProvider: { token: async () => a.token } });
  a.client = new Client({ name: `load-${label}`, version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await a.client.connect(transport);
  return a;
}

function request(p: Who, i: number): { name: string; args: Record<string, unknown> } {
  const op = p.ops[i];
  const topic = TOPICS[(i + p.n) % TOPICS.length];
  const where = { repo: `https://github.com/p${p.n}/proj${op.project}`, folder: `/work/p${p.n}/proj${op.project}` };
  const hook = (event: string, more: Record<string, unknown>) => ({
    name: 'event',
    args: { host: op.agent === 1 ? 'claude-code' : 'codex', event, session: `s-${p.n}-${op.agent}-${op.project}`, cwd: where.folder, ...more },
  });
  switch (op.kind) {
    case 'recall first':
      return { name: 'recall', args: where };
    case 'recall query':
      return { name: 'recall', args: { ...where, query: `${topic} ${p.mark}` } };
    case 'event prompt':
      return hook('UserPromptSubmit', { prompt: `please work on the ${topic} for ${p.mark} step ${i}` });
    case 'checkpoint':
      return { name: 'checkpoint', args: { ...where, goal: `Finished the ${topic} part ${i} for ${p.mark}`, decisions: [`keep ${topic} simple for ${p.mark}`], open: [`test ${topic} ${p.mark}`], changed: [`src/${p.mark}/${i}.ts`] } };
    case 'handoff':
      return { name: 'handoff', args: { ...where, goal: `Ship the ${topic} for ${p.mark}`, next: `Wire the ${topic} step ${i} ${p.mark}`, files: [`src/${p.mark}/${i}.ts`] } };
    case 'rule':
      return { name: 'rule', args: { ...where, text: `Notes for ${p.mark}`, words: `please work on the ${topic} for ${p.mark}`, scope: 'project' } };
    case 'event edit':
      return hook('PostToolUse', { tool: 'Edit', file: `src/${p.mark}/${topic.replace(/ /g, '-')}-${i}.ts` });
    case 'event command':
      return hook('PostToolUseFailure', { tool: 'Bash', command: `npm test -- ${p.mark} ${i}` });
    case 'event stop':
      return hook('Stop', { message: `Done with the ${topic} step ${i} for ${p.mark}.` });
  }
}

it('1,000 people with 100 requests each never read another person and the sweep finds no foreign marker', async () => {
  const started = Date.now();
  const loads = [await loadavg('start')];
  const people: Who[] = [];
  const setupErrors: string[] = [];
  await pool(
    Array.from({ length: PEOPLE }, (_, n) => n),
    async (n) => {
      try {
        const jar = await devSignIn(`load-${n}`);
        const agents = [await agentFor(jar, 'dcr', 'Codex'), await agentFor(jar, 'claude-code', 'Claude Code'), await agentFor(jar, 'dcr', 'Cursor')];
        people.push({ n, mark: `mk${n}q`, jar, agents, ops: plan(n), stub: env.PERSON.getByName(`dev-load-${n}`) });
      } catch (e) {
        setupErrors.push(String(e instanceof Error ? e.message : e).slice(0, 120));
      }
    },
  );
  people.sort((a, b) => a.n - b.n);
  const setupMs = Date.now() - started;

  const samples = new Map<Kind, Sample[]>(MIX.map(([k]) => [k, []]));
  const errors = new Map<string, number>();
  const refusals = new Map<string, number>();
  const cross: string[] = [];
  const refreshes: Kv[] = [];
  let answers = 0;
  const runStarted = Date.now();
  for (let round = 0; round < ROUNDS; round++) {
    const t0 = Date.now();
    if (round === ROUNDS / 2) {
      loads.push(await loadavg('middle'));
      await pool(people, async (p) => {
        const a = p.agents[0];
        const c: Kv = { reads: 0, writes: 0 };
        a.tokens = await refresh(a.tokens, counted(c));
        a.token = a.tokens.access;
        refreshes.push(c);
      });
    }
    await pool(people, async (p) => {
      const op = p.ops[round];
      const a = p.agents[op.agent];
      const { name, args } = request(p, round);
      a.kv.reads = 0;
      a.kv.writes = 0;
      const t = performance.now();
      let text = '';
      let isError = false;
      try {
        const r = (await a.client.callTool({ name, arguments: args })) as { isError?: boolean };
        text = textOf(r);
        isError = !!r.isError;
      } catch (e) {
        const key = `${op.kind} ${String(e instanceof Error ? e.message : e).slice(0, 80)}`;
        errors.set(key, (errors.get(key) ?? 0) + 1);
        return;
      }
      const ms = performance.now() - t;
      const kv = { ...a.kv };
      const rows = await runInDurableObject(p.stub, (x: Person) => x.lastRows);
      answers++;
      samples.get(op.kind)!.push({ ms, read: rows.read, written: rows.written, kvReads: kv.reads, kvWrites: kv.writes });
      if (isError) refusals.set(`${op.kind} ${text}`, (refusals.get(`${op.kind} ${text}`) ?? 0) + 1);
      for (const m of foreign(text, p.mark)) cross.push(`${p.mark} read ${m} in ${op.kind}`);
    });
    const spent = Date.now() - t0;
    if (spent < ROUND_MS) await new Promise((r) => setTimeout(r, ROUND_MS - spent));
  }
  const runMs = Date.now() - runStarted;
  loads.push(await loadavg('end of run'));

  let planted = '';
  if (PLANT && people.length > 1) {
    const victim = people[0];
    const other = people[1];
    planted = `${victim.mark} holds ${other.mark}`;
    await runInDurableObject(victim.stub, (x: Person) => {
      x.store.put(newItem('card', `github.com/p${victim.n}/proj0`, { goal: `Planted note about ${other.mark}` }, { agent: 'Codex', via: 'tool', source: 'agent', at: Date.now() }));
    });
  }

  const sweep: string[] = [];
  const bytes: number[] = [];
  await pool(people, async (p) => {
    const headers = { Cookie: p.jar.header() };
    const space = await (await send('/api/space', { headers })).text();
    const zip = unzipSync(new Uint8Array(await (await send('/api/export', { headers })).arrayBuffer()));
    const exported = Object.values(zip)
      .map((v) => strFromU8(v))
      .join('\n');
    const me = (await (await send('/api/me', { headers })).json()) as { limits: { bytes: number } };
    bytes.push(me.limits.bytes);
    for (const m of new Set([...foreign(space, p.mark), ...foreign(exported, p.mark)])) sweep.push(`${p.mark} holds ${m}`);
  });
  loads.push(await loadavg('end'));

  const kinds: Record<string, unknown> = {};
  for (const [k, list] of samples) {
    kinds[k] = {
      n: list.length,
      msMedian: Math.round(median(list.map((s) => s.ms)) * 10) / 10,
      msP95: Math.round(p95(list.map((s) => s.ms)) * 10) / 10,
      rowsReadMedian: median(list.map((s) => s.read)),
      rowsWrittenMedian: median(list.map((s) => s.written)),
      rowsReadMean: Math.round(mean(list.map((s) => s.read)) * 10) / 10,
      rowsWrittenMean: Math.round(mean(list.map((s) => s.written)) * 10) / 10,
      kvReadsMedian: median(list.map((s) => s.kvReads)),
      kvWritesMedian: median(list.map((s) => s.kvWrites)),
      kvWritesMax: Math.max(0, ...list.map((s) => s.kvWrites)),
    };
  }
  const all = [...samples.entries()].flatMap(([k, l]) => l.map((s) => ({ k, s })));
  const reads = all.filter((x) => READS.has(x.k)).map((x) => x.s);
  const writes = all.filter((x) => !READS.has(x.k)).map((x) => x.s);
  const report = {
    people: people.length,
    setupErrors,
    requests: answers + [...errors.values()].reduce((a, b) => a + b, 0),
    answers,
    errors: Object.fromEntries(errors),
    refusals: Object.fromEntries(refusals),
    crossReads: cross.length,
    crossSample: cross.slice(0, 5),
    sweepForeign: sweep,
    planted,
    kinds,
    perRead: { rowsReadMean: Math.round(mean(reads.map((s) => s.read)) * 10) / 10, rowsWrittenMean: Math.round(mean(reads.map((s) => s.written)) * 10) / 10 },
    perWrite: { rowsReadMean: Math.round(mean(writes.map((s) => s.read)) * 10) / 10, rowsWrittenMean: Math.round(mean(writes.map((s) => s.written)) * 10) / 10 },
    kvPerCall: { readsMean: Math.round(mean(all.map((x) => x.s.kvReads)) * 100) / 100, writesMean: Math.round(mean(all.map((x) => x.s.kvWrites)) * 100) / 100 },
    kvPerRefresh: { readsMedian: median(refreshes.map((c) => c.reads)), writesMedian: median(refreshes.map((c) => c.writes)), writesMax: Math.max(0, ...refreshes.map((c) => c.writes)), n: refreshes.length },
    storedBytes: { median: median(bytes), largest: Math.max(0, ...bytes) },
    seconds: { setup: Math.round(setupMs / 1000), run: Math.round(runMs / 1000), total: Math.round((Date.now() - started) / 1000) },
    loads,
  };
  console.log(`LOAD ${JSON.stringify(report)}`);
  expect(setupErrors).toEqual([]);
  expect(answers).toBe(PEOPLE * ROUNDS);
  expect(cross).toEqual([]);
  expect(sweep).toEqual(PLANT ? [planted] : []);
});
