import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scratch } from './synth.ts';
import { store } from '../src/core/paths.ts';
import { loadIndex, writeCardsAndIndex } from '../src/core/store.ts';
import { rankPrompt } from '../src/core/rank.ts';
import { cleanSummary, summaryLine } from '../src/core/records.ts';
import { renderCard, renderCards } from '../src/core/format.ts';
import type { Card } from '../src/core/session.ts';

const now = Date.parse('2026-11-20T00:00:00Z');

function card(id: string, place: string, title: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    session: id,
    part: 1,
    parts: 1,
    place,
    git: true,
    project: path.basename(place),
    places: [{ path: place, git: true, prompts: 1, edits: 1 }],
    first: '2026-11-10T10:00:00Z',
    last: '2026-11-10T12:00:00Z',
    title,
    summaries: [],
    prompts: [],
    files: [],
    transcript: `/x/${id}.jsonl`,
    turns: 1,
    ...extra,
  };
}

function storeOf(): ReturnType<typeof loadIndex> {
  const st = store(scratch('recall'));
  const cards = [
    card('kiln', '/code/kiln-log', 'Kiln firing log', { summaries: ['Logged cone six firings and plotted the cooling curve for the glaze kiln'], files: ['/code/kiln-log/src/cooling.ts'], firstPrompt: 'Plot the kiln cooling curve' }),
    card('loom', '/code/loom-draft', 'Loom threading drafts', { summaries: ['Drew threading drafts for an eight shaft loom and checked the treadle tie up'], firstPrompt: 'Draft a twill on the loom' }),
    card('sail', '/code/sail-trim', 'Sail trim calculator', { summaries: ['Computed sail area and mast rake for the dinghy and added a page with a dark mode'], firstPrompt: 'Compute the sail area' }),
    card('hives', '/code/hive-scale', 'Hive scale readings', { summaries: ['Read the hive scale over serial and charted nectar flow by week, next step is the winter page'], firstPrompt: 'Chart the hive weight' }),
    card('menu', '/code/menu-cards', 'Menu card layout', { summaries: ['Laid out menu cards with a serif font, a cream palette and a hero photo on the home page'], firstPrompt: 'Lay out the menu cards' }),
  ];
  for (let i = 0; i < 40; i++) cards.push(card(`f${i}`, `/code/filler-${i}`, `Filler ${i}`, { summaries: [`Kept notes for project ${i} and checked the next steps, the page and the tests`] }));
  writeCardsAndIndex(st, cards);
  return loadIndex(st);
}

test('a prompt with no distinctive words adds nothing', () => {
  const ix = storeOf()!;
  for (const p of [
    'ok did that, what next',
    'sounds good, go ahead',
    'yes do that',
    'can you fix it',
    'what do you think',
    'continue',
    'looks good, now the next step',
    'that did not work, try again',
    'great, check the page and run the tests',
  ]) {
    assert.deepEqual(rankPrompt(ix, p, now), [], p);
  }
});

test('a long prompt that shares a few everyday design words with an unrelated card adds nothing', () => {
  const ix = storeOf()!;
  const p =
    'For the harbour cafe landing I want a warmer serif font, a hero photo of the boats at dusk, a cream palette with one rust accent, wider margins around the opening hours and a footer with the booking phone number';
  assert.deepEqual(rankPrompt(ix, p, now), []);
});

test('a specific prompt still finds its card', () => {
  const ix = storeOf()!;
  const want: [string, string][] = [
    ['the kiln cooling curve looks off after the last cone six firing', 'kiln'],
    ['add a treadle tie up check to the loom threading draft', 'loom'],
    ['the hive scale serial reading drops nectar flow weeks', 'hives'],
    ['mast rake for the dinghy sail', 'sail'],
  ];
  for (const [p, id] of want) {
    const hits = rankPrompt(ix, p, now);
    assert.ok(hits.length > 0, p);
    assert.equal(ix.docs[hits[0].doc].id, id, p);
  }
});

