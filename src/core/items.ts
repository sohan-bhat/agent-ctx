import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readJsonl, writeJsonl } from './fsx.ts';
import { withQuickLock } from './lock.ts';
import { cut } from './records.ts';
import { redact } from './redact.ts';
import type { Store } from './paths.ts';

export type ItemKind = 'file' | 'command' | 'decision' | 'note';

export interface Item {
  id: string;
  session: string;
  kind: ItemKind;
  label: string;
  text: string;
  at: string;
}

export const ITEM_TEXT_CAP = 1500;

export function makeItem(session: string, kind: ItemKind, label: string, text: string): Item {
  return {
    id: randomUUID(),
    session,
    kind,
    label: cut(redact(label), 200),
    text: cut(redact(text), ITEM_TEXT_CAP),
    at: new Date().toISOString(),
  };
}

function edit(file: string, fn: (rows: Item[]) => Item[] | null, waitMs = 40): Item[] | null {
  return withQuickLock(
    `${file}.lock`,
    () => {
      const rows = readJsonl<Item>(file);
      const next = fn(rows);
      if (next) writeJsonl(file, next);
      return rows;
    },
    waitMs,
  );
}

export function enqueue(st: Store, item: Item): boolean {
  return edit(st.queue, (rows) => (rows.some((r) => r.id === item.id) ? rows : [...rows, item]), 500) !== null;
}

export function drainQueue(st: Store, session: string): Item[] {
  if (!fs.existsSync(st.queue)) return [];
  let taken: Item[] = [];
  edit(st.queue, (rows) => {
    taken = rows.filter((r) => r.session === session);
    return taken.length ? rows.filter((r) => r.session !== session) : null;
  });
  return taken;
}

export function queued(st: Store, session?: string): Item[] {
  const rows = readJsonl<Item>(st.queue);
  return session ? rows.filter((r) => r.session === session) : rows;
}

export function pin(st: Store, item: Item): boolean {
  return edit(st.pins, (rows) => (rows.some((r) => r.session === item.session && r.label === item.label) ? rows : [...rows, item]), 500) !== null;
}

export function unpin(st: Store, id: string): boolean {
  return edit(st.pins, (rows) => rows.filter((r) => r.id !== id), 500) !== null;
}

export function pruneItems(st: Store, keep: (it: Item) => boolean): number {
  let dropped = 0;
  for (const file of [st.queue, st.pins]) {
    if (!fs.existsSync(file)) continue;
    edit(
      file,
      (rows) => {
        const next = rows.filter(keep);
        dropped += rows.length - next.length;
        return next.length === rows.length ? null : next;
      },
      500,
    );
  }
  return dropped;
}

export function pinsFor(st: Store, session: string): Item[] {
  return readJsonl<Item>(st.pins).filter((r) => r.session === session || r.session === '*');
}

export function renderItem(it: Item): string {
  if (it.kind === 'file') return `- File ${it.label}, worth a fresh read before use${it.text ? `\n  ${it.text.replace(/\n/g, '\n  ')}` : ''}`;
  if (it.kind === 'command') return `- Command \`${it.label}\` gave this output earlier\n\`\`\`\n${it.text}\n\`\`\``;
  if (it.kind === 'decision') return `- Decision from an earlier prompt: "${it.text}"`;
  return `- ${it.label}: ${it.text}`;
}

export function renderPutBack(items: Item[], cap: number): string {
  if (!items.length) return '';
  const head = 'Put back by claude-ctx at the person\'s request, from before a compaction.';
  const parts = [head];
  let used = head.length;
  for (const it of items) {
    const r = renderItem(it);
    if (used + r.length + 1 > cap) break;
    parts.push(r);
    used += r.length + 1;
  }
  return parts.join('\n');
}

export function renderPins(items: Item[], cap: number): string {
  if (!items.length) return '';
  const head = 'Keep these pinned items in the summary, close to word for word.';
  const parts = [head];
  let used = head.length;
  for (const it of items) {
    const r = renderItem(it);
    if (used + r.length + 1 > cap) break;
    parts.push(r);
    used += r.length + 1;
  }
  return parts.join('\n');
}
