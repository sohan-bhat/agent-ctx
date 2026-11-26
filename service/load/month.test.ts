import { env } from 'cloudflare:workers';
import { it, expect, vi } from 'vitest';
import { PROJECTS, month, type Label } from '../../core/test/month.ts';
import type { CardBody, Item } from '../../core/src/index.ts';
import { caller, devSignIn, open, send } from '../test/helpers.ts';

const SEED = Number((env as unknown as { MONTH_SEED?: string }).MONTH_SEED ?? '1');

interface Write { label: Label; id: string }

function text(b: CardBody): string {
  return JSON.stringify(b).toLowerCase().replace(/\s+/g, ' ');
}

it(`a month of use on seed ${SEED}`, async () => {
  const m = month(SEED);
  const name = `month-${SEED}-${crypto.randomUUID().slice(0, 6)}`;
  const stub = env.PERSON.getByName(`dev-${name}`);
  await open(stub, { storeBytes: 50 * 1024 * 1024 });
  const who = [caller('Codex', `grant-month-a-${SEED}`), caller('Claude Code', `grant-month-b-${SEED}`)];
  const writes: Write[] = [];
  const chats = new Set<string>();
  let recalledStored = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    for (const step of m.steps) {
      vi.setSystemTime(step.at);
      const c = who[step.who];
      const where = { repo: PROJECTS[step.project].repo, folder: PROJECTS[step.project].folder };
      if (step.kind === 'checkpoint') {
        const r = await stub.checkpoint(c, { ...where, ...step.card });
        expect(r.ok, r.text).toBe(true);
        if (r.item) writes.push({ label: step.label, id: r.item.id });
      } else if (step.kind === 'recalled') {
        const answer = await stub.recall(c, { ...where, query: step.query }, true);
        const lines = answer.text.split('\n').filter((l) => l.startsWith('> '));
        if (!lines.length) continue;
        const r = await stub.checkpoint(c, { ...where, goal: lines[0], decisions: lines.slice(1, 4) });
        if (r.item) {
          writes.push({ label: step.label, id: r.item.id });
          recalledStored++;
        }
      } else {
        chats.add(`s-${step.session}`);
        const ev = (event: string, more: Record<string, string>) => stub.event(c, { host: step.who ? 'claude-code' : 'codex', event, session: step.session, cwd: where.folder, ...more });
        for (const prompt of step.prompts) await ev('UserPromptSubmit', { prompt });
        await ev('Stop', { message: step.stop });
        await ev('SessionEnd', {});
      }
    }
    vi.setSystemTime(m.end);
    const jar = await devSignIn(name);
    const space = (await (await send('/api/space', { headers: { Cookie: jar.header() } })).json()) as { items: Item[] };
    const cards = space.items.filter((i) => i.kind === 'card');
    const byId = new Map<string, Write[]>();
    for (const w of writes) byId.set(w.id, [...(byId.get(w.id) ?? []), w]);
    const pieceOf = (l: Label) => ('piece' in l ? l.piece : -1);
    const home = new Map<number, string>();
    for (const card of [...cards].sort((a, b) => a.created - b.created)) {
      const first = byId.get(card.id)?.[0];
      if (first && first.label.type === 'distinct' && !home.has(first.label.piece)) home.set(first.label.piece, card.id);
    }
    const junk = { repeat: 0, chat: 0, recalled: 0, other: 0 };
    let falseMerges = 0;
    for (const card of cards) {
      const ws = byId.get(card.id) ?? [];
      const pieces = new Set(ws.filter((w) => w.label.type !== 'recalled' && w.label.type !== 'chat').map((w) => pieceOf(w.label)));
      if (pieces.size > 1) falseMerges++;
      if (chats.has(card.origin?.session ?? '')) junk.chat++;
      else if (!ws.length) junk.other++;
      else if (ws[0].label.type === 'recalled') junk.recalled++;
      else if (ws[0].label.type !== 'distinct' && home.has(pieceOf(ws[0].label)) && home.get(pieceOf(ws[0].label)) !== card.id) junk.repeat++;
    }
    let kept = 0;
    const missed: number[] = [];
    for (const p of m.pieces) {
      const holder = cards.find((card) => p.facts.every((f) => text(card.body as CardBody).includes(f.toLowerCase())));
      let reached = false;
      if (holder) {
        const where = { repo: PROJECTS[p.project].repo, folder: PROJECTS[p.project].folder };
        const out = (await stub.recall(who[0], { ...where, query: p.query }, true)).text.split('\n').filter((l) => l.startsWith('> '));
        reached = out.some((l) => l.startsWith(`> ${holder.id.slice(0, 8)}`) || l.toLowerCase().includes(p.facts[0].toLowerCase()));
      }
      if (reached) kept++;
      else missed.push(p.n);
    }
    const junkTotal = junk.repeat + junk.chat + junk.recalled + junk.other;
    const result = { seed: SEED, stored: cards.length, junk: junkTotal, junkRate: Number((junkTotal / Math.max(1, cards.length)).toFixed(3)), byKind: junk, kept: Number((kept / m.pieces.length).toFixed(3)), keptCount: kept, missed, falseMerges, recalledStored };
    console.log(`MONTH ${JSON.stringify(result)}`);
    expect(cards.length).toBeGreaterThan(0);
  } finally {
    vi.useRealTimers();
  }
});
