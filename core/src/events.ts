import { cut, type CardBody, type DroppedBody, type HandoffBody } from './model.ts';

export type EvType = 'start' | 'prompt' | 'edit' | 'command' | 'stop' | 'compact' | 'end';
export interface Ev { t: EvType; at: number; text?: string; path?: string; ok?: boolean }

const WINDOW = 5000;
const COMMAND_PROMPT = /^[/!#]/;
const BUILD_WORDS = /\b(?:test|tests|build|lint|deploy|migrate|install)\b/i;
const FAILED = ' exit failed';

function fnv(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function eventKey(session: string, ev: Ev): string {
  const s = [session, ev.t, ev.text ?? '', ev.path ?? '', String(Math.floor((ev.at || 0) / WINDOW))].join('\u0001');
  return fnv(s, 0x811c9dc5) + fnv(s, 0x9dc5811c);
}

function ordered(events: Ev[]): Ev[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.at || 0) - (b.e.at || 0) || a.i - b.i)
    .map((x) => x.e);
}

function said(e: Ev): string {
  return (e.text ?? '').trim();
}

function prompts(events: Ev[]): Ev[] {
  return events.filter((e) => e.t === 'prompt' && said(e));
}

function newestDistinct(values: string[], n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = values.length - 1; i >= 0 && out.length < n; i--) {
    const v = values[i];
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.reverse();
}

function editPaths(events: Ev[]): string[] {
  return events.filter((e) => e.t === 'edit' && e.path && e.path.trim()).map((e) => (e.path as string).trim());
}

function lastStop(events: Ev[]): Ev | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].t === 'stop' && said(events[i])) return events[i];
  return undefined;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function commandList(events: Ev[]): string[] {
  const runs = new Map<string, { n: number; failed: boolean; lastOk: boolean | undefined; at: number }>();
  for (const e of events) {
    if (e.t !== 'command') continue;
    const c = said(e);
    if (!c) continue;
    const r = runs.get(c) ?? { n: 0, failed: false, lastOk: undefined, at: 0 };
    r.n++;
    if (e.ok === false) r.failed = true;
    r.lastOk = e.ok;
    r.at = e.at;
    runs.delete(c);
    runs.set(c, r);
  }
  const kept = [...runs.entries()].filter(([c, r]) => r.n >= 2 || r.failed || BUILD_WORDS.test(c));
  return kept.slice(-8).map(([c, r]) => cut(c, 120) + (r.lastOk === false ? FAILED : ''));
}

export function autoCard(events: Ev[]): CardBody | null {
  const evs = ordered(events ?? []);
  const asked = prompts(evs).filter((e) => !COMMAND_PROMPT.test(said(e)));
  const paths = editPaths(evs);
  if (!asked.length && !paths.length) return null;
  const changed = newestDistinct(paths, 20);
  const goal = asked.length ? cut(said(asked[0]), 200) : cut(`Changed ${changed.slice(-3).map(baseName).join(', ')}`, 200);
  const card: CardBody = { goal };
  const recent = newestDistinct(asked.map((e) => cut(said(e), 200)), 6);
  if (recent.length) card.prompts = recent;
  if (changed.length) card.changed = changed.map((path) => ({ path }));
  const commands = commandList(evs);
  if (commands.length) card.commands = commands;
  const stop = lastStop(evs);
  if (stop) card.last = cut(said(stop), 600);
  card.auto = true;
  return card;
}

export function autoHandoff(events: Ev[]): HandoffBody | null {
  const evs = ordered(events ?? []);
  const asked = prompts(evs);
  if (!asked.length) return null;
  const newest = asked[asked.length - 1];
  const after = evs.slice(evs.lastIndexOf(newest) + 1);
  const answered = after.some((e) => e.t === 'stop' && said(e));
  const next = answered ? 'No open request.' : `Unfinished request. ${cut(said(newest), 300)}`;
  const body: HandoffBody = { goal: cut(said(asked[0]), 200), next };
  const stop = lastStop(evs);
  if (stop) body.done = cut(said(stop), 400);
  const files = newestDistinct(editPaths(evs), 8);
  if (files.length) body.files = files;
  body.auto = true;
  return body;
}

export function droppedAt(events: Ev[], compactAt: number): DroppedBody[] {
  const evs = ordered(events ?? []).filter((e) => (e.at || 0) < compactAt);
  const out: DroppedBody[] = [];
  const files = new Set<string>();
  for (let i = evs.length - 1; i >= 0 && out.length < 40; i--) {
    const e = evs[i];
    if (e.t === 'prompt' && said(e)) out.push({ label: 'prompt', text: cut(said(e), 300), size: said(e).length });
    else if (e.t === 'stop' && said(e)) out.push({ label: 'agent message', text: cut(said(e), 300), size: said(e).length });
    else if (e.t === 'edit' && e.path && e.path.trim() && !files.has(e.path.trim())) {
      const p = e.path.trim();
      files.add(p);
      out.push({ label: 'file', text: cut(p, 300), size: p.length });
    }
  }
  return out;
}
