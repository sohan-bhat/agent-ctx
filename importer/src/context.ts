import path from 'node:path';
import { readLines } from './lines.ts';
import { cleanSummary, contentBlocks, parseLine, promptText, textOf, usageOf, type Rec } from './records.ts';
import { cut } from '../../core/src/caps.ts';
import { redact } from '../../core/src/redact.ts';
import { slim } from './slim.ts';
import { tokens } from '../../core/src/text.ts';

export const CHARS_PER_TOKEN = 2.6;
export const IMAGE_TOKENS = 1600;
export const OUTPUT_CAP = 1500;
export const MAX_DROPPED = 80;
export const LARGE_READ = 2000;
export const SMALL_ITEM = 250;
export const MAX_STEPS = 32;

export const CAT_LABEL: Record<string, string> = {
  system: 'System and tools',
  memory: 'Memory and instruction files',
  skills: 'Skills and attachments',
  prompts: 'Your prompts',
  replies: "Claude's replies",
  summary: 'Compaction summary',
};

export function catLabel(cat: string): string {
  if (cat.startsWith('tool:')) return `Tool results, ${cat.slice(5)}`;
  return CAT_LABEL[cat] ?? cat;
}

type Kind = 'file' | 'edit' | 'command' | 'prompt' | 'other';

interface Item {
  id: string;
  cat: string;
  tok: number;
  kind: Kind;
  label: string;
  text?: string;
  error?: boolean;
}

interface Live extends Item {
  birth: number;
  turn: number;
  serial: number;
}

export interface Span {
  b: number;
  e?: number;
  c: number;
  t: number;
  l?: number;
  i?: number;
  u?: number;
  n?: number;
  s?: number[];
}

export interface Timeline {
  cats: string[];
  labels: string[];
  closed: Span[];
  live: Span[];
}

export interface Point {
  n: number;
  t: string;
  total: number;
  input: number;
  read: number;
  write: number;
  out: number;
  est: Record<string, number>;
  raw: number;
  prompt: number;
}

export interface Top {
  label: string;
  cat: string;
  tok: number;
  kind: Kind;
  count?: number;
}

export interface Dropped {
  id: string;
  kind: 'decision' | 'edit' | 'file' | 'command';
  label: string;
  text: string;
  tok: number;
  runs?: number;
  error?: boolean;
}

export interface Compaction {
  n: number;
  t: string;
  trigger: string;
  pre: number;
  post: number;
  preserved: number;
  summary: string;
  dropped: Dropped[];
  commands: number;
  smallReads: number;
  named: number;
  before: Top[];
}

export interface Ctx {
  session: string;
  transcript: string;
  offset: number;
  points: Point[];
  compactions: Compaction[];
  title?: string;
  cwd?: string;
  model?: string;
  system: { tok: number; measured: boolean };
  prompts: number;
  skipped: number;
  unreadable: number;
}

export interface Analyzer {
  ctx: Ctx;
  live: Map<string, Live>;
  sums: Map<string, number>;
  tools: Map<string, { name: string; label: string }>;
  out: Map<string, number>;
  lastMsg: string | null;
  pending: { n: number; t: string; trigger: string; pre: number; post: number; preserved: Set<string>; before: Live[] } | null;
  serial: number;
  systemFrom: number;
  cats: Map<string, number>;
  labels: Map<string, number>;
  closed: Span[];
}

const tok = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

export function newAnalyzer(session: string, transcript: string): Analyzer {
  return {
    ctx: { session, transcript, offset: 0, points: [], compactions: [], system: { tok: 0, measured: false }, prompts: 0, skipped: 0, unreadable: 0 },
    live: new Map(),
    sums: new Map(),
    tools: new Map(),
    out: new Map(),
    lastMsg: null,
    pending: null,
    serial: 0,
    systemFrom: 0,
    cats: new Map(),
    labels: new Map(),
    closed: [],
  };
}

function add(a: Analyzer, item: Item): void {
  const key = item.id + '#' + item.cat + '#' + item.label;
  a.sums.set(item.cat, (a.sums.get(item.cat) || 0) + item.tok);
  const prev = a.live.get(key);
  if (prev) {
    prev.tok += item.tok;
    if (item.text) prev.text = item.text;
    return;
  }
  a.live.set(key, { ...item, birth: a.ctx.points.length, turn: a.ctx.prompts, serial: a.serial++ });
}

function intern(map: Map<string, number>, s: string): number {
  let n = map.get(s);
  if (n === undefined) {
    n = map.size;
    map.set(s, n);
  }
  return n;
}

