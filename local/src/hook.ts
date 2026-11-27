export type Host = 'claude-code' | 'codex' | 'cursor' | 'gemini';

export interface EventArgs { host?: string; event?: string; session?: string; cwd?: string; prompt?: string; tool?: string; file?: string; command?: string; message?: string; summary?: string; reason?: string; source?: string; model?: string }

type Take = Partial<Record<keyof EventArgs, string>>;
interface Case { as?: string; take?: Take }
interface Rule extends Case { as: string; by?: string; cases?: Record<string, Case>; open?: boolean }

const FILE: Case = { take: { file: 'tool_input.file_path' } };
const BOOK: Case = { take: { file: 'tool_input.notebook_path' } };
const RUN: Case = { take: { command: 'tool_input.command' } };
const SOURCE: Case = { take: { source: 'source' } };
const BROKE: Case = { as: 'StopFailure', take: { reason: 'status' } };
const KEPT: Record<string, Case> = { Write: FILE, Edit: FILE, MultiEdit: FILE, NotebookEdit: BOOK, Bash: RUN };
const PROMPT: Rule = { as: 'UserPromptSubmit', take: { prompt: 'prompt' } };
const STOP: Rule = { as: 'Stop', take: { message: 'last_assistant_message' } };
const tools = (cases: Record<string, Case>, as = 'PostToolUse'): Rule => ({ as, by: 'tool_name', take: { tool: 'tool_name' }, cases });

const SESSION: Take = { session: 'session_id', cwd: 'cwd' };
const BASE: Record<Host, Take> = {
  'claude-code': SESSION,
  codex: SESSION,
  cursor: { session: 'conversation_id|session_id', cwd: 'cwd|workspace_roots.0', model: 'model' },
  gemini: SESSION,
};

const RULES: Record<Host, Record<string, Rule>> = {
  'claude-code': {
    UserPromptSubmit: PROMPT,
    PostToolUse: tools(KEPT),
    PostToolUseFailure: tools({ Bash: RUN }, 'PostToolUseFailure'),
    Stop: STOP,
    StopFailure: { as: 'StopFailure', take: { reason: 'error' } },
    PostCompact: { as: 'PostCompact', take: { summary: 'compact_summary' } },
    SessionStart: { as: 'SessionStart', by: 'source', cases: { clear: SOURCE, compact: SOURCE } },
  },
  codex: {
    UserPromptSubmit: PROMPT,
    PostToolUse: tools({ Bash: RUN }),
    Stop: STOP,
  },
  cursor: {
    sessionStart: { as: 'SessionStart' },
    beforeSubmitPrompt: PROMPT,
    postToolUse: tools({ ...KEPT, Shell: RUN }),
    afterAgentResponse: { as: 'Stop', take: { message: 'text' } },
    stop: { as: 'Stop', by: 'status', open: true, cases: { error: BROKE } },
  },
  gemini: {
    BeforeAgent: PROMPT,
    AfterTool: tools({ write_file: FILE, replace: FILE, run_shell_command: RUN }),
    AfterAgent: { as: 'Stop', take: { message: 'prompt_response' } },
  },
};

const HEARD: Record<Host, readonly string[]> = {
  'claude-code': ['UserPromptSubmit', 'SessionStart'],
  codex: ['UserPromptSubmit'],
  cursor: ['SessionStart', 'PostToolUse'],
  gemini: ['UserPromptSubmit'],
};

const SIGNS: Record<string, readonly string[]> = {
  cursor: ['CURSOR_VERSION', 'CURSOR_PROJECT_DIR', 'CURSOR_USER_EMAIL'],
  devin: ['DEVIN_PROJECT_DIR'],
};

export const LIMIT: Record<Host, number> = { 'claude-code': 10000, codex: 7500, cursor: 7500, gemini: 7500 };

function own<T>(table: Record<string, T>, key: string | undefined): T | undefined {
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

function at(from: unknown, paths: string): string | undefined {
  for (const path of paths.split('|')) {
    let v: unknown = from;
    for (const key of path.split('.')) v = typeof v === 'object' && v !== null && Object.hasOwn(v, key) ? (v as Record<string, unknown>)[key] : undefined;
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const line = text.lastIndexOf('\n', max);
  if (line > 0) return text.slice(0, line);
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

export function fits(host: Host, env: Record<string, string | undefined>): boolean {
  const set = (name: string) => env[name] !== undefined;
  if (host === 'cursor' && !set('CURSOR_VERSION')) return false;
  return !Object.entries(SIGNS).some(([product, names]) => product !== host && names.some(set));
}

export function read(host: Host, stdin: string): EventArgs | null {
  let from: unknown;
  try {
    from = JSON.parse(stdin);
  } catch {
    return null;
  }
  const rule = own(own(RULES, host) ?? {}, at(from, 'hook_event_name'));
  if (!rule) return null;
  const pick = rule.by ? own(rule.cases ?? {}, at(from, rule.by)) : undefined;
  if (rule.by && !pick && !rule.open) return null;
  const out: EventArgs = { host, event: pick?.as ?? rule.as };
  for (const take of [BASE[host], rule.take, pick?.take]) {
    for (const [field, paths] of Object.entries(take ?? {})) {
      const v = at(from, paths);
      if (v !== undefined) out[field as keyof EventArgs] = v;
    }
  }
  return out;
}

export function write(host: Host, event: string, text: string): string {
  const rules = own(RULES, host) ?? {};
  const name = own(rules, event)?.as ?? event;
  if (!own(HEARD, host)?.includes(name)) return '';
  const body = cut(text, LIMIT[host]);
  const bare = body.trim();
  if (!bare) return '';
  if (host === 'cursor') return JSON.stringify({ additional_context: body });
  const native = Object.keys(rules).find((key) => rules[key]?.as === name) ?? name;
  const framed = JSON.stringify({ hookSpecificOutput: { hookEventName: native, additionalContext: body } });
  if (host === 'gemini') return framed;
  return bare.startsWith('{') && bare.endsWith('}') ? framed : body;
}
