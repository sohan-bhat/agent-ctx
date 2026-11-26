import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { world, repo, Transcript } from './helpers.ts';
import { slim, SLIM_FROM } from '../src/core/slim.ts';
import { advance, newAnalyzer, step, timeline, wantedBytes } from '../src/core/context.ts';
import { parseLine } from '../src/core/records.ts';

const line = (r: unknown) => Buffer.from(JSON.stringify(r));
const big = (n: number) => 'line one "quoted" and a tab\tthen \\ a slash, café ✓\n'.repeat(Math.ceil(n / 50));
const png = Buffer.alloc(30000, 9).toString('base64');

test('long values the analysis never reads are blanked and every other value stays', () => {
  const r = {
    parentUuid: 'p',
    isSidechain: false,
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: big(20000) }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] }] },
    toolUseResult: { type: 'text', file: { filePath: '/r/a.ts', content: big(20000), nested: [[1, 2, { x: 'y' }], null, true, -1.5e3] } },
    uuid: 'u1',
  };
  const out = slim(line(r));
  const got = JSON.parse(out.toString());
  assert.equal(got.toolUseResult, null);
  assert.equal(got.message.content[0].content[1].source.data, '');
  assert.equal(got.message.content[0].content[0].text, r.message.content[0].content[0].text);
  assert.equal(got.uuid, 'u1');
  assert.ok(out.length < line(r).length / 2);
});

test('thinking text and signatures are blanked in replies while tool calls stay', () => {
  const r = { type: 'assistant', message: { id: 'm', content: [{ type: 'thinking', thinking: big(9000), signature: png }, { type: 'tool_use', id: 't', name: 'Read', input: { file_path: '/r/b.ts', data: 'short' } }], usage: { input_tokens: 5 } } };
  const got = JSON.parse(slim(line(r)).toString());
  assert.equal(got.message.content[0].thinking, '');
  assert.equal(got.message.content[0].signature, '');
  assert.deepEqual(got.message.content[1], r.message.content[1]);
  assert.deepEqual(got.message.usage, r.message.usage);
});

test('short, odd, broken and unrelated lines pass through untouched', () => {
  const attach = line({ type: 'attachment', attachment: { type: 'file', rendered: [{ type: 'image', source: { type: 'base64', data: png } }] } });
  assert.equal(slim(attach), attach);
  const short = line({ type: 'user', toolUseResult: { stdout: 'x'.repeat(100) } });
  assert.ok(short.length < SLIM_FROM);
  assert.equal(slim(short), short);
  const whole = line({ type: 'user', message: { content: 'hi' }, toolUseResult: { stdout: big(20000) } });
  const cutShort = whole.subarray(0, whole.length - 40);
  assert.equal(slim(cutShort), cutShort);
  const deep = Buffer.from(`{"type":"user","toolUseResult":${'['.repeat(20000)}${']'.repeat(20000)}}`);
  assert.equal(slim(deep), deep);
  const ending = line({ type: 'user', message: { content: 'a\\' }, toolUseResult: { stdout: `${big(20000)}\\` }, after: 'kept' });
  const got = JSON.parse(slim(ending).toString());
  assert.equal(got.after, 'kept');
  assert.equal(got.message.content, 'a\\');
  assert.equal(got.toolUseResult, null);
});

test('side chains and request dumps are skipped before decoding', () => {
  assert.equal(wantedBytes(line({ parentUuid: null, isSidechain: true, type: 'user' })), false);
  assert.equal(wantedBytes(line({ parentUuid: null, isSidechain: false, type: 'user', data: { isSidechain: true } })), true);
  assert.equal(wantedBytes(line({ type: 'api-request', body: {} })), false);
  assert.equal(wantedBytes(line({ type: 'api-request-blob', body: {} })), false);
  assert.equal(wantedBytes(line({ type: 'api-request-shape', shape: {} })), true);
  assert.equal(wantedBytes(line({ type: 'user', message: { content: 'say "type":"api-request" here' } })), true);
});

test('analysis of trimmed lines matches analysis of whole lines', async () => {
  const w = world('slim');
  const a = repo(w, 'loom');
  const t = new Transcript(w.claude, a);
  t.prompt('Read the loom grid.');
  for (let i = 0; i < 6; i++) {
    const think = `msg_${i}`;
    t.push(t.base({ type: 'assistant', message: t.msg([{ type: 'thinking', thinking: big(3000), signature: png }], { read: 3000 + i * 9000 }, think) }));
    const content = big(18000 + i * 5000);
    const id = `toolu_${i}`;
    const use = t.push(t.base({ type: 'assistant', message: t.msg([{ type: 'tool_use', id, name: 'Read', input: { file_path: path.join(a, `src/g${i}.ts`) } }], { read: 3000 + i * 9000 }, think) }));
    t.push(t.base({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }, toolUseResult: { type: 'text', file: { filePath: path.join(a, `src/g${i}.ts`), content } }, sourceToolAssistantUUID: use }));
    t.push(t.base({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] }] }, toolUseResult: [{ type: 'text', text: 'shot' }] }));
  }
  t.push({ type: 'attachment', uuid: 'att', attachment: { type: 'file', filename: 'shot.png', rendered: [{ type: 'image', source: { type: 'base64', data: png } }] } });
  t.reply('Read them all.', { read: 70000, out: 90 });
  t.save();
  const fast = newAnalyzer(t.id, t.file);
  await advance(fast);
  const plain = newAnalyzer(t.id, t.file);
  for (const text of fs.readFileSync(t.file, 'utf8').split('\n')) {
    if (!text || !wantedBytes(Buffer.from(text))) continue;
    const r = parseLine(text);
    if (r) step(plain, r);
  }
  plain.ctx.offset = fast.ctx.offset;
  const view = (x: typeof fast) => JSON.stringify({ points: x.ctx.points, compactions: x.ctx.compactions, timeline: timeline(x) });
  assert.ok(fast.ctx.points.length >= 7);
  assert.equal(view(fast), view(plain));
});