function single(it: Live): boolean {
  return it.kind === 'prompt' || it.cat === 'summary' || (it.cat !== 'replies' && it.tok >= SMALL_ITEM);
}

function squeeze(steps: number[]): number[] {
  let s = steps;
  while (s.length > MAX_STEPS * 2) {
    const next: number[] = [];
    for (let i = 0; i < s.length; i += 4) {
      if (i + 2 < s.length) next.push(s[i], s[i + 1] + s[i + 3]);
      else next.push(s[i], s[i + 1]);
    }
    s = next;
  }
  return s;
}

function spansOf(a: Analyzer, items: Iterable<Live>, end?: number): Span[] {
  const out: Span[] = [];
  const groups = new Map<string, { span: Span; steps: Map<number, number> }>();
  for (const it of items) {
    if (it.tok <= 0) continue;
    const c = intern(a.cats, it.cat);
    if (single(it)) {
      const span: Span = { b: it.birth, c, l: intern(a.labels, it.label), t: it.tok };
      if (end === undefined) span.i = it.serial;
      else span.e = end;
      out.push(span);
      continue;
    }
    const key = `${c}@${it.turn}`;
    let g = groups.get(key);
    if (!g) {
      g = { span: { b: it.birth, c, t: 0, u: it.turn, n: 0 }, steps: new Map() };
      if (end !== undefined) g.span.e = end;
      groups.set(key, g);
      out.push(g.span);
    }
    g.span.t += it.tok;
    g.span.n = (g.span.n ?? 0) + 1;
    g.span.b = Math.min(g.span.b, it.birth);
    g.steps.set(it.birth, (g.steps.get(it.birth) ?? 0) + it.tok);
  }
  for (const g of groups.values()) g.span.s = squeeze([...g.steps].sort((x, y) => x[0] - y[0]).flat());
  return out;
}

export function timeline(a: Analyzer): Timeline {
  const live = spansOf(a, a.live.values());
  if (a.ctx.system.tok > 0) {
    const label = a.ctx.system.measured ? 'System prompt and tool definitions' : 'System prompt';
    live.unshift({ b: a.systemFrom, c: intern(a.cats, 'system'), l: intern(a.labels, label), t: a.ctx.system.tok, i: -1 });
  }
  return { cats: [...a.cats.keys()], labels: [...a.labels.keys()], closed: a.closed, live };
}

function remove(a: Analyzer, key: string): void {
  const it = a.live.get(key);
  if (!it) return;
  a.live.delete(key);
  a.sums.set(it.cat, (a.sums.get(it.cat) || 0) - it.tok);
}

function setSystem(a: Analyzer, t: number): void {
  if (!a.ctx.system.tok) a.systemFrom = a.ctx.points.length;
  a.ctx.system = { tok: t, measured: true };
}

function renderedChars(r: Rec): number {
  if (!Array.isArray(r.rendered)) return 0;
  let n = 0;
  for (const b of r.rendered) n += typeof b?.content === 'string' ? b.content.length : JSON.stringify(b ?? '').length;
  return n;
}

const SYSTEM_ATTACH = new Set(['deferred_tools_delta', 'mcp_instructions_delta', 'agent_listing_delta']);
const MEMORY_ATTACH = new Set(['instructions', 'nested_memory']);
const FILE_ATTACH = new Set(['file', 'edited_text_file', 'compact_file_reference']);

function attachment(a: Analyzer, r: Rec): void {
  const at = r.attachment ?? {};
  const type = String(at.type ?? '');
  if (type === 'prompt_snapshot' && !a.ctx.system.measured) {
    const chars = JSON.stringify(at.systemPrompt ?? '').length + JSON.stringify(at.tools ?? '').length;
    if (chars > 2) setSystem(a, tok(chars));
    return;
  }
  const chars = renderedChars(r);
  if (!chars) return;
  const id = String(r.uuid ?? '');
  if (MEMORY_ATTACH.has(type)) {
    const files = Array.isArray(at.files) ? at.files.length : 1;
    add(a, { id, cat: 'memory', tok: tok(chars), kind: 'other', label: files > 1 ? `${files} instruction files` : String(at.displayPath ?? at.path ?? 'Instruction file') });
  } else if (FILE_ATTACH.has(type)) {
    const f = String(at.filename ?? at.displayPath ?? 'file');
    add(a, { id, cat: 'skills', tok: tok(chars), kind: 'file', label: f });
  } else if (SYSTEM_ATTACH.has(type)) {
    add(a, { id, cat: 'system', tok: tok(chars), kind: 'other', label: type.replace(/_/g, ' ') });
  } else {
    add(a, { id, cat: 'skills', tok: tok(chars), kind: 'other', label: type.replace(/_/g, ' ') });
  }
}

