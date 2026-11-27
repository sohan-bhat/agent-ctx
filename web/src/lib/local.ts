import { ApiError, type Item, type Me, type NewRule, type Space, type Transport } from '@/lib/api';

export interface Found {
  id: string;
  connected: boolean;
}

export interface Plan {
  connected: boolean;
  command: string | null;
  lines: string[];
  ready: boolean;
}

export const GONE = 'This page is no longer connected. Open the memory page again from a terminal.';

export const LABELS: Record<string, string> = { 'claude-code': 'Claude Code', cursor: 'Cursor', codex: 'Codex', gemini: 'Gemini CLI', antigravity: 'Antigravity', grok: 'Grok Build', muse: 'Muse Code', 'claude-desktop': 'Claude Desktop' };

export const labelOf = (name: string): string => (Object.hasOwn(LABELS, name) ? LABELS[name] : name);

const STEPS = [1000, 2000, 4000, 8000, 15000];

let key = '';

export function enter(): void {
  key = location.pathname.split('/')[1] ?? '';
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) link.href = link.href;
  history.replaceState(null, '', '/');
}

async function call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`/${key}/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status);
  return res;
}

const json = async <T,>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> => (await call(method, path, body, signal)).json() as Promise<T>;

const item = (id: string) => `/items/${encodeURIComponent(id)}`;
const agent = (id: string) => `/agents/${encodeURIComponent(id)}`;

export const found = (): Promise<Found[]> => json<{ agents: Found[] }>('GET', '/agents').then((r) => r.agents);
export const planFor = (id: string): Promise<Plan> => json<Plan>('GET', `${agent(id)}/plan`);
export const write = (id: string, on: boolean, lines: string[]): Promise<{ connected: boolean }> => json('POST', agent(id), { on, lines });

function named(space: Space): Space {
  return {
    ...space,
    agents: space.agents.map((a) => ({ ...a, label: labelOf(a.label) })),
    items: space.items.map((i) => ({ ...i, origin: { ...i.origin, agent: labelOf(i.origin.agent) } })),
    reads: space.reads.map((r) => ({ ...r, agent: labelOf(r.agent) })),
  };
}

export const transport: Transport = {
  me: () => json<Me>('GET', '/me'),
  space: () => json<Space>('GET', '/space').then(named),
  pin: async (id, on) => void (await call('POST', `${item(id)}/pin`, { on })),
  keep: async (id) => void (await call('POST', `${item(id)}/keep`)),
  putBack: async (id) => void (await call('POST', `${item(id)}/putback`)),
  remove: async (id) => void (await call('DELETE', item(id))),
  addRule: (rule: NewRule) => json<Item>('POST', '/rules', rule),
  setRule: async (id, status, line) => void (await call('POST', `/rules/${encodeURIComponent(id)}`, line === undefined ? { status } : { status, line })),
  removeAgent: async () => {},
  signOut: async () => {},
  merge: async (from, into) => void (await call('POST', '/projects/merge', { from, into })),
  async exportAll() {
    const a = document.createElement('a');
    a.href = `/${key}/api/export`;
    a.download = 'agent-ctx.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
  deleteAccount: async () => void (await call('DELETE', '/account')),
  live(on, state) {
    const gone = new AbortController();
    let seen = -1;
    let tries = 0;
    const watch = async () => {
      while (!gone.signal.aborted) {
        try {
          const { v } = await json<{ v: number }>('GET', `/live?v=${seen}`, undefined, gone.signal);
          state(true);
          if (seen >= 0 && v !== seen) on({ type: 'reset' });
          seen = v;
          tries = 0;
        } catch {
          if (gone.signal.aborted) return;
          state(false);
          await new Promise((r) => setTimeout(r, STEPS[Math.min(tries++, STEPS.length - 1)]));
        }
      }
    };
    void watch();
    return () => gone.abort();
  },
  hint: () => {},
};
