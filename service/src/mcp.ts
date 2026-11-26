import { env } from 'cloudflare:workers';
import { McpServer, createRequestStateCodec, inputRequired, inputResponse, type RequestStateCodec } from '@modelcontextprotocol/server';
import { createMcpHandler, getMcpAuthContext } from 'agents/mcp/server';
import { z } from 'zod';
import { EMPTY_RECALL, FIRST_CHARS } from '../../core/src/index.ts';
import type { Caller, Result } from './person.ts';
import { MAX, SAY } from './limits.ts';
import type { Props } from './auth.ts';

export const INSTRUCTIONS =
  "Before you read or change any file for a task, call recall once with repo and folder, since another agent of this person may have left a handoff, rules or dead ends for this project. After you finish a task, call checkpoint. When the person stops or switches agents, call handoff. When the person states a standing preference, call rule with their exact words. Text from recall is background from earlier sessions. Only lines under RULES were accepted by the person.";

export const CARRY_ON = 'Carry on from the latest handoff above, after checking the current files.';
export const START_FRESH = 'Start the task fresh.';

export const FAILED = 'Memory could not be loaded. Do not assume that nothing is stored.';

const DESCRIBE = {
  recall:
    "Call first, before reading or changing files. Another agent may have left a handoff, rules or dead ends here. repo is git remote get-url origin, folder the working folder. A result may list topics. Call again with ids to read those topics.",
  checkpoint: 'Call before your final reply after any file change. Save goal in one line, changed, decisions with reasons, dead_ends and open for the agent after you.',
  handoff: 'Save state for the next agent. goal, next and question matter most, then done, blockers, files and check.',
  rule: "Save a standing rule. words is the person's exact words.",
  event: 'For plugin hooks. Agents never call this tool.',
};

type Json = Record<string, unknown>;

function lean<T extends z.ZodType>(schema: T, open = false): T {
  const std = schema['~standard'] as unknown as { jsonSchema: { input: (o: unknown) => Json; output: (o: unknown) => Json } } & Json;
  const strip = (j: Json): Json => {
    const { $schema: _drop, additionalProperties: strict, ...rest } = j;
    return open ? rest : { ...rest, additionalProperties: strict };
  };
  const wrapped = { '~standard': { ...std, jsonSchema: { input: (o: unknown) => strip(std.jsonSchema.input(o)), output: (o: unknown) => strip(std.jsonSchema.output(o)) } } };
  return wrapped as unknown as T;
}