function toolLabel(name: string, input: any): string {
  if (!input || typeof input !== 'object') return name;
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.command === 'string') return cut(redact(input.command.replace(/\s+/g, ' ')), 160);
  if (typeof input.pattern === 'string') return `${name} ${cut(redact(input.pattern), 80)}`;
  if (typeof input.url === 'string') return cut(redact(input.url), 160);
  if (typeof input.description === 'string') return `${name} ${cut(redact(input.description), 80)}`;
  return name;
}

function snapshot(a: Analyzer, r: Rec, u: NonNullable<ReturnType<typeof usageOf>>): void {
  const est: Record<string, number> = {};
  let raw = 0;
  for (const [cat, v] of a.sums) if (v > 0) est[cat] = v;
  if (a.ctx.system.tok) est.system = (est.system || 0) + a.ctx.system.tok;
  for (const v of Object.values(est)) raw += v;
  a.ctx.points.push({
    n: a.ctx.points.length,
    t: String(r.timestamp ?? ''),
    total: u.total,
    input: u.input,
    read: u.cacheRead,
    write: u.cacheWrite,
    out: u.output,
    est,
    raw,
    prompt: a.ctx.prompts,
  });
}

function assistant(a: Analyzer, r: Rec): void {
  const msg = r.message ?? {};
  const id = typeof msg.id === 'string' ? msg.id : String(r.uuid ?? '');
  if (id !== a.lastMsg) {
    a.lastMsg = id;
    const u = usageOf(r);
    if (u && !r.isApiErrorMessage) snapshot(a, r, u);
    if (typeof msg.model === 'string' && !msg.model.startsWith('<')) a.ctx.model = msg.model;
  }
  const uid = String(r.uuid ?? '');
  const u = usageOf(r);
  if (u) {
    const prev = a.out.get(id) ?? 0;
    if (u.output > prev) {
      add(a, { id: uid, cat: 'replies', tok: u.output - prev, kind: 'other', label: 'Reply' });
      a.out.set(id, u.output);
    }
  }
  for (const b of contentBlocks(r)) {
    if (!b || typeof b !== 'object' || b.type !== 'tool_use') continue;
    const name = String(b.name ?? 'tool').startsWith('mcp__') ? String(b.name).split('__').slice(0, 2).join('__') : String(b.name ?? 'tool');
    a.tools.set(String(b.id ?? ''), { name, label: toolLabel(name, b.input) });
    const file = b.input?.file_path ?? b.input?.notebook_path;
    if (EDIT_TOOLS.has(name) && typeof file === 'string') add(a, { id: uid, cat: 'replies', tok: 0, kind: 'edit', label: file });
  }
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const ERROR = /^(error|fatal)(\[[^\]]*\])?:|Traceback \(most recent call last\)|npm ERR!|command not found|panicked at|^\s*FAIL\s|^Exit code [1-9]/im;

export function hasError(output: string, flagged: boolean): boolean {
  return flagged || ERROR.test(output);
}

function user(a: Analyzer, r: Rec): void {
  const uid = String(r.uuid ?? '');
  if (r.isCompactSummary) {
    const text = textOf(r.message?.content);
    finishCompaction(a, text, r);
    add(a, { id: uid, cat: 'summary', tok: tok(text.length), kind: 'other', label: 'Compaction summary' });
    return;
  }
  const p = promptText(r);
  if (p) {
    a.ctx.prompts++;
    add(a, { id: uid, cat: 'prompts', tok: tok(textOf(r.message?.content).length), kind: 'prompt', label: cut(redact(p), 120), text: cut(redact(p), 2000) });
    for (const b of contentBlocks(r)) if (b?.type === 'image') add(a, { id: uid, cat: 'prompts', tok: IMAGE_TOKENS, kind: 'other', label: 'Image' });
    return;
  }
  let other = 0;
  for (const b of contentBlocks(r)) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'tool_result') {
      const info = a.tools.get(String(b.tool_use_id ?? '')) ?? { name: 'tool', label: 'tool' };
      const body = textOf(b.content);
      let images = 0;
      if (Array.isArray(b.content)) for (const c of b.content) if (c?.type === 'image') images++;
      const t = tok(body.length) + images * IMAGE_TOKENS;
      const kind: Kind = info.name === 'Read' ? 'file' : info.name === 'Bash' ? 'command' : 'other';
      const text = kind === 'command' ? clipOutput(body) : undefined;
      const error = kind === 'command' ? hasError(body, b.is_error === true) : undefined;
      add(a, { id: uid, cat: `tool:${info.name}`, tok: t, kind, label: info.label, text, error });
    } else if (b.type === 'text' && typeof b.text === 'string') other += b.text.length;
    else if (b.type === 'image') other += IMAGE_TOKENS * CHARS_PER_TOKEN;
  }
  if (other) add(a, { id: uid, cat: 'skills', tok: tok(other), kind: 'other', label: r.isMeta ? 'Injected note' : 'Message' });
}

