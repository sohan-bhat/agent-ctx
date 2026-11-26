import test from 'node:test';
import assert from 'node:assert/strict';
import { autoCard, autoHandoff, droppedAt, eventKey, type Ev } from '../src/events.ts';

const T = Date.parse('2026-11-14T08:00:00Z');
const s = (k: number) => T + k * 60000;

test('the same event sent twice gives one key', () => {
  const ev: Ev = { t: 'prompt', at: s(1), text: 'Add the gust filter' };
  assert.equal(eventKey('sess-1', ev), eventKey('sess-1', { ...ev }));
  assert.match(eventKey('sess-1', ev), /^[0-9a-f]{16}$/);
});

test('the key rounds the time down to five seconds', () => {
  const base = Math.floor(s(1) / 5000) * 5000;
  const a: Ev = { t: 'edit', at: base + 100, path: 'src/wind.c' };
  assert.equal(eventKey('x', a), eventKey('x', { ...a, at: base + 4900 }));
  assert.notEqual(eventKey('x', a), eventKey('x', { ...a, at: base + 5100 }));
});

test('session, type, text and path each change the key', () => {
  const a: Ev = { t: 'command', at: s(2), text: 'make test', path: 'a' };
  const k = eventKey('x', a);
  assert.notEqual(k, eventKey('y', a));
  assert.notEqual(k, eventKey('x', { ...a, t: 'prompt' }));
  assert.notEqual(k, eventKey('x', { ...a, text: 'make lint' }));
  assert.notEqual(k, eventKey('x', { ...a, path: 'b' }));
});

test('autoCard gives null with no prompt and no edit', () => {
  assert.equal(autoCard([]), null);
  assert.equal(autoCard([{ t: 'command', at: s(1), text: 'ls' }, { t: 'stop', at: s(2), text: 'done' }, { t: 'prompt', at: s(3), text: '   ' }]), null);
});

test('autoCard builds goal, prompts, changes, commands and last from the events', () => {
  const long = 'Make the station report wind gusts every ten seconds. '.repeat(8);
  const evs: Ev[] = [
    { t: 'start', at: s(0) },
    { t: 'prompt', at: s(1), text: long },
    { t: 'edit', at: s(2), path: 'src/wind.c' },
    { t: 'command', at: s(3), text: 'ls src', ok: true },
    { t: 'command', at: s(4), text: 'make test', ok: false },
    { t: 'command', at: s(5), text: 'git status', ok: true },
    { t: 'command', at: s(6), text: 'git status', ok: true },
    { t: 'command', at: s(7), text: './flash.sh', ok: false },
    { t: 'command', at: s(8), text: 'pio run --target upload', ok: true },
    { t: 'stop', at: s(9), text: 'First pass done.' },
    { t: 'edit', at: s(10), path: 'src/wind.c' },
    { t: 'edit', at: s(11), path: 'src/gust.c' },
    { t: 'command', at: s(12), text: 'make test', ok: true },
    { t: 'command', at: s(13), text: 'npm install --save-dev vitest', ok: true },
    { t: 'stop', at: s(14), text: 'Gusts now report. '.repeat(50) },
  ];
  const c = autoCard(evs)!;
  assert.equal(c.auto, true);
  assert.ok(c.goal.length <= 200 && c.goal.startsWith('Make the station report'));
  assert.equal(c.prompts?.length, 1);
  assert.deepEqual(c.changed, [{ path: 'src/wind.c' }, { path: 'src/gust.c' }]);
  assert.deepEqual(c.commands, ['git status', './flash.sh exit failed', 'make test', 'npm install --save-dev vitest']);
  assert.ok(c.last!.length <= 600 && c.last!.startsWith('Gusts now report.'));
});

test('autoCard keeps the newest six distinct prompts in order, each cut to 200', () => {
  const evs: Ev[] = [];
  for (let k = 0; k < 9; k++) evs.push({ t: 'prompt', at: s(k), text: `step ${k} ` + 'x'.repeat(k === 8 ? 400 : 1) });
  evs.push({ t: 'prompt', at: s(20), text: 'step 7 x' });
  const c = autoCard(evs)!;
  assert.equal(c.goal, 'step 0 x');
  assert.equal(c.prompts?.length, 6);
  assert.deepEqual(c.prompts?.slice(0, 4), ['step 3 x', 'step 4 x', 'step 5 x', 'step 6 x']);
  assert.ok(c.prompts![4].startsWith('step 8') && c.prompts![4].length <= 200);
  assert.equal(c.prompts![5], 'step 7 x');
});