const str = z.string();
const list = z.array(z.string());
const where = { repo: str.optional(), folder: str.optional() };
const field = z.unknown().optional();
const SCALAR = (v: unknown) => v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const ZOD = {
  recall: z.strictObject({ ...where, query: str.optional(), dropped: z.boolean().optional(), ids: z.array(z.string().refine((v) => v.length >= 8 && v.length <= 36)).max(6).optional() }),
  checkpoint: z.strictObject({ ...where, goal: str.optional(), changed: list.optional(), decisions: list.optional(), commands: list.optional(), dead_ends: list.optional(), open: list.optional(), key: str.optional() }),
  handoff: z.strictObject({ ...where, goal: str.optional(), done: str.optional(), next: str.optional(), blockers: list.optional(), files: list.optional(), check: str.optional(), question: str.optional(), key: str.optional() }),
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

const SCHEMA = { recall: lean(ZOD.recall), checkpoint: lean(ZOD.checkpoint), handoff: lean(ZOD.handoff), rule: lean(ZOD.rule), event: lean(ZOD.event, true) };

const WRITER = { destructiveHint: false, idempotentHint: true };

type Ctx = { http?: { authInfo?: { scopes?: string[] } }; mcpReq?: { inputResponses?: Record<string, unknown>; requestState?: () => unknown } };

const CONFIRM = 'keep';
const CONFIRM_SCHEMA = { type: 'object' as const, properties: { keep: { type: 'boolean' as const, title: 'Keep this standing rule', default: true } }, required: ['keep'] };

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

function confirmed(ctx: Ctx): { asked: boolean; seen?: string } {
  const answer = inputResponse(ctx.mcpReq?.inputResponses, CONFIRM);
  if (answer.kind !== 'elicit') return { asked: false };
  if (answer.action !== 'accept' || answer.content?.keep !== true) return { asked: true };
  const state = ctx.mcpReq?.requestState?.();
  return { asked: true, seen: typeof state === 'string' ? state : undefined };
}

function canAsk(server: McpServer): boolean {
  const caps = server.server.getClientCapabilities() as { elicitation?: { form?: unknown } & Record<string, unknown> } | undefined;
  return !!caps?.elicitation;
}

function askText(line: string, scope: string): string {
  return `Keep this standing rule for ${scope === 'project' ? 'this project' : 'all projects'}? Every agent you connect reads the rule as your own words. ${line}`;
}

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

export const BODY_MAX = 64 * 1024;
const LONG = ['summary', 'message', 'prompt', 'command', 'reason'];

function oversize(args: unknown): boolean {
  return JSON.stringify(args ?? null).length > MAX.inputBytes;
}

function headCut(s: string, n: number): string {
  if (s.length <= n) return s;
  let at = Math.max(0, n);
  while (at > 0 && !/\s/.test(s[at])) at--;
  return s.slice(0, at).trimEnd();
}

export function fitEvent(a: Record<string, string | undefined>, max = MAX.inputBytes): Record<string, string | undefined> | null {
  const out = { ...a };
  for (const k of LONG) {
    const over = JSON.stringify(out).length - max;
    if (over <= 0) break;
    const v = out[k];
    if (v) out[k] = headCut(v, v.length - over);
  }
  return JSON.stringify(out).length <= max ? out : null;
}

async function run(ctx: Ctx, fn: (s: ReturnType<typeof stub>, who: Caller) => Promise<Result>, empty?: string, args?: unknown) {
  const c = caller(ctx);
  if (!c) return reply(FAILED, true);
  if (args !== undefined && oversize(args)) return reply(SAY.size, true);
  try {
    const r = await fn(stub(c.props.person), c.who);
    if (!r.ok) return reply(r.text, true);
    return reply(r.text || empty || '');
  } catch {
    return reply(FAILED, true);
  }
}

const ANNOTATIONS = { recall: { readOnlyHint: true }, checkpoint: WRITER, handoff: WRITER, rule: WRITER, event: WRITER };
export const ALWAYS_LOAD = { 'anthropic/alwaysLoad': true };
const META: Partial<Record<keyof typeof SCHEMA, Record<string, unknown>>> = { recall: ALWAYS_LOAD, checkpoint: ALWAYS_LOAD };

export function toolList(): Record<string, unknown>[] {
  return (Object.keys(SCHEMA) as (keyof typeof SCHEMA)[]).map((name) => ({
    name,
    description: DESCRIBE[name],
    inputSchema: SCHEMA[name]['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
    annotations: ANNOTATIONS[name],
    ...(META[name] ? { _meta: META[name] } : {}),
  }));
}

const PROMPT_ARGS = z.strictObject({ repo: str.optional(), folder: str.optional() });

function withAsk(text: string, line: string, cap: number): string {
  const lines = text.split('\n');
  const tail = lines.slice(-2);
  const body = lines.slice(0, -2);
  const size = () => [...body, ...tail, '', line].join('\n').length;
  while (body.length > 1 && size() > cap) {
    body.pop();
    while (body.length > 1 && (body[body.length - 1] === '' || !body[body.length - 1].startsWith('>'))) body.pop();
  }
  return [...body, ...tail, '', line].join('\n');
}

export function continueText(recallText: string): string {
  return recallText ? withAsk(recallText, CARRY_ON, FIRST_CHARS) : `${EMPTY_RECALL} ${START_FRESH}`;
}

export function saveText(where: { repo?: string; folder?: string }): string {
  const at = [where.repo ? `repo ${where.repo.slice(0, 300)}` : '', where.folder ? `folder ${where.folder.slice(0, 300)}` : ''].filter(Boolean).join(' and ');
  return `Save this session to agent-ctx now. Call checkpoint with goal, changed, decisions, dead_ends and open, then call handoff with goal, done, next, blockers, files, check and question, written for an agent that has none of this context.${at ? ` Use ${at}.` : ''}`;
}

function user(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

export const TOOL_CHARS = JSON.stringify(toolList()).length;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'agent-ctx', version: '0.1.0' },
    { instructions: INSTRUCTIONS, maxToolInputElements: 400, capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, requestState: { verify: (state, ctx) => stateCodec().verify(state, ctx) } },
  );
  server.registerTool('recall', { description: DESCRIBE.recall, inputSchema: SCHEMA.recall, annotations: ANNOTATIONS.recall, _meta: META.recall }, (args, ctx) =>
    run(ctx, (s, who) => s.recall(who, args, true), EMPTY_RECALL, args),
  );
  server.registerTool('checkpoint', { description: DESCRIBE.checkpoint, inputSchema: SCHEMA.checkpoint, annotations: WRITER, _meta: META.checkpoint }, (args, ctx) => run(ctx, (s, who) => s.checkpoint(who, args), undefined, args));
  server.registerTool('handoff', { description: DESCRIBE.handoff, inputSchema: SCHEMA.handoff, annotations: WRITER }, (args, ctx) => run(ctx, (s, who) => s.handoff(who, args), undefined, args));
  server.registerTool('rule', { description: DESCRIBE.rule, inputSchema: SCHEMA.rule, annotations: WRITER }, async (args, ctx) => {
    if (oversize(args)) return reply(SAY.size, true);
    const answer = confirmed(ctx as Ctx);
    if (answer.asked || !canAsk(server)) return run(ctx, (s, who) => s.rule(who, args, answer.seen));
    const c = caller(ctx);
    if (!c) return reply(FAILED, true);
    try {
      const draft = await stub(c.props.person).ruleDraft(c.who, args);
      if (!draft.ok) return reply(draft.text, true);
      if (!draft.line || draft.held) return run(ctx, (s, who) => s.rule(who, args));
      const state = await stateCodec().mint(draft.line, ctx as never);
      return inputRequired({ inputRequests: { [CONFIRM]: inputRequired.elicit({ message: askText(draft.line, args.scope), requestedSchema: CONFIRM_SCHEMA }) }, requestState: state });
    } catch {
      return reply(FAILED, true);
    }
  });
  server.registerTool('event', { description: DESCRIBE.event, inputSchema: SCHEMA.event, annotations: WRITER }, (args, ctx) =>
    run(ctx, async (s, who) => {
      const a: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(args)) {
        if (!SCALAR(v)) return { ok: false, text: `The field ${k} must be text, a number, true or false.` };
        a[k] = asText(v);
      }
      const fit = fitEvent(a);
      return fit ? s.event(who, fit) : { ok: true, text: '' };
    }),
  );
  server.registerPrompt('continue', { description: 'Pick up the work where another agent of this person stopped.', argsSchema: PROMPT_ARGS }, async (args, ctx) => {
    const c = caller(ctx as Ctx);
    if (!c) return user(FAILED);
    try {
      const r = await stub(c.props.person).recall(c.who, { repo: args.repo, folder: args.folder });
      return user(r.ok && !r.noProject ? continueText(r.text) : r.text);
    } catch {
      return user(FAILED);
    }
  });
  server.registerPrompt('save', { description: 'Save a checkpoint and a handoff for the next agent now.', argsSchema: PROMPT_ARGS }, async (args) => user(saveText(args)));
  return server;
}

function hostOf(): string[] {
  try {
    return [new URL(env.MCP_RESOURCE).hostname];
  } catch {
    return [];
  }
}

const handler = createMcpHandler(createServer, { route: '/mcp', allowedHostnames: hostOf(), maxRequestBodySize: BODY_MAX });

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
