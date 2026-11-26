import { env } from 'cloudflare:workers';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { Hono } from 'hono';
import { api } from './api.ts';
import { auth, escape, html, who, type AppEnv } from './auth.ts';
import { mcpHandler } from './mcp.ts';
import { CLIENT_TTL, REGISTRATIONS_FULL, SLOW_DOWN, addressKey, limiterFor, registrationCap } from './open.ts';

export { Person } from './person.ts';
export { Registry } from './registry.ts';

const app = new Hono<AppEnv>();

app.route('/', auth);
app.route('/api', api);

app.get('/', async (c) => {
  const me = await who(c);
  const body = me
    ? `<h1>agent-ctx</h1><p>Signed in as ${escape(me.login)}.</p><p>Connect an agent to ${escape(c.env.MCP_RESOURCE)}</p><form method="post" action="/logout"><button>Sign out</button></form>`
    : '<h1>agent-ctx</h1><p><a href="/login">Sign in</a></p>';
  return html(body, 'agent-ctx');
});

app.notFound((c) => c.text('Not found.', 404));

const provider = new OAuthProvider<Env>({
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
  clientRegistrationTTL: CLIENT_TTL,
  clientRegistrationCallback: async () => {
    const day = new Date().toISOString().slice(0, 10);
    if (await env.REGISTRY.getByName('registrations').admit(day, registrationCap(env.REGISTRATIONS_PER_DAY))) return;
    return { code: 'temporarily_unavailable', description: REGISTRATIONS_FULL, status: 503 };
  },
});

export default {
  async fetch(request: Request, e: Env, ctx: ExecutionContext): Promise<Response> {
    const limiter = limiterFor(e, new URL(request.url).pathname);
    if (limiter) {
      const key = addressKey(request.headers.get('CF-Connecting-IP'));
      const { success } = await limiter.limit({ key });
      if (!success) return new Response(SLOW_DOWN, { status: 429, headers: { 'Retry-After': '60', 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return provider.fetch(request, e, ctx);
  },
} satisfies ExportedHandler<Env>;