const junk = [
  'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.',
  '',
  'Summary:',
  '1. Primary Request and Intent:',
  '   <system-reminder>Called the Read tool with the following input: a path</system-reminder> The person asked for a cooling curve chart for the kiln log, with cone markers.',
  '2. Key Technical Concepts:',
  '   - <tools-used-before-summary>Read, Edit, Bash, Grep</tools-used-before-summary>',
  '   - Recharts line chart, <div className="x">markup</div>',
  '3. Files and Code Sections:',
  '   - src/cooling.ts',
  '4. Errors and fixes:',
  '   - none',
  '8. Current Work:',
  '   Added cone markers to the cooling chart. <artifact-content-authored-by-others>notice text</artifact-content-authored-by-others>',
  '9. Optional Next Step:',
  '   Check the legend.',
  '',
  'If you need specific details from before compaction, read the full transcript at: /x/y.jsonl',
].join('\n');

test('a summary loses harness markup, tool lists, notices and stock headings', () => {
  const s = cleanSummary(junk);
  for (const bad of ['<', '>', 'system-reminder', 'tools-used', 'artifact', 'Called the Read tool', 'Primary Request', 'Key Technical', 'Current Work', 'continued from a previous', 'full transcript', 'Recharts']) {
    assert.ok(!s.includes(bad), `${bad} in ${s}`);
  }
  assert.ok(s.startsWith('The person asked for a cooling curve chart for the kiln log'));
  assert.ok(s.includes('Added cone markers to the cooling chart.'));
  const escaped = '\\<system-reminder\\>Tools used Read, Edit\\</system-reminder\\> Built the loom draft export.';
  assert.equal(cleanSummary(escaped), 'Built the loom draft export.');
  assert.equal(cleanSummary('&lt;system-reminder&gt;reminder body&lt;/system-reminder&gt; Fixed the hive scale offset.'), 'Fixed the hive scale offset.');
  assert.equal(cleanSummary('Moved the menu grid. <system-reminder>cut off before its end'), 'Moved the menu grid.');
  const flat = 'Summary: 1. Primary Request and Intent: Tune the sail calculator for light wind. 2. Key Technical Concepts: - TypeScript 8. Current Work: Wrote the light wind table.';
  assert.equal(summaryLine(flat), 'Tune the sail calculator for light wind.');
});

test('a card shows one clean summary line, never the same line twice, and falls back to title, folder, date and asked', () => {
  const c = card('kiln', '/code/kiln-log', 'Kiln firing log', {
    summaries: [junk, junk.replace('cone markers', 'a cone legend')],
    firstPrompt: 'Plot the kiln cooling curve',
    prompts: ['Plot the kiln cooling curve', 'Add cone markers'],
    files: ['/code/kiln-log/src/cooling.ts'],
  });
  const r = renderCard(c, 600);
  const lines = r.split('\n');
  assert.equal(new Set(lines).size, lines.length, 'no line twice');
  assert.equal(lines.filter((l) => l.startsWith('Summary')).length, 1);
  assert.ok(!/[<>]/.test(r) && !r.includes('Primary Request') && !r.includes('system-reminder'));
  assert.equal(r.match(/Plot the kiln cooling curve/g)?.length, 1, 'a prompt is quoted once');
  const empty = card('loom', '/code/loom-draft', 'Loom threading drafts', {
    summaries: ['<system-reminder>only harness text</system-reminder>', 'Summary:\n1. Primary Request and Intent:\n<tools-used-before-summary>Read</tools-used-before-summary>'],
    firstPrompt: 'Draft a twill on the loom',
    files: ['/code/loom-draft/twill.ts'],
  });
  const e = renderCard(empty, 600).split('\n');
  assert.deepEqual(e, ['## Loom threading drafts | loom-draft | 2026-11-10', 'Folder /code/loom-draft', 'Asked "Draft a twill on the loom"']);
  const block = renderCards([c, empty], 1500, 'Recall from claude-ctx for this prompt, as background only.');
  assert.ok(block.length <= 1500 && !/[<>]/.test(block));
});