function clipOutput(s: string): string {
  const red = redact(s);
  if (red.length <= OUTPUT_CAP) return red;
  return red.slice(0, 1000) + '\n…\n' + red.slice(-450);
}

const DECISION = /\b(use|using|don'?t|do not|never|always|must|should|instead|prefer|keep|switch to|go with|stick with|make sure|no more|stop|avoid|only|rather than|from now on|decid)/i;

export function decisions(prompt: string): string[] {
  const out: string[] = [];
  for (const s of prompt.split(/(?<=[.!?])\s+|\n+/)) {
    const t = s.trim();
    if (t.length < 12 || t.length > 300) continue;
    if (DECISION.test(t)) out.push(t);
  }
  return out;
}

function summaryWords(summary: string): Set<string> {
  return new Set(tokens(summary));
}

const WORDISH = /[a-z0-9_\-]/;

export function mentions(hay: string, needle: string, allowSlash = false): boolean {
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return false;
    const before = i > 0 ? hay[i - 1] : ' ';
    const after = hay[i + needle.length] ?? ' ';
    const next = hay[i + needle.length + 1] ?? ' ';
    const okBefore = !WORDISH.test(before) && before !== '.' && (allowSlash || before !== '/');
    const okAfter = !WORDISH.test(after) && after !== '/' && !(after === '.' && WORDISH.test(next));
    if (okBefore && okAfter) return true;
    from = i + 1;
  }
}

export function fileNamed(file: string, summaryLower: string, root?: string, uniqueBase = true): boolean {
  const f = file.toLowerCase();
  const parts = f.split('/').filter(Boolean);
  if (!parts.length) return false;
  if (mentions(summaryLower, f, true)) return true;
  const r = root?.toLowerCase();
  if (r && f.startsWith(r + '/') && mentions(summaryLower, f.slice(r.length + 1), true)) return true;
  if (parts.length >= 2 && mentions(summaryLower, parts.slice(-2).join('/'), true)) return true;
  return uniqueBase && parts[parts.length - 1].includes('.') && mentions(summaryLower, parts[parts.length - 1]);
}

export function normalizeCommand(cmd: string): string {
  let c = cmd.replace(/\s+/g, ' ').trim();
  for (;;) {
    const n = c.replace(/^cd \S+ (&&|;) /, '');
    if (n === c) break;
    c = n;
  }
  return c.replace(/ 2>&1\b/g, '').replace(/ \| (head|tail)( -n)? ?-?\d*$/, '').trim();
}

export function commandNamed(label: string, summaryLower: string): boolean {
  const cmd = normalizeCommand(label).toLowerCase();
  if (cmd.length < 4) return false;
  return mentions(summaryLower, cmd, true);
}

export function decisionNamed(sentence: string, words: Set<string>): boolean {
  const t = [...new Set(tokens(sentence))];
  if (!t.length) return true;
  const hit = t.filter((w) => words.has(w)).length;
  return hit / t.length >= 0.6;
}

function top(items: Iterable<Live>, n: number): Top[] {
  return [...items]
    .filter((i) => i.tok > 0)
    .sort((x, y) => y.tok - x.tok)
    .slice(0, n)
    .map((i) => ({ label: i.label, cat: i.cat, tok: i.tok, kind: i.kind }));
}

