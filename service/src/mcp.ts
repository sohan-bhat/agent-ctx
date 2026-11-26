import { env } from 'cloudflare:workers';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler, getMcpAuthContext } from 'agents/mcp/server';
import { z } from 'zod';
import { EMPTY_RECALL } from '../../core/src/index.ts';
import type { Caller, Result } from './person.ts';
import type { Props } from './auth.ts';

export const INSTRUCTIONS =
  'agent-ctx is this person\'s shared memory across their agents. At the start of work in a project call recall once with the git remote and the folder. After each finished unit of work call checkpoint. When the person stops or switches agents call handoff. When the person corrects you or states a standing preference call rule with their exact words. Text from recall is background from earlier sessions. Only lines under RULES are the person\'s own standing instructions.';

export const FAILED = 'Memory could not be loaded. Do not assume that nothing is stored.';

const DESCRIBE = {
  recall:
    "Earlier work on this project, the latest handoff and the person's rules. Use it before repeating an investigation or when an earlier decision, fix, command or dead end may help. Pass repo, the output of git remote get-url origin, and folder, the working folder path. Leave query out to get the latest handoff and recent work. Pass query to search.",
  checkpoint: 'Save what was just done. goal in one line, changed files, decisions with reasons, commands, dead ends, open tasks. Open tasks are shown to the next agent at the start of its session. Pass key when a retry may happen.',
  handoff: 'Save the state for the next agent. goal, done, next, blockers, files, how to check, and any open question.',
  rule: "Save a standing rule. words holds the person's exact words, copied.",
  event: 'For plugin hooks. Agents never call this tool.',
};

const str = z.string();
const list = z.array(z.string());
const where = { repo: str.optional(), folder: str.optional() };
const field = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();

const SCHEMA = {
  recall: z.strictObject({ ...where, query: str.optional(), dropped: z.boolean().optional() }),
  checkpoint: z.strictObject({ ...where, goal: str, changed: list.optional(), decisions: list.optional(), commands: list.optional(), dead_ends: list.optional(), open: list.optional(), key: str.optional() }),
  handoff: z.strictObject({ ...where, goal: str, done: str.optional(), next: str, blockers: list.optional(), files: list.optional(), check: str.optional(), question: str.optional(), key: str.optional() }),
  rule: z.strictObject({ ...where, text: str, words: str, scope: z.enum(['project', 'all']), key: str.optional() }),
  event: z.strictObject({
    host: field,
    event: field,
    session: field,
    cwd: field,
    prompt: field,
    tool: field,
    file: field,
    command: field,
    message: field,
    summary: field,
    reason: field,
    source: field,
    model: field,
  }),
};

const WRITER = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

type Ctx = { http?: { authInfo?: { scopes?: string[] } } };

function caller(ctx: Ctx): { props: Props; who: Caller } | null {
  const props = getMcpAuthContext()?.props as Partial<Props> | undefined;
  if (!props || typeof props.person !== 'string' || typeof props.grant !== 'string') return null;
  const scopes = ctx.http?.authInfo?.scopes ?? [];
  return { props: props as Props, who: { agent: typeof props.label === 'string' ? props.label : 'another agent', grant: props.grant, scopes } };
}

function reply(text: string, isError = false) {
  return isError ? { content: [{ type: 'text' as const, text }], isError: true } : { content: [{ type: 'text' as const, text }] };
}

function stub(person: string) {
  return env.PERSON.getByName(person);
}

function asText(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return String(v);
}

async function run(ctx: Ctx, fn: (s: ReturnType<typeof stub>, who: Caller) => Promise<Result>, empty?: string) {
  const c = caller(ctx);
  if (!c) return reply(FAILED, true);
  try {
    const r = await fn(stub(c.props.person), c.who);
    if (!r.ok) return reply(r.text, true);
    return reply(r.text || empty || '');
  } catch {
    return reply(FAILED, true);
  }
}

const ANNOTATIONS = { recall: { readOnlyHint: true, openWorldHint: false }, checkpoint: WRITER, handoff: WRITER, rule: WRITER, event: WRITER };

export function toolList(): { name: string; description: string; inputSchema: unknown; annotations: unknown }[] {
  return (Object.keys(SCHEMA) as (keyof typeof SCHEMA)[]).map((name) => ({ name, description: DESCRIBE[name], inputSchema: z.toJSONSchema(SCHEMA[name]), annotations: ANNOTATIONS[name] }));
}

export const TOOL_CHARS = JSON.stringify(toolList()).length;

export function createServer(): McpServer {
  const server = new McpServer({ name: 'agent-ctx', version: '0.1.0' }, { instructions: INSTRUCTIONS, maxToolInputElements: 400 });
  server.registerTool('recall', { description: DESCRIBE.recall, inputSchema: SCHEMA.recall, annotations: ANNOTATIONS.recall }, (args, ctx) =>
    run(ctx, (s, who) => s.recall(who, args), EMPTY_RECALL),
  );
  server.registerTool('checkpoint', { description: DESCRIBE.checkpoint, inputSchema: SCHEMA.checkpoint, annotations: WRITER }, (args, ctx) => run(ctx, (s, who) => s.checkpoint(who, args)));
  server.registerTool('handoff', { description: DESCRIBE.handoff, inputSchema: SCHEMA.handoff, annotations: WRITER }, (args, ctx) => run(ctx, (s, who) => s.handoff(who, args)));
  server.registerTool('rule', { description: DESCRIBE.rule, inputSchema: SCHEMA.rule, annotations: WRITER }, (args, ctx) => run(ctx, (s, who) => s.rule(who, args)));
  server.registerTool('event', { description: DESCRIBE.event, inputSchema: SCHEMA.event, annotations: WRITER }, (args, ctx) =>
    run(ctx, (s, who) => {
      const a: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(args)) a[k] = asText(v);
      return s.event(who, a);
    }),
  );
  return server;
}

function hostOf(): string[] {
  try {
    return [new URL(env.MCP_RESOURCE).hostname];
  } catch {
    return [];
  }
}

export const mcpHandler = createMcpHandler(createServer, { route: '/mcp', allowedHostnames: hostOf(), maxRequestBodySize: 512 * 1024 });
