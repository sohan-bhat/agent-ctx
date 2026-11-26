import type { CardBody, DroppedBody, HandoffBody, Item, RuleBody } from './types';
import { ruleLine } from '@core/rules.ts';
import { count, stamp } from './format';

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
