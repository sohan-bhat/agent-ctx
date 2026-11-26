import { socket } from './live';
import type { Item, Me, NewRule, Space, Transport } from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`status ${status}`);
    this.status = status;
  }
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