function finishCompaction(a: Analyzer, rawSummary: string, r: Rec): void {
  const p = a.pending ?? { n: a.ctx.points.length, t: String(r.timestamp ?? ''), trigger: 'unknown', pre: 0, post: 0, preserved: new Set<string>(), before: [...a.live.values()] };
  a.pending = null;
  const summary = cleanSummary(rawSummary);
  const lower = summary.toLowerCase();
  const words = summaryWords(summary);
  const root = a.ctx.cwd;
  const bases = new Map<string, Set<string>>();
  for (const it of p.before) {
    if (it.kind !== 'file' && it.kind !== 'edit') continue;
    const b = path.basename(it.label).toLowerCase();
    const set = bases.get(b) ?? new Set<string>();
    set.add(it.label);
    bases.set(b, set);
  }
  const unique = (f: string) => (bases.get(path.basename(f).toLowerCase())?.size ?? 0) <= 1;
  const decided: Dropped[] = [];
  const edits = new Map<string, Dropped>();
  const reads = new Map<string, Dropped>();
  const commands = new Map<string, Dropped>();
  const seen = new Set<string>();
  const namedKeys = new Set<string>();
  let smallReads = 0;
  for (const it of p.before) {
    if (p.preserved.has(it.id)) continue;
    if (it.kind === 'edit') {
      const key = 'edit:' + it.label;
      if (namedKeys.has(key)) continue;
      if (fileNamed(it.label, lower, root, unique(it.label))) {
        namedKeys.add(key);
        continue;
      }
      const e = edits.get(key);
      if (e) e.runs = (e.runs ?? 1) + 1;
      else edits.set(key, { id: key, kind: 'edit', label: it.label, text: '', tok: 0, runs: 1 });
    } else if (it.kind === 'file') {
      const key = 'file:' + it.label;
      if (namedKeys.has(key)) continue;
      if (fileNamed(it.label, lower, root, unique(it.label))) {
        namedKeys.add(key);
        continue;
      }
      const prev = reads.get(key);
      if (!prev || it.tok > prev.tok) reads.set(key, { id: key, kind: 'file', label: it.label, text: '', tok: it.tok });
    } else if (it.kind === 'command') {
      const norm = normalizeCommand(it.label);
      const key = 'command:' + norm;
      if (namedKeys.has(key)) continue;
      if (commandNamed(it.label, lower)) {
        namedKeys.add(key);
        continue;
      }
      const prev = commands.get(key);
      commands.set(key, { id: key, kind: 'command', label: it.label, text: it.text ?? '', tok: it.tok, runs: (prev?.runs ?? 0) + 1, error: !!(prev?.error || it.error) });
    } else if (it.kind === 'prompt' && it.text) {
      for (const d of decisions(it.text)) {
        const key = 'decision:' + d.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (decisionNamed(d, words)) {
          namedKeys.add(key);
          continue;
        }
        decided.push({ id: key, kind: 'decision', label: 'Decision', text: d, tok: tok(d.length) });
      }
    }
  }
  for (const k of edits.keys()) reads.delete('file:' + k.slice(5));
  const bigReads = [...reads.values()].filter((d) => {
    if (d.tok >= LARGE_READ) return true;
    smallReads++;
    return false;
  });
  const kept = [...commands.values()].filter((d) => d.error || (d.runs ?? 1) > 1);
  const dropped: Dropped[] = [
    ...decided,
    ...[...edits.values()].sort((x, y) => (y.runs ?? 0) - (x.runs ?? 0)),
    ...bigReads.sort((x, y) => y.tok - x.tok),
    ...kept.sort((x, y) => Number(!!y.error) - Number(!!x.error) || (y.runs ?? 0) - (x.runs ?? 0) || y.tok - x.tok),
  ];
  const named = namedKeys.size;
  a.ctx.compactions.push({
    n: p.n,
    t: p.t,
    trigger: p.trigger,
    pre: p.pre,
    post: p.post,
    preserved: p.preserved.size,
    summary: cut(redact(summary), 4000),
    dropped: dropped.slice(0, MAX_DROPPED),
    commands: commands.size,
    smallReads,
    named,
    before: top(p.before, 10),
  });
  const gone = [...a.live].filter(([, v]) => !p.preserved.has(v.id));
  a.closed.push(...spansOf(a, gone.map(([, v]) => v), p.n));
  for (const [k] of gone) remove(a, k);
}

function boundary(a: Analyzer, r: Rec): void {
  const m = r.compactMetadata ?? {};
  const ids: string[] = Array.isArray(m.preservedMessages?.allUuids) ? m.preservedMessages.allUuids : Array.isArray(m.preservedMessages?.uuids) ? m.preservedMessages.uuids : [];
  a.pending = {
    n: a.ctx.points.length,
    t: String(r.timestamp ?? ''),
    trigger: String(m.trigger ?? 'auto'),
    pre: typeof m.preTokens === 'number' ? m.preTokens : 0,
    post: typeof m.postTokens === 'number' ? m.postTokens : 0,
    preserved: new Set(ids.map(String)),
    before: [...a.live.values()],
  };
}

