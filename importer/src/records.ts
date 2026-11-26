export type Rec = Record<string, any>;

export const UNDERSTOOD = new Set([
  'user',
  'assistant',
  'system',
  'attachment',
  'ai-title',
  'custom-title',
  'summary',
  'last-prompt',
  'api-request-shape',
]);

export function parseLine(text: string): Rec | null {
  if (!text || text.charCodeAt(0) !== 123) return null;
  try {
    const r = JSON.parse(text);
    return r && typeof r === 'object' && !Array.isArray(r) ? (r as Rec) : null;
  } catch {
    return null;
  }
}

export function contentBlocks(r: Rec): any[] {
  const c = r?.message?.content;
  if (Array.isArray(c)) return c;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return [];
}

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const out: string[] = [];
  for (const b of content) {
    if (typeof b === 'string') out.push(b);
    else if (b && typeof b === 'object') {
      if (typeof b.text === 'string') out.push(b.text);
      else if (b.type === 'tool_result') out.push(textOf(b.content));
    }
  }
  return out.join('\n');
}

const HUMAN_SOURCES = new Set(['typed', 'queued', 'suggestion_accepted', 'sdk']);

export function promptText(r: Rec): string | null {
  if (r.type !== 'user' || r.isMeta || r.isCompactSummary || r.isSidechain) return null;
  const c = r.message?.content;
  let text: string;
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    if (c.some((b: any) => b && b.type === 'tool_result')) return null;
    text = c
      .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n');
  } else return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^<[a-z][a-z0-9-]*>/.test(trimmed)) return null;
  const kind = r.origin?.kind;
  const src = r.promptSource;
  const human = kind === 'human' || (src && HUMAN_SOURCES.has(src));
  if (!human) {
    if (kind || src) return null;
    if (/^\[Request interrupted/i.test(trimmed)) return null;
  }
  const clean = trimmed.replace(/\[Image #\d+\]/g, '').replace(/\s+/g, ' ').trim();
  return clean || null;
}

export function isToolResultLine(text: string): boolean {
  return text.includes('"sourceToolAssistantUUID"') && !text.includes('"isCompactSummary":true');
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export function mayHaveEdit(text: string): boolean {
  return (
    text.includes('"name":"Edit"') ||
    text.includes('"name":"Write"') ||
    text.includes('"name":"MultiEdit"') ||
    text.includes('"name":"NotebookEdit"')
  );
}

export function editPaths(r: Rec): string[] {
  if (r.type !== 'assistant') return [];
  const out: string[] = [];
  for (const b of contentBlocks(r)) {
    if (!b || b.type !== 'tool_use' || !EDIT_TOOLS.has(b.name)) continue;
    const p = b.input?.file_path ?? b.input?.notebook_path;
    if (typeof p === 'string' && p.startsWith('/')) out.push(p);
  }
  return out;
}

export interface Usage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
}

export function usageOf(r: Rec): Usage | null {
  const u = r?.message?.usage;
  if (!u || typeof u !== 'object') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  if (typeof u.input_tokens !== 'number') return null;
  const input = n(u.input_tokens);
  const cacheRead = n(u.cache_read_input_tokens);
  const cacheWrite = n(u.cache_creation_input_tokens);
  return { input, cacheRead, cacheWrite, output: n(u.output_tokens), total: input + cacheRead + cacheWrite };
}

export function isCompactBoundary(r: Rec): boolean {
  return r.type === 'system' && r.subtype === 'compact_boundary';
}

export function compactSummaryText(r: Rec): string | null {
  if (r.type !== 'user' || !r.isCompactSummary) return null;
  const t = textOf(r.message?.content);
  return t || null;
}

const HARNESS_BLOCK = /<([a-z][a-z0-9]*(?:[-_][a-z0-9]+)+)(?:\s[^<>]*)?>[\s\S]*?<\/\1\s*>/gi;
const HARNESS_OPEN = /<\/?[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+(?:\s[^<>]*)?\/?>[^\n]*/gi;
const ANY_TAG = /<\/?[a-zA-Z][^<>\n]{0,200}>/g;
const HEADINGS = /(?:^|\s)(?:\d{1,2}\.\s*)?(Primary Request and Intent|Key Technical Concepts|Files and Code Sections|Errors and Fixes|Problem Solving|All User Messages|Pending Tasks|Current Work|Optional Next Step|Summary|Analysis)\s*:/gi;
const BOILER = /continued from a previous conversation|summary below covers|conversation is summarized below|read the full transcript at|please continue the conversation|continue with the last task|called the \w+ tool|result of calling the \w+ tool|tools used/i;
const PIECES = /(?<=[.!?])(?=\s)|(?<=\n)/;

export function stripMarkup(text: string): string {
  let s = text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\([<>])/g, '$1');
  s = s.replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, ' ');
  const m = s.match(/<summary>([\s\S]*?)(?:<\/summary>|$)/i);
  if (m) s = m[1];
  s = s.replace(HARNESS_BLOCK, ' ').replace(HARNESS_OPEN, ' ').replace(ANY_TAG, ' ');
  return s
    .split(PIECES)
    .filter((p) => !BOILER.test(p))
    .join('');
}

function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-*•:;,.]+/, '')
    .replace(/(?:\s[-*•])+\s*$/, '')
    .trim();
}

export function cleanSummary(raw: string): string {
  const s = stripMarkup(raw);
  const parts: { head: string; at: number; body: number }[] = [];
  for (const m of s.matchAll(HEADINGS)) parts.push({ head: m[1].toLowerCase(), at: m.index ?? 0, body: (m.index ?? 0) + m[0].length });
  if (!parts.length) return tidy(s);
  const section = (name: string) => {
    const i = parts.findIndex((p) => p.head === name);
    return i < 0 ? '' : tidy(s.slice(parts[i].body, i + 1 < parts.length ? parts[i + 1].at : s.length));
  };
  const lead = tidy(s.slice(0, parts[0].at));
  const first = section('primary request and intent') || lead || section('summary');
  const now = section('current work');
  return [first, now].filter(Boolean).join(' ').trim();
}

export function summaryLine(text: string, max = 160): string {
  const s = cleanSummary(text);
  if (!s) return '';
  const end = s.slice(30, max + 1).search(/[.!?](?:\s|$)/);
  return end >= 0 ? s.slice(0, 30 + end + 1) : cut(s, max);
}

export function titleOf(r: Rec): { ai?: string; custom?: string } | null {
  if (r.type === 'ai-title' && typeof r.aiTitle === 'string') return { ai: r.aiTitle };
  if (r.type === 'custom-title' && typeof r.customTitle === 'string') return { custom: r.customTitle };
  if (r.type === 'summary' && typeof r.summary === 'string') return { ai: r.summary };
  return null;
}

export function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  const sl = s.slice(0, n);
  const sp = sl.lastIndexOf(' ');
  return (sp > n * 0.6 ? sl.slice(0, sp) : sl).trimEnd() + '…';
}
