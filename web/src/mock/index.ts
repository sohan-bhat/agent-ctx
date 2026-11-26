import { itemBytes } from '@core/model.ts';
import type { Agent, Item, Live, Me, NewRule, RuleBody, Space, Transport } from '@/lib/types';
import { liveCard, PROJECTS, ruleItem, seed, type World } from './data';

const KEY = 'agent-ctx-mock';
const EVERY = 7000;

function flag(name: string): string | null {
  try {
    return localStorage.getItem(`${KEY}-${name}`);
  } catch {
    return null;
  }
}

export function signedIn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'in';
  } catch {
    return false;
  }
}

export function signIn(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, 'in');
    else localStorage.removeItem(KEY);
  } catch {}
}

let world: World | null = null;
const listeners = new Set<(m: Live) => void>();

function state(): World {
  if (!world) world = flag('empty') === '1' ? { agents: [], items: [], queue: [], reads: [] } : seed(Date.now());
  return world;
}

const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const send = (m: Live) => listeners.forEach((f) => f(m));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function find(id: string): Item {
  const it = state().items.find((i) => i.id === id);
  if (!it) throw new Error('not found');
  return it;
}

function touch(it: Item): void {
  send({ type: 'item', item: clone(it) });
}

let pulse: ReturnType<typeof setInterval> | null = null;

function startPulse(): void {
  if (pulse || flag('quiet') === '1') return;
  pulse = setInterval(() => {
    const w = state();
    if (!w.agents.length) return;
    const it = liveCard(Date.now(), w.agents);
    w.items.push(it);
    send({ type: 'item', item: clone(it) });
    const a = w.agents.find((x) => x.label === it.origin.agent);
    if (a) {
      a.last = it.created;
      send({ type: 'agent', agent: { ...a } });
    }
  }, Number(flag('every') ?? EVERY));
}

export const transport: Transport = {
  async me(): Promise<Me | null> {
    await wait();
    if (!signedIn()) return null;
    const bytes = state().items.reduce((a, i) => a + itemBytes(i), 0);
    return { person: { id: 'gh:4127703', login: 'kelp-dev' }, limits: { bytes, max: 10 * 1024 * 1024, callsToday: 212, storedToday: 37 }, toolChars: 2148 };
  },
  async space(): Promise<Space> {
    await wait(120);
    if (flag('fail') === 'space') throw new Error('offline');
    const w = state();
    const projects = PROJECTS.map((p) => ({ ...p, items: w.items.filter((i) => i.project === p.key).length })).filter((p) => p.items > 0);
    return clone({ projects, agents: w.agents, items: w.items, queue: w.queue, reads: w.reads, now: Date.now() });
  },
  async pin(id, on) {
    await wait();
    const it = find(id);
    it.pinned = on;
    touch(it);
  },
  async keep(id) {
    await wait();
    const it = find(id);
    it.held = false;
    touch(it);
  },
  async putBack(id) {
    await wait();
    find(id);
    if (!state().queue.includes(id)) state().queue.push(id);
  },
  async remove(id) {
    await wait();
    const w = state();
    w.items = w.items.filter((i) => i.id !== id);
    w.queue = w.queue.filter((q) => q !== id);
    w.reads = w.reads.filter((x) => x.item !== id);
    send({ type: 'remove', id });
  },
  async addRule(rule: NewRule) {
    await wait();
    const project = rule.project ?? PROJECTS[0].key;
    const it = ruleItem(rule.text, rule.scope, project, Date.now());
    state().items.push(it);
    touch(it);
    return clone(it);
  },
  async setRule(id, status) {
    await wait();
    const it = find(id);
    const b = it.body as RuleBody;
    it.body = { ...b, status, proof: b.proof ?? 'page' };
    touch(it);
  },
  async merge(from, into) {
    await wait();
    for (const it of state().items) if (it.project === from) it.project = into;
    send({ type: 'reset' });
  },
  async exportAll() {
    const lines = state()
      .items.map((i) => JSON.stringify(i))
      .join('\n');
    const url = URL.createObjectURL(new Blob([lines], { type: 'application/x-ndjson' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agent-ctx.jsonl';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async deleteAccount() {
    await wait();
    world = { agents: [], items: [], queue: [], reads: [] };
    signIn(false);
  },
  live(on, open) {
    listeners.add(on);
    setTimeout(() => open(true), 30);
    startPulse();
    return () => {
      listeners.delete(on);
      if (!listeners.size && pulse) {
        clearInterval(pulse);
        pulse = null;
      }
    };
  },
  hint(product) {
    const w = state();
    if (w.agents.some((a) => a.label === product)) return;
    setTimeout(() => {
      if (w.agents.some((a) => a.label === product)) return;
      const now = Date.now();
      const agent: Agent = { id: `agent-${w.agents.length + 1}`, label: product, first: now, last: now };
      w.agents.push(agent);
      send({ type: 'agent', agent: { ...agent } });
    }, Number(flag('connect') ?? 2500));
  },
};