test('autoCard keeps the newest 20 distinct paths and at most eight commands cut to 120', () => {
  const evs: Ev[] = [{ t: 'prompt', at: s(0), text: 'Refactor the board drivers' }];
  for (let k = 0; k < 30; k++) evs.push({ t: 'edit', at: s(1 + k), path: `src/drivers/d${k}.c` });
  for (let k = 0; k < 12; k++) evs.push({ t: 'command', at: s(40 + k), text: `make test-${k} ` + 'y'.repeat(200), ok: true });
  const c = autoCard(evs)!;
  assert.equal(c.changed?.length, 20);
  assert.deepEqual([c.changed![0].path, c.changed![19].path], ['src/drivers/d10.c', 'src/drivers/d29.c']);
  assert.equal(c.commands?.length, 8);
  assert.ok(c.commands!.every((x) => x.length <= 120));
  assert.ok(c.commands![0].startsWith('make test-4'));
});

test('autoCard with only edits names the files in the goal', () => {
  const c = autoCard([{ t: 'edit', at: s(1), path: '/w/app/src/form.tsx' }])!;
  assert.equal(c.goal, 'Changed form.tsx');
  assert.equal(c.prompts, undefined);
});

test('autoCard reads events in time order even when they arrive out of order', () => {
  const c = autoCard([
    { t: 'stop', at: s(5), text: 'newest stop' },
    { t: 'prompt', at: s(3), text: 'second prompt' },
    { t: 'prompt', at: s(1), text: 'first prompt' },
    { t: 'stop', at: s(2), text: 'older stop' },
  ])!;
  assert.equal(c.goal, 'first prompt');
  assert.equal(c.last, 'newest stop');
});

test('autoHandoff gives null with no prompt', () => {
  assert.equal(autoHandoff([{ t: 'edit', at: s(1), path: 'a.c' }, { t: 'stop', at: s(2), text: 'done' }]), null);
});

test('autoHandoff marks the newest prompt as unfinished when no stop follows', () => {
  const h = autoHandoff([
    { t: 'prompt', at: s(1), text: 'Add the rain gauge driver' },
    { t: 'edit', at: s(2), path: 'src/rain.c' },
    { t: 'stop', at: s(3), text: 'Driver added and tested.' },
    { t: 'prompt', at: s(4), text: 'Now calibrate the tipping bucket ' + 'z'.repeat(400) },
    { t: 'edit', at: s(5), path: 'src/cal.c' },
  ])!;
  assert.equal(h.goal, 'Add the rain gauge driver');
  assert.equal(h.done, 'Driver added and tested.');
  assert.ok(h.next.startsWith('Unfinished request. Now calibrate the tipping bucket'));
  assert.ok(h.next.length <= 'Unfinished request. '.length + 300);
  assert.deepEqual(h.files, ['src/rain.c', 'src/cal.c']);
  assert.equal(h.auto, true);
});

test('autoHandoff says no open request when a stop follows the newest prompt', () => {
  const h = autoHandoff([
    { t: 'prompt', at: s(1), text: 'Fix the login redirect' },
    { t: 'stop', at: s(2), text: 'x'.repeat(900) },
  ])!;
  assert.equal(h.next, 'No open request.');
  assert.ok(h.done!.length <= 400);
});

test('autoHandoff keeps the newest eight files', () => {
  const evs: Ev[] = [{ t: 'prompt', at: s(0), text: 'Split the form' }];
  for (let k = 0; k < 12; k++) evs.push({ t: 'edit', at: s(1 + k), path: `f${k}.ts` });
  assert.deepEqual(autoHandoff(evs)!.files, ['f4.ts', 'f5.ts', 'f6.ts', 'f7.ts', 'f8.ts', 'f9.ts', 'f10.ts', 'f11.ts']);
});

test('droppedAt lists prompts, distinct files and agent messages before the compaction, newest first', () => {
  const evs: Ev[] = [
    { t: 'prompt', at: s(1), text: 'Plan the opening book' },
    { t: 'edit', at: s(2), path: 'src/book.rs' },
    { t: 'command', at: s(3), text: 'cargo test', ok: true },
    { t: 'edit', at: s(4), path: 'src/book.rs' },
    { t: 'stop', at: s(5), text: 'Book loads from a PGN file.' },
    { t: 'compact', at: s(6), text: 'summary' },
    { t: 'prompt', at: s(7), text: 'After the compaction' },
  ];
  assert.deepEqual(droppedAt(evs, s(6)), [
    { label: 'agent message', text: 'Book loads from a PGN file.', size: 27 },
    { label: 'file', text: 'src/book.rs', size: 11 },
    { label: 'prompt', text: 'Plan the opening book', size: 21 },
  ]);
});

test('droppedAt keeps the original size, cuts the text and stops at 40', () => {
  const evs: Ev[] = [];
  for (let k = 0; k < 60; k++) evs.push({ t: 'prompt', at: s(k), text: `prompt ${k} ` + 'w'.repeat(500) });
  const out = droppedAt(evs, s(100));
  assert.equal(out.length, 40);
  assert.ok(out[0].text.startsWith('prompt 59'));
  assert.equal(out[0].size, `prompt 59 `.length + 500);
  assert.ok(out.every((d) => d.text.length <= 300));
});
