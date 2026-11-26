import { strToU8, zipSync } from 'fflate';
import { projectName, type HandoffBody, type Item } from '../../core/src/index.ts';
import type { AgentRow } from './store.ts';

const README = [
  'This folder is an export of one agent-ctx memory.',
  'Each folder under projects holds items.jsonl with one item per line and handoff.md with the newest handoff.',
  'The file rules.jsonl holds the rules and agents.jsonl holds the connected agents.',
].join('\n');

function folderOf(key: string, used: Set<string>): string {
  const base = (projectName(key) || 'project').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 60) || 'project';
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
  used.add(name);
  return name;
}

function lines(items: unknown[]): Uint8Array {
  return strToU8(items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''));
}

function handoffMarkdown(name: string, h: Item): string {
  const b = h.body as HandoffBody;
  const out = [`# Handoff for ${name}`, '', `Written by ${h.origin?.agent ?? 'an agent'} on ${new Date(h.created).toISOString().slice(0, 10)}.`];
  const part = (title: string, text?: string) => {
    if (text) out.push('', `## ${title}`, '', text);
  };
  const list = (title: string, xs?: string[]) => {
    if (xs?.length) out.push('', `## ${title}`, '', ...xs.map((x) => `- ${x}`));
  };
  part('Question', b.question);
  part('Goal', b.goal);
  part('Done', b.done);
  part('Next', b.next);
  list('Blockers', b.blockers);
  list('Files', b.files);
  part('Check', b.check);
  return out.join('\n') + '\n';
}

export function buildExport(o: { items: Item[]; projects: { key: string; name: string }[]; agents: AgentRow[] }): Uint8Array {
  const files: Record<string, Uint8Array> = { 'agent-ctx/README.md': strToU8(README + '\n') };
  const used = new Set<string>();
  const keys = [...new Set([...o.projects.map((p) => p.key), ...o.items.filter((i) => i.kind !== 'rule').map((i) => i.project)])];
  for (const key of keys) {
    const items = o.items.filter((i) => i.kind !== 'rule' && i.project === key);
    if (!items.length && !o.projects.some((p) => p.key === key)) continue;
    const folder = `agent-ctx/projects/${folderOf(key, used)}`;
    files[`${folder}/items.jsonl`] = lines(items);
    const handoff = items.filter((i) => i.kind === 'handoff').sort((a, b) => b.created - a.created)[0];
    if (handoff) files[`${folder}/handoff.md`] = strToU8(handoffMarkdown(projectName(key) || key, handoff));
  }
  files['agent-ctx/rules.jsonl'] = lines(o.items.filter((i) => i.kind === 'rule'));
  files['agent-ctx/agents.jsonl'] = lines(o.agents);
  return zipSync(files);
}
