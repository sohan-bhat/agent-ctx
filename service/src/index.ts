import { env } from 'cloudflare:workers';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { Hono } from 'hono';
import { auth, escape, who, type AppEnv } from './auth.ts';
import { mcpHandler } from './mcp.ts';

export { Person } from './person.ts';

const app = new Hono<AppEnv>();

app.route('/', auth);

app.get('/', async (c) => {
  const me = await who(c);
  const body = me
    ? `<h1>agent-ctx</h1><p>Signed in as ${escape(me.login)}.</p><p>Connect an agent to ${escape(c.env.MCP_RESOURCE)}</p><p><a href="/logout">Sign out</a></p>`
    : '<h1>agent-ctx</h1><p><a href="/login">Sign in</a></p>';
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>agent-ctx</title></head><body>${body}</body></html>`);
});

app.notFound((c) => c.text('Not found.', 404));

export default new OAuthProvider<Env>({
  apiRoute: '/mcp',
  apiHandler: { fetch: (request: Request, e: Env, ctx: ExecutionContext) => mcpHandler(request, e, ctx) },
  defaultHandler: { fetch: (request: Request, e: Env, ctx: ExecutionContext) => app.fetch(request, e, ctx) },
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  clientRegistrationEndpoint: '/oauth/register',
  scopesSupported: ['read', 'write'],
  requiredScopes: ['read', 'write'],
  resourceMetadata: { resource: env.MCP_RESOURCE, resource_name: 'agent-ctx' },
  clientIdMetadataDocumentEnabled: true,
  accessTokenTTL: 86400,
  refreshTokenIdleTTL: 30 * 86400,
});
