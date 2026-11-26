import { useEffect, useState } from 'react';
import { ruleLine } from '@core/model.ts';
import type { CardBody, DroppedBody, HandoffBody, Item, RuleBody } from './api';

export { cn } from 'cn';

function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return on;
}

export const useReduced = () => useMedia('(prefers-reduced-motion: reduce)');
export const useNarrow = () => useMedia('(max-width: 639px)');

export function since(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const STAMP = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const clock = (t: number) => CLOCK.format(t);
export const day = (t: number) => DAY.format(t);
export const stamp = (t: number) => STAMP.format(t);

const MB = [0, 1, 2].map((d) => new Intl.NumberFormat(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));

export function megabytes(bytes: number): string {
  const v = bytes / (1024 * 1024);
  return (v >= 10 ? MB[0] : v >= 0.1 || v === 0 ? MB[1] : MB[2]).format(v);
}

const COUNT = new Intl.NumberFormat();
export const count = (n: number) => COUNT.format(n);

export interface Line {
  text: string;
  mono?: boolean;
}

const bare = (s: string | undefined) => (s ?? '').trim().replace(/[.!?\s]+$/, '');
const sentence = (s: string | undefined) => {
  const b = bare(s);
  return b ? `${b}.` : '';
};
const first = (s: string | undefined) => {
  const b = sentence(s);
  return b ? `${b.charAt(0).toUpperCase()}${b.slice(1)}` : '';
};

export function headline(i: Item): string {
  if (i.kind === 'rule') return i.line ?? ruleLine(i.body as RuleBody);
  if (i.kind === 'dropped') return bare((i.body as DroppedBody).label);
  return bare((i.body as CardBody | HandoffBody).goal) || 'Untitled';
}

export function lines(i: Item): Line[] {
  const out: Line[] = [];
  const push = (text: string, mono = false) => {
    if (text) out.push({ text, mono });
  };
  if (i.kind === 'card') {
    const b = i.body as CardBody;
    push(first(b.goal));
    if (i.folded) return out;
    for (const d of b.decisions ?? []) push(d.why ? `Decided ${bare(d.what)} because ${sentence(d.why)}` : `Decided ${sentence(d.what)}`);
    for (const d of b.dead_ends ?? []) push(`Dead end ${sentence(d)}`);
    for (const o of b.open ?? []) push(`Open ${sentence(o)}`);
    if (b.changed?.length) push(b.changed.map((c) => (c.what ? `${c.path} ${bare(c.what)}` : c.path)).join('  '), true);
    for (const p of b.prompts ?? []) if (bare(p) !== bare(b.goal)) push(`Asked ${sentence(p)}`);
    if (b.commands?.length) push(b.commands.join('  '), true);
    if (b.last) push(`Agent said ${b.last}`);
  } else if (i.kind === 'handoff') {
    const b = i.body as HandoffBody;
    push(first(b.goal));
    if (b.done) push(`Done ${sentence(b.done)}`);
    push(`Next ${sentence(b.next)}`);
    if (b.blockers?.length) push(`Blocked by ${b.blockers.map(bare).join(', ')}.`);
    if (b.files?.length) push(b.files.join('  '), true);
    if (b.check) push(b.check, true);
  } else if (i.kind === 'rule') {
    const b = i.body as RuleBody;
    push(i.line ?? ruleLine(b));
    push(b.scope === 'all' ? 'All projects' : 'This project');
  } else {
    const b = i.body as DroppedBody;
    push(first(b.label));
    push(first(b.text));
    push(`${count(Number(b.size || 0))} characters`, true);
  }
  return out;
}

const HOW: Record<string, string> = { hook: 'hook', tool: 'tool call', page: 'page', import: 'import' };

export function originLine(i: Item): string {
  const who = i.origin.agent === 'page' ? 'you' : i.origin.agent;
  return `${who}  ${stamp(i.created)}  ${HOW[i.origin.via] ?? i.origin.via}`;
}

export function canPutBack(i: Item): boolean {
  return i.kind === 'card' || i.kind === 'handoff' || i.kind === 'dropped';
}

export function isPending(i: Item): boolean {
  return i.kind === 'rule' && (i.body as RuleBody).status === 'pending';
}
