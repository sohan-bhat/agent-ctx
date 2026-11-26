import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { serviceOrigin, who, type AppEnv, type Who } from './auth.ts';
import { TOOL_CHARS } from './mcp.ts';

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
  if (item === 'changed') return err(409, 'This rule changed. Look at the rule again before you accept it.');
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

api.delete('/account', async (c) => {
  const me = c.get('me');
  await person(c).wipe();
  const oauth = c.env.OAUTH_PROVIDER;
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(me.person, { cursor });
    for (const g of page.items) await oauth.revokeGrant(g.id, me.person);
    cursor = page.cursor;
  } while (cursor);
  deleteCookie(c, 'session', { path: '/', secure: true, prefix: 'host' });
  return c.json({ ok: true });
});

api.get('/live', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return err(426, 'Open this address as a WebSocket.');
  return person(c).fetch(c.req.raw);
});
