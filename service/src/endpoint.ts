import { env } from 'cloudflare:workers';
import { createRequestStateCodec, type RequestStateCodec } from '@modelcontextprotocol/server';
import { createMcpHandler, getMcpAuthContext } from 'agents/mcp/server';
import { version } from '../../package.json';
import type { Props } from './auth.ts';
import { BODY_MAX, createServer, type Reach } from './mcp.ts';

let codec: RequestStateCodec<string> | null = null;

function stateCodec(): RequestStateCodec<string> {
  codec ??= createRequestStateCodec<string>({
    key: `agent-ctx request state ${env.COOKIE_KEY ?? ''}`,
    ttlSeconds: 600,
    bind: () => {
      const props = getMcpAuthContext()?.props as Partial<Props> | undefined;
      return `${props?.person ?? ''}\u0000${props?.grant ?? ''}`;
    },
  });
  return codec;
}

const reach: Reach = {
  caller: (ctx) => {
    const props = getMcpAuthContext()?.props as Partial<Props> | undefined;
    if (!props || typeof props.person !== 'string' || typeof props.grant !== 'string') return null;
    const person = props.person;
    const scopes = ctx.http?.authInfo?.scopes ?? [];
    return { who: { agent: typeof props.label === 'string' ? props.label : 'another agent', grant: props.grant, scopes }, memory: () => env.PERSON.getByName(person) };
  },
  state: stateCodec,
};

function hostOf(): string[] {
  try {
    return [new URL(env.MCP_RESOURCE).hostname];
  } catch {
    return [];
  }
}

const handler = createMcpHandler(() => createServer(reach, version), { route: '/mcp', allowedHostnames: hostOf(), maxRequestBodySize: BODY_MAX });

async function bounded(request: Request): Promise<Request | null> {
  if (!request.body) return request;
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > BODY_MAX) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > BODY_MAX) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.byteLength;
  }
  return new Request(request, { body });
}

export async function mcpHandler(request: Request, e: Env, ctx: ExecutionContext): Promise<Response> {
  const fit = await bounded(request);
  if (!fit) return new Response('The request is too large.', { status: 413, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return handler(fit, e, ctx);
}
