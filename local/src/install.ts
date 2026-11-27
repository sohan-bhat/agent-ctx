import fs from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

export type Agent = 'claude-code' | 'cursor' | 'codex' | 'gemini' | 'claude-desktop';
export interface Paths { home: string; app: string; node: string; platform: 'darwin' | 'linux' | 'win32' }
export interface Change { file: string; what: string; before: string | null; after: string | null; run?: string[] }

type Obj = Record<string, unknown>;
type Mine = (value: unknown) => boolean;
type Verb = 'created' | 'added' | 'updated' | 'removed' | 'gone';
interface Hooks { events: string[]; nested: boolean; version: boolean; entry: Obj }
interface Target { file: string; server?: Obj; hooks?: Hooks }
interface Part { path: string[]; array: boolean; from: number; to: number }
interface Pair { name: string; full: string[]; value: string }

const NAME = 'agent-ctx';
const BACKUP = `.${NAME}-backup`;
const HOOK = 'hook --agent';
const MARK = /"agent-ctx"\s*:|hook --agent|^\s*\[\s*mcp_servers\s*\.\s*["']?agent-ctx/m;
const LAYOUT = 'has an unexpected layout';
const LINK = 'is a link to a place outside the home folder';
const UNSAFE = `has ${NAME} in a form unsafe for a text edit`;
const NUMBERS = 'has numbers unsafe for a rewrite';

class Odd extends Error {}

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const risky = (value: unknown): boolean =>
  typeof value === 'number' ? !Number.isFinite(value)
  : Array.isArray(value) ? value.some(risky)
  : isObj(value) && Object.entries(value).some(([name, inner]) => /^(0|[1-9]\d*)$/.test(name) || risky(inner));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const read = (file: string): string | null => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const drop = (doc: Obj, key: string): Obj => Object.fromEntries(Object.entries(doc).filter(([name]) => name !== key));
const list = (names: string[]): string => `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
const idle = (line: string): boolean => /^(#.*)?$/.test(line.trim());
const ours = (path: string[]): boolean => path[0] === 'mcp_servers' && path[1] === NAME;
const quote = (text: string): string => JSON.stringify(text).replace(/\u007f/g, '\\u007f');

function loose(text: string | null): unknown {
  try {
    return JSON.parse(text ?? '');
  } catch {
    return undefined;
  }
}

function strict(text: string): Obj {
  const doc = loose(text);
  if (doc === undefined) throw new Odd('is not strict JSON');
  if (!isObj(doc)) throw new Odd(LAYOUT);
  const wide = text.replace(/"(?:[^"\\]|\\.)*"/g, '').match(/(?<![\d.eE+-])-?\d{16,}(?![\d.eE])/g) ?? [];
  if (risky(doc) || wide.some((digits) => !Number.isSafeInteger(Number(digits)))) throw new Odd(NUMBERS);
  return doc;
}

function dig(value: unknown, ...keys: string[]): unknown {
  let at = value;
  for (const key of keys) at = isObj(at) && Object.hasOwn(at, key) ? at[key] : undefined;
  return at;
}

function desktop(p: Paths): string {
  const base =
    p.platform === 'darwin' ? join(p.home, 'Library', 'Application Support')
    : p.platform === 'linux' ? join(p.home, '.config')
    : process.env.APPDATA || join(p.home, 'AppData', 'Roaming');
  return join(base, 'Claude', 'claude_desktop_config.json');
}

function locate(file: string, p: Paths): string | null {
  if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) return file;
  try {
    const to = fs.realpathSync(file);
    const inside = [p.home, dirname(desktop(p))].some((root) => {
      const rel = fs.existsSync(root) ? relative(fs.realpathSync(root), to) : '..';
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    });
    return inside ? to : null;
  } catch {
    return null;
  }
}

function load(file: string, p: Paths): string | null {
  const real = locate(file, p);
  return real === null ? null : read(real);
}

function word(text: string, p: Paths): string {
  const win = p.platform === 'win32';
  if ((win ? /^[\w\-./:=@%+,\\]+$/ : /^[\w\-./:=@%+,]+$/).test(text)) return text;
  return win ? `"${text}"` : `"${text.replace(/[\\"$`]/g, '\\$&')}"`;
}

function former(args: unknown): string[] {
  return Array.isArray(args) && typeof args[0] === 'string' && args[1] === 'mcp' && args[2] === '--agent' ? [args[0]] : [];
}

function owned(p: Paths, apps: string[]): Mine {
  return (value) => {
    const text = dig(value, 'command');
    return typeof text === 'string' && text.includes(HOOK) && apps.some((app) => app !== '' && (text.includes(app) || text.includes(word(app, p))));
  };
}

function earlier(file: string): { backed: boolean; had: (...path: string[]) => boolean } {
  const text = read(file + BACKUP);
  const doc = loose(text);
  const had = (...path: string[]): boolean => {
    let at = doc;
    for (const key of path) {
      if (!isObj(at) || !Object.hasOwn(at, key)) return false;
      at = at[key];
    }
    return true;
  };
  return { backed: text !== null, had };
}

function print(doc: Obj, before: string | null): string {
  const indent = /\n([ \t]+)"/.exec(before ?? '')?.[1] ?? '  ';
  const text = JSON.stringify(doc, null, indent) + (before === null || before.endsWith('\n') ? '\n' : '');
  return before?.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text;
}

function say(file: string, things: string, verb: Verb, app: string): string {
  const be = things.includes('hooks') ? 'are' : 'is';
  const lead = things[0].toUpperCase() + things.slice(1);
  if (verb === 'created') return `${file} is created with ${things}.`;
  if (verb === 'added') return `${lead} ${be} added to ${file}.`;
  if (verb === 'updated') return `${lead} ${be} updated in ${file} for the program path ${app}.`;
  if (verb === 'removed') return `${lead} ${be} removed from ${file}.`;
  return `${file} contained only ${NAME} entries and is removed.`;
}

function alone(file: string, before: string | null, why: string, on: boolean, hand: string): Change {
  const next = on ? `To connect by hand, ${hand}.` : `To disconnect by hand, remove every ${NAME} entry from the file.`;
  return { file, what: `${file} ${why} and was left alone. ${next}`, before, after: before };
}

function strip(items: unknown[], nested: boolean, mine: Mine): { kept: unknown[]; at: number } {
  const kept: unknown[] = [];
  let at = -1;
  for (const item of items) {
    const inner = nested ? dig(item, 'hooks') : undefined;
    const rest = Array.isArray(inner) ? inner.filter((hook) => !mine(hook)) : [];
    const hit = Array.isArray(inner) ? rest.length < inner.length : !nested && mine(item);
    if (hit && at < 0) at = kept.length;
    if (!hit) kept.push(item);
    else if (rest.length && isObj(item)) kept.push({ ...item, hooks: rest });
  }
  return { kept, at };
}

function wire(doc: Obj, target: Target, on: boolean, mine: Mine, file: string): { doc: Obj; parts: string[]; old: boolean } {
  const { backed, had } = earlier(file);
  const parts: string[] = [];
  let next = doc;
  let old = false;
  if (target.server) {
    const servers = doc.mcpServers === undefined ? {} : doc.mcpServers;
    if (!isObj(servers)) throw new Odd(LAYOUT);
    const now = Object.hasOwn(servers, NAME) ? servers[NAME] : undefined;
    const want = !on ? undefined : isObj(now) && typeof now.command === 'string' ? { ...now, ...target.server } : target.server;
    if (!same(now, want)) {
      const rest = on ? { ...servers, [NAME]: want } : drop(servers, NAME);
      next = Object.keys(rest).length || had('mcpServers') ? { ...next, mcpServers: rest } : drop(next, 'mcpServers');
      parts.push(`the server ${NAME}`);
      old = now !== undefined;
    }
  }
  if (target.hooks) {
    const { events, nested, version, entry } = target.hooks;
    const hooks = doc.hooks === undefined ? {} : doc.hooks;
    if (!isObj(hooks)) throw new Odd(LAYOUT);
    const out: [string, unknown][] = [];
    let hit = false;
    for (const [event, items] of Object.entries(hooks)) {
      const wanted = on && events.includes(event);
      if (!Array.isArray(items)) {
        if (wanted) throw new Odd(LAYOUT);
        out.push([event, items]);
        continue;
      }
      const { kept, at } = strip(items, nested, mine);
      hit ||= at >= 0;
      if (wanted) kept.splice(at < 0 ? kept.length : at, 0, entry);
      if (kept.length || at < 0 || had('hooks', event)) out.push([event, kept]);
    }
    if (on) out.push(...events.filter((event) => !Object.hasOwn(hooks, event)).map((event): [string, unknown] => [event, [entry]]));
    const rest = Object.fromEntries(out);
    if ((on || hit) && !same(hooks, rest)) {
      next = out.length || had('hooks') ? { ...next, hooks: rest } : drop(next, 'hooks');
      if (on && version && !Object.hasOwn(next, 'version')) next = { version: 1, ...next };
      if (!on && version && next.version === 1 && !had('version') && (backed || !Object.hasOwn(next, 'hooks'))) next = drop(next, 'version');
      parts.push(`the ${NAME} hooks for ${list(events)}`);
      old ||= hit;
    }
  }
  return { doc: next, parts, old };
}

function json(target: Target, p: Paths, on: boolean, apps: string[]): Change[] {
  const hand = [
    target.server ? `add "${NAME}": ${JSON.stringify(target.server)} under mcpServers` : '',
    target.hooks ? `add ${JSON.stringify(target.hooks.entry)} under hooks for ${list(target.hooks.events)}` : '',
  ].filter(Boolean).join(' and ');
  const file = locate(target.file, p);
  if (file === null) return [alone(target.file, null, LINK, on, hand)];
  const before = read(file);
  if (before === null && !on) return [];
  try {
    const { doc, parts, old } = wire(before === null ? {} : strict(before), target, on, owned(p, apps), file);
    if (!parts.length) return [];
    const gone = !on && !Object.keys(doc).length && !fs.existsSync(file + BACKUP);
    const verb = before === null ? 'created' : gone ? 'gone' : !on ? 'removed' : old ? 'updated' : 'added';
    return [{ file, what: say(file, parts.join(' and '), verb, p.app), before, after: gone ? null : print(doc, before) }];
  } catch (error) {
    if (!(error instanceof Odd)) throw error;
    return on || MARK.test(before ?? '') ? [alone(file, before, error.message, on, hand)] : [];
  }
}

function key(line: string): { path: string[]; rest: string } | null {
  const path: string[] = [];
  let rest = line.trim();
  for (;;) {
    const part = /^([\w-]+)|^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(rest);
    if (!part) return null;
    path.push(part[1] ?? part[3] ?? String(loose(`"${part[2]}"`) ?? part[2]));
    rest = rest.slice(part[0].length).trimStart();
    if (!rest.startsWith('.')) return { path, rest };
    rest = rest.slice(1).trimStart();
  }
}

function header(line: string): { path: string[]; array: boolean } | null {
  const text = line.trim();
  const array = text.startsWith('[[');
  const close = array ? ']]' : ']';
  const found = text.startsWith('[') ? key(text.slice(close.length)) : null;
  if (!found?.rest.startsWith(close)) return null;
  const tail = found.rest.slice(close.length).trim();
  return tail === '' || tail.startsWith('#') ? { path: found.path, array } : null;
}

function strings(value: string): string[] | null {
  const out: string[] = [];
  const rest = value.replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g, (_token, basic: string | undefined, literal: string | undefined) => {
    out.push(literal ?? String(loose(`"${basic}"`) ?? basic));
    return '';
  });
  return /^\[?[\s,]*\]?\s*(#.*)?$/.test(rest.trim()) ? out : null;
}

function survey(text: string) {
  const lines = text.split('\n');
  const all: Part[] = [{ path: [], array: false, from: -1, to: lines.length }];
  lines.forEach((line, at) => {
    const head = header(line);
    if (!head) return;
    all[all.length - 1].to = at;
    all.push({ ...head, from: at, to: lines.length });
  });
  const end = (part: Part): number => {
    let to = part.to;
    while (to > part.from + 1 && idle(lines[to - 1])) to -= 1;
    return to;
  };
  const pairs = (part: Part): (Pair | null)[] =>
    lines.slice(part.from + 1, end(part)).map((line) => {
      const found = key(line);
      return found?.rest.startsWith('=') ? { name: found.path.join('.'), full: [...part.path, ...found.path], value: found.rest.slice(1) } : null;
    });
  const mine = all.filter((part) => ours(part.path));
  const main = mine.filter((part) => part.path.length === 2 && !part.array);
  const inline = (pair: Pair | null): boolean => pair !== null && (ours(pair.full) || (pair.full.join() === 'mcp_servers' && pair.value.includes(NAME)));
  const clash = main.length > 1 || mine.some((part) => part.array) || all.some((part) => !ours(part.path) && pairs(part).some(inline));
  const cut = (): string => {
    const gone = new Set<number>();
    for (const part of mine) {
      for (let at = part.from; at < end(part); at += 1) gone.add(at);
      if (part.from > 0 && lines[part.from - 1].trim() === '') gone.add(part.from - 1);
    }
    return lines.filter((_line, at) => !gone.has(at)).join('\n');
  };
  return { lines, end, pairs, mine, main: main.at(0), clash, cut };
}

function toml(target: string, p: Paths, on: boolean, args: string[]): Change[] {
  const rows = [`[mcp_servers.${NAME}]`, `command = ${quote(p.node)}`, `args = [${args.map(quote).join(', ')}]`];
  const hand = `add the table ${rows[0]} with ${rows[1]} and ${rows[2]}`;
  const things = `the table mcp_servers.${NAME}`;
  const file = locate(target, p);
  if (file === null) return [alone(target, null, LINK, on, hand)];
  const before = read(file);
  if (before === null) return on ? [{ file, what: say(file, things, 'created', p.app), before, after: `${rows.join('\n')}\n` }] : [];
  const { lines, end, pairs, mine, main, clash, cut } = survey(before);
  if (clash) return [alone(file, before, UNSAFE, on, hand)];
  if (!on) {
    if (!mine.length) return [];
    const text = cut();
    const gone = text.trim() === '' && !fs.existsSync(file + BACKUP);
    return [{ file, what: say(file, things, gone ? 'gone' : 'removed', p.app), before, after: gone ? null : text }];
  }
  const body = main ? pairs(main) : [];
  const values = (name: string): (string[] | null)[] => body.flatMap((pair) => (pair?.name === name ? [strings(pair.value)] : []));
  if (same(values('command'), [[p.node]]) && same(values('args'), [args])) return [];
  const cr = before.includes('\r\n') ? '\r' : '';
  const fresh = rows.map((row) => row + cr);
  const what = say(file, things, mine.length ? 'updated' : 'added', p.app);
  if (main && values('command').length) {
    const from = main.from + 1;
    const old = lines.slice(from, end(main));
    if (!old.every((line, at) => body[at] || idle(line))) return [alone(file, before, UNSAFE, on, hand)];
    const rest = old.filter((_line, at) => !['command', 'args'].includes(body[at]?.name ?? ''));
    return [{ file, what, before, after: [...lines.slice(0, from), ...fresh.slice(1), ...rest, ...lines.slice(end(main))].join('\n') }];
  }
  const text = cut();
  const gap = text === '' || text.endsWith('\n') ? '' : `${cr}\n`;
  return [{ file, what, before, after: `${text}${gap}${text.trim() === '' ? '' : `${cr}\n`}${fresh.join('\n')}\n` }];
}

function plugin(p: Paths, on: boolean): Change[] {
  const record = dig(loose(load(join(p.home, '.claude', 'plugins', 'installed_plugins.json'), p)), 'plugins');
  const known = isObj(record) ? Object.keys(record).some((name) => name.split('@')[0] === NAME) : null;
  if (known === on) return [];
  const run = on ? ['claude', 'plugin', 'install', NAME, '--marketplace', `sohan-bhat/${NAME}`] : ['claude', 'plugin', 'uninstall', NAME];
  const what = `The plugin ${NAME} is ${on ? 'installed in' : 'removed from'} Claude Code with the command ${run.join(' ')}.`;
  return [{ file: '', what, before: null, after: null, run }];
}

function changes(agent: Agent, p: Paths, on: boolean): Change[] {
  if (agent === 'claude-code') return plugin(p, on);
  const args = [p.app, 'mcp', '--agent', agent];
  const server: Obj = { command: p.node, args };
  if (agent === 'claude-desktop') return json({ file: desktop(p), server }, p, on, [p.app]);
  const folder = join(p.home, `.${agent}`);
  const run: Obj = { type: 'command', command: `${word(p.node, p)} ${word(p.app, p)} ${HOOK} ${agent}` };
  if (agent === 'cursor') {
    const file = join(folder, 'mcp.json');
    const apps = [p.app, ...former(dig(loose(load(file, p)), 'mcpServers', NAME, 'args'))];
    const hooks: Hooks = { events: ['sessionStart', 'beforeSubmitPrompt', 'postToolUse', 'afterAgentResponse', 'stop'], nested: false, version: true, entry: { command: run.command } };
    return [...json({ file, server: { type: 'stdio', ...server } }, p, on, apps), ...json({ file: join(folder, 'hooks.json'), hooks }, p, on, apps)];
  }
  if (agent === 'codex') {
    const file = join(folder, 'config.toml');
    const table = survey(load(file, p) ?? '');
    const apps = [p.app, ...(table.main ? table.pairs(table.main).flatMap((pair) => (pair?.name === 'args' ? former(strings(pair.value)) : [])) : [])];
    const hooks: Hooks = { events: ['UserPromptSubmit', 'PostToolUse', 'Stop'], nested: true, version: false, entry: { hooks: [run] } };
    return [...toml(file, p, on, args), ...json({ file: join(folder, 'hooks.json'), hooks }, p, on, apps)];
  }
  const file = join(folder, 'settings.json');
  const apps = [p.app, ...former(dig(loose(load(file, p)), 'mcpServers', NAME, 'args'))];
  const hooks: Hooks = { events: ['BeforeAgent', 'AfterTool', 'AfterAgent'], nested: true, version: false, entry: { hooks: [{ name: NAME, ...run }] } };
  return json({ file, server, hooks }, p, on, apps);
}

export function detect(p: Paths): Agent[] {
  const marks: [Agent, string[]][] = [
    ['claude-code', [join(p.home, '.claude'), join(p.home, '.claude.json')]],
    ['cursor', [join(p.home, '.cursor')]],
    ['codex', [join(p.home, '.codex')]],
    ['gemini', [join(p.home, '.gemini', 'settings.json')]],
    ['claude-desktop', [dirname(desktop(p))]],
  ];
  return marks.filter(([, files]) => files.some((file) => fs.existsSync(file))).map(([agent]) => agent);
}

export function plan(agent: Agent, p: Paths): Change[] {
  return changes(agent, p, true);
}

export function unplan(agent: Agent, p: Paths): Change[] {
  return changes(agent, p, false);
}

export function apply(changes: Change[]): void {
  const edits = changes.filter((change) => !change.run && change.after !== change.before);
  for (const { file, before } of edits) {
    if (read(file) !== before) throw new Error(`${file} changed after the plan was made, so nothing was written.`);
  }
  for (const { file, before, after } of edits) {
    if (after === null) {
      fs.unlinkSync(file);
      continue;
    }
    fs.mkdirSync(dirname(file), { recursive: true });
    const mode = before === null ? 0o600 : fs.statSync(file).mode & 0o7777;
    if (before !== null && !MARK.test(before) && !fs.existsSync(file + BACKUP)) {
      fs.copyFileSync(file, file + BACKUP);
      fs.chmodSync(file + BACKUP, mode);
    }
    const temp = `${file}.${NAME}-tmp`;
    try {
      fs.writeFileSync(temp, after, { mode });
      fs.chmodSync(temp, mode);
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
}
