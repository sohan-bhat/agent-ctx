import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { strToU8, zipSync } from 'fflate';
import { projectName, type HandoffBody, type Item } from '../../core/src/index.ts';
import { serviceOrigin, who, type AppEnv, type Who } from './auth.ts';
import { TOOL_CHARS } from './mcp.ts';
import type { AgentRow } from './store.ts';

type ApiEnv = AppEnv & { Variables: { me: Who } };

export const api = new Hono<ApiEnv>();

function err(status: 400 | 401 | 403 | 404 | 409 | 426, error: string): Response {
  return Response.json({ error }, { status });
}

async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await req.json();
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function id(v: string | undefined): string | null {
  return v && v.length <= 100 ? v : null;
}

api.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const writes = c.req.method !== 'GET' && c.req.method !== 'HEAD';
  if ((writes || origin) && origin !== serviceOrigin(c.env)) return err(403, 'Requests must come from the agent-ctx page.');
  const me = await who(c);
  if (!me) return err(401, 'Sign in first.');
  c.set('me', me);
  await next();
});

const person = (c: { env: Env; get: (k: 'me') => Who }) => c.env.PERSON.getByName(c.get('me').person);

api.get('/me', async (c) => {
  const me = c.get('me');
  const l = await person(c).me();
  return c.json({ person: { id: me.person, login: me.login }, limits: { bytes: l.bytes, max: l.max, callsToday: l.callsToday, storedToday: l.storedToday }, toolChars: TOOL_CHARS });
});

api.get('/space', async (c) => c.json(await person(c).space()));

api.post('/items/:id/pin', async (c) => {
  const i = id(c.req.param('id'));
  const b = await body(c.req.raw);
  if (!i || !b || typeof b.on !== 'boolean') return err(400, 'Send on as true or false.');
  const item = await person(c).pin(i, b.on);
  return item ? c.json(item) : err(404, 'No such item.');
});

api.post('/items/:id/keep', async (c) => {
  const i = id(c.req.param('id'));
  const item = i ? await person(c).keep(i) : null;
  return item ? c.json(item) : err(404, 'No such item.');
});

api.post('/items/:id/putback', async (c) => {
  const i = id(c.req.param('id'));
  const item = i ? await person(c).putBack(i) : null;
  return item ? c.json(item) : err(404, 'No such item.');
});

api.delete('/items/:id', async (c) => {
  const i = id(c.req.param('id'));
  return i && (await person(c).remove(i)) ? new Response(null, { status: 204 }) : err(404, 'No such item.');
});

api.post('/rules', async (c) => {
  const b = await body(c.req.raw);
  if (!b || typeof b.text !== 'string' || (b.scope !== 'project' && b.scope !== 'all') || (b.project !== undefined && typeof b.project !== 'string')) return err(400, 'Send text, scope and an optional project.');
  const r = await person(c).addRule({ text: b.text, scope: b.scope, project: b.project as string | undefined });
  return r.ok && r.item ? c.json(r.item, 201) : err(400, r.text);
});

api.post('/rules/:id', async (c) => {
  const i = id(c.req.param('id'));
  const b = await body(c.req.raw);
  if (!i || !b || (b.status !== 'active' && b.status !== 'off') || (b.line !== undefined && typeof b.line !== 'string')) return err(400, 'Send status as active or off, and the line you saw.');
  const item = await person(c).setRule(i, b.status, b.line as string | undefined);
  if (item === 'changed') return err(409, 'This rule changed. Read the rule again before you accept.');
  return item ? c.json(item) : err(404, 'No such rule.');
});

api.post('/projects/merge', async (c) => {
  const b = await body(c.req.raw);
  if (!b || typeof b.from !== 'string' || typeof b.into !== 'string') return err(400, 'Send from and into.');
  return (await person(c).mergeProjects(b.from, b.into)) ? c.json({ ok: true }) : err(400, 'Both projects must exist and differ.');
});

