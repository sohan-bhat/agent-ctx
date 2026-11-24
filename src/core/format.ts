import os from 'node:os';
import path from 'node:path';
import { cut, stripMarkup, summaryLine } from './records.ts';
import type { Card } from './session.ts';

const home = os.homedir();

export function tilde(p: string): string {
  return p === home ? '~' : p.startsWith(home + '/') ? '~' + p.slice(home.length) : p;
}

export function day(iso: string): string {
  return iso ? iso.slice(0, 10) : '';
}

export function shortFile(f: string, place: string): string {
  if (f.startsWith(place + '/')) return f.slice(place.length + 1);
  return tilde(f);
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function askedQuote(p: string): string {
  return cut(stripMarkup(p).replace(/\s+/g, ' ').trim(), 100);
}

export function promptTitle(p?: string): string | undefined {
  const s = p ? stripMarkup(p).replace(/\s+/g, ' ').trim() : '';
  if (!s || s.startsWith('/')) return undefined;
  return cut(s, 80);
}

export function cardSummary(c: Card): string {
  for (let i = c.summaries.length - 1; i >= 0; i--) {
    const line = summaryLine(c.summaries[i]);
    if (line) return line;
  }
  return '';
}

export function renderCard(c: Card, budget: number): string {
  const head = `## ${c.title ? cut(c.title, 90) : c.project} | ${c.project} | ${day(c.last)}`;
  const lines: string[] = [head, `Folder ${tilde(c.place)}${c.branch ? ` on ${c.branch}` : ''}`];
  const seen = new Set<string>([key(c.title || ''), key(c.project)]);
  const quotes: string[] = [];
  for (const p of [c.firstPrompt, c.prompts[c.prompts.length - 1]]) {
    if (!p) continue;
    const q = askedQuote(p);
    const k = key(q);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    quotes.push(`"${q}"`);
  }
  const askedLine = quotes.length ? `Asked ${quotes.join(' then ')}` : '';
  let sum = cardSummary(c);
  const sk = key(sum);
  if (!sk || seen.has(sk) || [...seen].some((k) => k.length > 20 && (k.includes(sk.slice(0, 60)) || sk.includes(k.slice(0, 60))))) sum = '';
  if (sum) lines.push(`Summary ${sum}`);
  if (askedLine) lines.push(askedLine);
  if (sum) {
    const files = c.files.slice(0, 5).map((f) => shortFile(f, c.place));
    if (files.length) lines.push(`Files ${files.join(', ')}`);
  }
  let out = lines.join('\n');
  if (out.length > budget) out = cut(out, budget);
  return out;
}

export function renderCards(cards: Card[], cap: number, header: string): string {
  if (!cards.length) return '';
  const parts: string[] = [header];
  let used = header.length;
  const per = Math.max(400, Math.floor((cap - header.length) / Math.min(cards.length, 5)) - 2);
  for (const c of cards) {
    const room = cap - used - 2;
    if (room < 200) break;
    const r = renderCard(c, Math.min(per, room));
    parts.push(r);
    used += r.length + 2;
  }
  const out = parts.join('\n\n');
  return out.length > cap ? out.slice(0, cap) : out;
}

export function placeLabel(p: string): string {
  return path.basename(p) || p;
}
