import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import type { Store } from './core/paths.ts';
import { logError } from './core/fsx.ts';
import { DEFAULT_COUNT, MAX_COUNT, recentResult, searchResult, sessionResult, type FullResult, type ListResult } from './core/recall.ts';

const Brief = z.object({
  id: z.string(),
  title: z.string(),
  project: z.string(),
  folder: z.string(),
  branch: z.string().optional(),
  last: z.string(),
  summary: z.string(),
  asked: z.array(z.string()),
  files: z.array(z.string()),
});

const List = z.object({ sessions: z.array(Brief), note: z.string() });

const Full = z.object({
  session: z.object({
    id: z.string(),
    title: z.string(),
    project: z.string(),
    folder: z.string(),
    branch: z.string().optional(),
    first: z.string(),
    last: z.string(),
    prompts: z.number(),
    summaries: z.array(z.string()),
    asked: z.array(z.string()),
    files: z.array(z.string()),
    others: z.array(z.string()),
    dropped: z.number(),
  }),
  note: z.string(),
});

const folder = z.string().max(1000).optional().describe('Only sessions in this folder, given as a path or a project name');
const count = z.number().int().min(1).max(MAX_COUNT).optional().describe(`How many sessions to return, ${DEFAULT_COUNT} when left out and ${MAX_COUNT} at most`);
const hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function failed(st: Store, where: string, e: unknown) {
  logError(st.log, `mcp ${where}`, e);
  return { content: [{ type: 'text' as const, text: `Reading the claude-ctx store failed, and ${st.log} has the error.` }], isError: true };
}

function list(st: Store, where: string, run: () => ListResult) {
  try {
    const r = run();
    return { content: [{ type: 'text' as const, text: r.text }], structuredContent: r.data };
  } catch (e) {
    return failed(st, where, e);
  }
}

function full(st: Store, run: () => FullResult) {
  try {
    const r = run();
    if (!r.data) return { content: [{ type: 'text' as const, text: r.text }], isError: true };
    return { content: [{ type: 'text' as const, text: r.text }], structuredContent: r.data };
  } catch (e) {
    return failed(st, 'session', e);
  }
}

export function createServer(st: Store, version: string): McpServer {
  const server = new McpServer({ name: 'claude-ctx', version });
  server.registerTool(
    'search',
    {
      title: 'Search past sessions',
      description: 'Find past Claude Code sessions from every folder on this computer by words such as a feature, file, library or error, whenever the person mentions earlier work, another folder or a past decision.',
      inputSchema: z.object({ words: z.string().max(1000).describe('Words to look for, such as a feature, file, library or error'), folder, count }),
      outputSchema: List,
      annotations: hints,
    },
    async (a) => list(st, 'search', () => searchResult(st, a.words, a.folder, a.count ?? DEFAULT_COUNT)),
  );
  server.registerTool(
    'recent',
    {
      title: 'Newest sessions',
      description: 'List the newest past Claude Code sessions on this computer, in one folder or in all of them, whenever the person asks what was worked on lately.',
      inputSchema: z.object({ folder, count }),
      outputSchema: List,
      annotations: hints,
    },
    async (a) => list(st, 'recent', () => recentResult(st, a.folder, a.count ?? DEFAULT_COUNT)),
  );
  server.registerTool(
    'session',
    {
      title: 'One past session',
      description: 'Show one past session in full with its compaction summaries, prompts and changed files, given an id from search or recent.',
      inputSchema: z.object({ id: z.string().max(200).describe('The id of a session as search or recent show it') }),
      outputSchema: Full,
      annotations: hints,
    },
    async (a) => full(st, () => sessionResult(st, a.id)),
  );
  return server;
}

export function serveMcp(st: Store, version: string): void {
  serveStdio(() => createServer(st, version));
}