api.get('/export', async (c) => {
  const zip = await person(c).exportAll();
  return new Response(zip, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="agent-ctx.zip"', 'Cache-Control': 'no-store' } });
});

async function revoke(oauth: OAuthHelpers, person: string, match: (label: unknown) => boolean): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(person, { cursor });
    for (const g of page.items) {
      if (!match((g.metadata as { label?: unknown } | undefined)?.label)) continue;
      await oauth.revokeGrant(g.id, person);
      n++;
    }
    cursor = page.cursor;
  } while (cursor);
  return n;
}

api.delete('/agents/:id', async (c) => {
  const label = id(c.req.param('id'));
  if (!label) return err(400, 'Send the agent to disconnect.');
  const revoked = await revoke(c.env.OAUTH_PROVIDER, c.get('me').person, (l) => l === label);
  const removed = await person(c).removeAgent(label);
  return revoked || removed ? new Response(null, { status: 204 }) : err(404, 'No such agent.');
});

api.delete('/account', async (c) => {
  const me = c.get('me');
  await revoke(c.env.OAUTH_PROVIDER, me.person, () => true);
  await person(c).wipe();
  deleteCookie(c, 'session', { path: '/', secure: true, prefix: 'host' });
  return c.json({ ok: true });
});

api.get('/live', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return err(426, 'Open this address as a WebSocket.');
  return person(c).fetch(c.req.raw);
});

const README = [
  'This folder is an export of one agent-ctx memory.',
  'Each folder under projects contains items.jsonl with one item per line and handoff.md with the newest handoff.',
  'The file rules.jsonl contains the rules and agents.jsonl contains the connected agents.',
].join('\n');

function folderOf(key: string, used: Set<string>): string {
  const base = (projectName(key) || 'project').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 60) || 'project';
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
  used.add(name);
  return name;
}

function lines(items: unknown[]): Uint8Array {
  return strToU8(items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''));
}

function handoffMarkdown(name: string, h: Item): string {
  const b = h.body as HandoffBody;
  const out = [`# Handoff for ${name}`, '', `Written by ${h.origin?.agent ?? 'an agent'} on ${new Date(h.created).toISOString().slice(0, 10)}.`];
  const part = (title: string, text?: string) => {
    if (text) out.push('', `## ${title}`, '', text);
  };
  const list = (title: string, xs?: string[]) => {
    if (xs?.length) out.push('', `## ${title}`, '', ...xs.map((x) => `- ${x}`));
  };
  part('Question', b.question);
  part('Goal', b.goal);
  part('Done', b.done);
  part('Next', b.next);
  list('Blockers', b.blockers);
  list('Files', b.files);
  part('Check', b.check);
  return out.join('\n') + '\n';
}

export function buildExport(o: { items: Item[]; projects: { key: string; name: string }[]; agents: AgentRow[] }): Uint8Array {
  const files: Record<string, Uint8Array> = { 'agent-ctx/README.md': strToU8(README + '\n') };
  const used = new Set<string>();
  const keys = [...new Set([...o.projects.map((p) => p.key), ...o.items.filter((i) => i.kind !== 'rule').map((i) => i.project)])];
  for (const key of keys) {
    const items = o.items.filter((i) => i.kind !== 'rule' && i.project === key);
    if (!items.length && !o.projects.some((p) => p.key === key)) continue;
    const folder = `agent-ctx/projects/${folderOf(key, used)}`;
    files[`${folder}/items.jsonl`] = lines(items);
    const handoff = items.filter((i) => i.kind === 'handoff').sort((a, b) => b.created - a.created)[0];
    if (handoff) files[`${folder}/handoff.md`] = strToU8(handoffMarkdown(projectName(key) || key, handoff));
  }
  files['agent-ctx/rules.jsonl'] = lines(o.items.filter((i) => i.kind === 'rule'));
  files['agent-ctx/agents.jsonl'] = lines(o.agents);
  return zipSync(files);
}
