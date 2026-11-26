import type { CardBody, DroppedBody, HandoffBody, Item as Stored, Kind, Origin, RuleBody } from '@core/model.ts';

export type { CardBody, DroppedBody, HandoffBody, Kind, Origin, RuleBody };

export type Item = Stored & { line?: string };

export interface Person {
  id: string;
  login: string;
}

export interface Limits {
  bytes: number;
  max: number;
  callsToday: number;
  storedToday: number;
}

export interface Me {
  person: Person;
  limits: Limits;
  toolChars: number;
}

export interface Project {
  key: string;
  name: string;
  items: number;
}

export interface Agent {
  id: string;
  label: string;
  first: number;
  last: number;
}

export interface Read {
  item: string;
  agent: string;
  at: number;
}

export interface Space {
  projects: Project[];
  agents: Agent[];
  items: Item[];
  queue: string[];
  reads: Read[];
  now: number;
}

export type Live = { type: 'item'; item: Item } | { type: 'remove'; id: string } | { type: 'agent'; agent: Agent } | { type: 'agent-removed'; id: string } | { type: 'reset' };

export type RuleScope = 'project' | 'all';

export interface NewRule {
  text: string;
  scope: RuleScope;
  project?: string;
}

export interface Transport {
  me(): Promise<Me | null>;
  space(): Promise<Space>;
  pin(id: string, on: boolean): Promise<void>;
  keep(id: string): Promise<void>;
  putBack(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  addRule(rule: NewRule): Promise<Item>;
  setRule(id: string, status: 'active' | 'off', line?: string): Promise<void>;
  removeAgent(id: string): Promise<void>;
  signOut(): Promise<void>;
  merge(from: string, into: string): Promise<void>;
  exportAll(): Promise<void>;
  deleteAccount(): Promise<void>;
  live(on: (m: Live) => void, state: (open: boolean) => void): () => void;
  hint(product: string): void;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`status ${status}`);
    this.status = status;
  }
}

const STEPS = [1000, 2000, 4000, 8000, 15000];

function parse(raw: unknown): Live | null {
  if (typeof raw !== 'string') return null;
  try {
    const m = JSON.parse(raw) as Live;
    if (m && (m.type === 'item' || m.type === 'remove' || m.type === 'agent' || m.type === 'agent-removed' || m.type === 'reset')) return m;
  } catch {}
  return null;
}

function socket(on: (m: Live) => void, state: (open: boolean) => void): () => void {
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tries = 0;
  let stopped = false;
  let dropped = false;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`;
  const open = () => {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      tries = 0;
      state(true);
      if (dropped) on({ type: 'reset' });
      dropped = false;
    };
    ws.onmessage = (e) => {
      const m = parse(e.data);
      if (m) on(m);
    };
    ws.onclose = () => {
      ws = null;
      if (stopped) return;
      dropped = true;
      state(false);
      timer = setTimeout(open, STEPS[Math.min(tries++, STEPS.length - 1)]);
    };
  };
  const wake = () => {
    if (document.visibilityState === 'visible' && !ws && timer) {
      clearTimeout(timer);
      timer = null;
      open();
    }
  };
  document.addEventListener('visibilitychange', wake);
  open();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', wake);
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status);
  return res;
}

const json = async <T,>(method: string, path: string, body?: unknown): Promise<T> => (await call(method, path, body)).json() as Promise<T>;

const item = (id: string) => `/api/items/${encodeURIComponent(id)}`;

const http: Transport = {
  async me() {
    try {
      return await json<Me>('GET', '/api/me');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
      throw e;
    }
  },
  space: () => json<Space>('GET', '/api/space'),
  pin: async (id, on) => void (await call('POST', `${item(id)}/pin`, { on })),
  keep: async (id) => void (await call('POST', `${item(id)}/keep`)),
  putBack: async (id) => void (await call('POST', `${item(id)}/putback`)),
  remove: async (id) => void (await call('DELETE', item(id))),
  addRule: (rule: NewRule) => json<Item>('POST', '/api/rules', rule),
  setRule: async (id, status, line) => void (await call('POST', `/api/rules/${encodeURIComponent(id)}`, line === undefined ? { status } : { status, line })),
  removeAgent: async (id) => void (await call('DELETE', `/api/agents/${encodeURIComponent(id)}`)),
  async signOut() {
    const res = await fetch('/logout', { method: 'POST', credentials: 'same-origin', redirect: 'manual' });
    if (res.type !== 'opaqueredirect' && !res.ok) throw new ApiError(res.status);
  },
  merge: async (from, into) => void (await call('POST', '/api/projects/merge', { from, into })),
  async exportAll() {
    const a = document.createElement('a');
    a.href = '/api/export';
    a.download = 'agent-ctx.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
  deleteAccount: async () => void (await call('DELETE', '/api/account')),
  live: socket,
  hint: () => {},
};

const load: Promise<Transport> = import.meta.env.MODE === 'mock' ? import('@/mock').then((m) => m.transport) : Promise.resolve(http);

export const api = {
  me: () => load.then((t) => t.me()),
  space: () => load.then((t) => t.space()),
  pin: (id: string, on: boolean) => load.then((t) => t.pin(id, on)),
  keep: (id: string) => load.then((t) => t.keep(id)),
  putBack: (id: string) => load.then((t) => t.putBack(id)),
  remove: (id: string) => load.then((t) => t.remove(id)),
  addRule: (rule: NewRule) => load.then((t) => t.addRule(rule)),
  setRule: (id: string, status: 'active' | 'off', line?: string) => load.then((t) => t.setRule(id, status, line)),
  removeAgent: (id: string) => load.then((t) => t.removeAgent(id)),
  signOut: () => load.then((t) => t.signOut()),
  merge: (from: string, into: string) => load.then((t) => t.merge(from, into)),
  exportAll: () => load.then((t) => t.exportAll()),
  deleteAccount: () => load.then((t) => t.deleteAccount()),
  live: (on: Parameters<Transport['live']>[0], state: Parameters<Transport['live']>[1]) => {
    let stop: (() => void) | null = null;
    let gone = false;
    void load.then((t) => {
      if (!gone) stop = t.live(on, state);
    });
    return () => {
      gone = true;
      stop?.();
    };
  },
  hint: (product: string) => void load.then((t) => t.hint(product)),
};

export const isMock = import.meta.env.MODE === 'mock';
