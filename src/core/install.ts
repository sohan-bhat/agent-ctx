import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './fsx.ts';

export interface HookInfo {
  event: string;
  arg: string;
  name: string;
  does: string;
}

export const HOOKS: HookInfo[] = [
  { event: 'SessionStart', arg: 'session-start', name: 'Session start', does: 'adds a short recall of your work in other folders' },
  { event: 'UserPromptSubmit', arg: 'prompt', name: 'Your prompt', does: 'adds past work that fits what you asked' },
  { event: 'PreCompact', arg: 'pre-compact', name: 'Before a compact', does: 'keeps what you pinned' },
  { event: 'PostCompact', arg: 'post-compact', name: 'After a compact', does: 'saves the new summary for later recall' },
  { event: 'SessionEnd', arg: 'session-end', name: 'Session end', does: 'saves the session for later recall' },
];

export const EVENTS: [string, string][] = HOOKS.map((h) => [h.event, h.arg]);

export function hookName(arg: string): string {
  return HOOKS.find((h) => h.arg === arg || h.event === arg)?.name ?? arg;
}

const ARGS = new Set(EVENTS.map(([, a]) => a));

export function hookCommand(node: string, hookJs: string, arg: string): string {
  return `"${node}" "${hookJs}" ${arg}`;
}

export function isOurs(cmd: unknown, hookJs?: string): boolean {
  if (typeof cmd !== 'string') return false;
  if (hookJs && cmd.includes(`"${hookJs}"`)) return true;
  const m = cmd.match(/"([^"]*claude-ctx[^"]*\/hook\.(?:js|ts))"\s+([a-z-]+)\s*$/);
  return !!m && ARGS.has(m[2]);
}

type Settings = Record<string, any>;

function inner(settings: Settings): { event: string; command: unknown }[] {
  const out: { event: string; command: unknown }[] = [];
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== 'object') return out;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) if (g && Array.isArray(g.hooks)) for (const h of g.hooks) out.push({ event, command: h?.command });
  }
  return out;
}

export function countHooks(settings: Settings, hookJs?: string): { ours: number; others: number; events: Set<string> } {
  let ours = 0;
  let others = 0;
  const events = new Set<string>();
  for (const h of inner(settings)) {
    if (isOurs(h.command, hookJs)) {
      ours++;
      events.add(h.event);
    } else others++;
  }
  return { ours, others, events };
}

export function missingHooks(settings: Settings, hookJs?: string): HookInfo[] {
  const have = countHooks(settings, hookJs).events;
  return HOOKS.filter((h) => !have.has(h.event));
}

export function withHooks(settings: Settings, node: string, hookJs: string): Settings {
  const next: Settings = structuredClone(settings);
  const missing = missingHooks(next, hookJs);
  if (!missing.length) return next;
  if (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks)) next.hooks = {};
  for (const h of missing) {
    const list: any[] = Array.isArray(next.hooks[h.event]) ? next.hooks[h.event] : [];
    list.push({ hooks: [{ type: 'command', command: hookCommand(node, hookJs, h.arg), timeout: h.event === 'SessionEnd' ? 3 : 10 }] });
    next.hooks[h.event] = list;
  }
  return next;
}

export function withoutHooks(settings: Settings, hookJs?: string): Settings {
  const next: Settings = structuredClone(settings);
  const hooks = next.hooks;
  if (!hooks || typeof hooks !== 'object') return next;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) {
        kept.push(g);
        continue;
      }
      const inner = g.hooks.filter((h: any) => !isOurs(h?.command, hookJs));
      if (inner.length === g.hooks.length) kept.push(g);
      else if (inner.length) kept.push({ ...g, hooks: inner });
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (!Object.keys(hooks).length) delete next.hooks;
  return next;
}

export function render(settings: Settings): string {
  return JSON.stringify(settings, null, 2) + '\n';
}

export interface DiffLine {
  sign: '+' | '-' | ' ';
  text: string;
}

export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ sign: ' ', text: x[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ sign: '-', text: x[i++] });
    else out.push({ sign: '+', text: y[j++] });
  }
  while (i < n) out.push({ sign: '-', text: x[i++] });
  while (j < m) out.push({ sign: '+', text: y[j++] });
  return out;
}

export interface Plan {
  file: string;
  before: string;
  after: string;
  changes: DiffLine[];
  exists: boolean;
  missing: HookInfo[];
  ours: number;
  others: number;
}

export function readSettings(file: string): { text: string; data: Settings } {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {}
  if (!text.trim()) return { text, data: {} };
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('settings are not a JSON object');
  return { text, data: data as Settings };
}

export function planInstall(file: string, node: string, hookJs: string): Plan {
  const { text, data } = readSettings(file);
  const missing = missingHooks(data, hookJs);
  const counts = countHooks(data, hookJs);
  const after = missing.length ? render(withHooks(data, node, hookJs)) : text;
  const changes = missing.length ? diffLines(text, after).filter((d) => d.sign !== ' ') : [];
  return { file, before: text, after, changes, exists: !!text.trim(), missing, ours: counts.ours, others: counts.others };
}

export function planUninstall(file: string, hookJs?: string): Plan {
  const { text, data } = readSettings(file);
  const cleaned = withoutHooks(data, hookJs);
  const counts = countHooks(data, hookJs);
  const after = text.trim() ? render(cleaned) : text;
  const same = JSON.stringify(cleaned) === JSON.stringify(data);
  return {
    file,
    before: text,
    after: same ? text : after,
    changes: same ? [] : diffLines(text, after).filter((d) => d.sign !== ' '),
    exists: !!text.trim(),
    missing: missingHooks(data, hookJs),
    ours: counts.ours,
    others: counts.others,
  };
}

export function backupPath(file: string): string {
  return path.join(path.dirname(file), path.basename(file) + '.claude-ctx-backup');
}

export function apply(plan: Plan): void {
  if (plan.before) atomicWrite(backupPath(plan.file), plan.before);
  atomicWrite(plan.file, plan.after);
}