const SIDE = Buffer.from('"isSidechain":true');
const API = Buffer.from('"type":"api-request');
const BLOB = Buffer.from('-blob"');

export function wantedBytes(buf: Buffer): boolean {
  const head = buf.subarray(0, 256);
  const side = head.indexOf(SIDE);
  if (side > 0) {
    const nested = head.indexOf(123, 1);
    if (nested === -1 || nested > side) return false;
  }
  for (let i = buf.indexOf(API); i >= 0; i = buf.indexOf(API, i + 1)) {
    const at = i + API.length;
    if (buf[at] === 34) return false;
    if (buf.subarray(at, at + BLOB.length).equals(BLOB)) return false;
  }
  return true;
}

export function lineBytes(buf: Buffer): Buffer | null {
  return wantedBytes(buf) ? slim(buf) : null;
}

export function step(a: Analyzer, r: Rec): void {
  if (r.isSidechain) return;
  if (typeof r.cwd === 'string' && !a.ctx.cwd) a.ctx.cwd = r.cwd;
  switch (r.type) {
    case 'assistant':
      return assistant(a, r);
    case 'user':
      return user(a, r);
    case 'attachment':
      return attachment(a, r);
    case 'system':
      if (r.subtype === 'compact_boundary') boundary(a, r);
      return;
    case 'api-request-shape': {
      const sh = r.shape ?? {};
      const chars = JSON.stringify(sh.system ?? '').length + JSON.stringify(sh.tools ?? '').length;
      if (chars > 2) setSystem(a, tok(chars));
      return;
    }
    case 'ai-title':
      if (typeof r.aiTitle === 'string') a.ctx.title = cut(redact(r.aiTitle), 120);
      return;
    case 'custom-title':
      if (typeof r.customTitle === 'string') a.ctx.title = cut(redact(r.customTitle), 120);
      return;
    default:
      a.ctx.skipped++;
  }
}

export const PROGRESS_BYTES = 8 * 1024 * 1024;

export async function advance(a: Analyzer, to?: number, onProgress?: (offset: number) => void): Promise<number> {
  let n = 0;
  let mark = a.ctx.offset + PROGRESS_BYTES;
  for await (const line of readLines(a.ctx.transcript, a.ctx.offset, to, lineBytes)) {
    a.ctx.offset = line.end;
    if (onProgress && line.end >= mark) {
      mark = line.end + PROGRESS_BYTES;
      onProgress(line.end);
    }
    if (!line.text) continue;
    const r = parseLine(line.text);
    if (!r) {
      a.ctx.unreadable++;
      continue;
    }
    step(a, r);
    n++;
  }
  return n;
}

export function largest(a: Analyzer, n = 12): Top[] {
  const groups = new Map<string, Item & { count: number }>();
  for (const it of a.live.values()) {
    if (it.tok <= 0) continue;
    const key = it.cat + '\u0000' + it.label;
    const g = groups.get(key);
    if (g) {
      g.tok += it.tok;
      g.count++;
    } else groups.set(key, { ...it, count: 1 });
  }
  const items: (Item & { count: number })[] = [...groups.values()];
  if (a.ctx.system.tok) items.push({ id: 'system', cat: 'system', tok: a.ctx.system.tok, kind: 'other', label: a.ctx.system.measured ? 'System prompt and tool definitions' : 'System prompt', count: 1 });
  return items
    .sort((x, y) => y.tok - x.tok)
    .slice(0, n)
    .map((i) => ({ label: i.label, cat: i.cat, tok: i.tok, kind: i.kind, count: i.count }));
}

export function weight(a: Analyzer): number {
  let text = 0;
  for (const it of a.live.values()) text += (it.label.length + (it.text?.length ?? 0)) * 2;
  let labels = 0;
  for (const l of a.labels.keys()) labels += l.length * 2 + 48;
  let dropped = 0;
  for (const c of a.ctx.compactions) {
    dropped += c.summary.length * 2 + 2048;
    for (const d of c.dropped) dropped += (d.label.length + d.text.length) * 2 + 160;
  }
  return 16_384 + a.ctx.points.length * 420 + a.live.size * 260 + a.closed.length * 140 + text + labels + dropped;
}

export function categories(a: Analyzer): string[] {
  const set = new Set<string>();
  for (const p of a.ctx.points) for (const k of Object.keys(p.est)) set.add(k);
  return [...set];
}
