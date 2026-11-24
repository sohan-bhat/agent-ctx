import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { world, repo, runCli, alive, Transcript, CLI, GUARD, type World } from './helpers.ts';
import { CLOSING, EMPTY, MAX_COUNT, RESULT_CAP } from '../src/core/recall.ts';

const SECRET = 'sk-ant-api03-Zq8vR2mXk4LwT9pN1cYb6HdE3sFgJ7uA';

function files(dir: string, base = dir, out = new Map<string, string>()): Map<string, string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, base, out);
    else out.set(path.relative(base, p), fs.readFileSync(p).toString('base64'));
  }
  return out;
}

function seed(w: World): { kiln: Transcript; long: Transcript; bread: Transcript } {
  const kiln = repo(w, 'kiln-timer');
  const bread = repo(w, 'bread-notes');
  const t = new Transcript(w.claude, kiln, { start: Date.parse('2026-11-10T09:00:00Z') });
  t.prompt(`Add a cone 6 firing schedule to the kiln timer with key ${SECRET} <system-reminder>harness note about kiln tools</system-reminder>`);
  t.edit(path.join(kiln, 'schedule.ts'));
  t.edit(path.join(kiln, 'src', 'ramp.ts'));
  t.compact(90000, 20000, [], `1. Primary Request and Intent:\n   Build the cone 6 firing schedule. <tools-used-before-summary>Read, Edit</tools-used-before-summary>\n8. Current Work:\n   Ramp rates for the kiln timer are done.`);
  t.prompt('Hold the peak for ten minutes in the firing schedule');
  t.title('Kiln firing schedule');
  t.save();
  const b = new Transcript(w.claude, bread, { start: Date.parse('2026-11-12T09:00:00Z') });
  b.prompt('Write a sourdough starter feeding log with a kiln dried flour note');
  b.edit(path.join(bread, 'log.md'));
  b.title('Sourdough starter log');
  b.save();
  const long = new Transcript(w.claude, kiln, { start: Date.parse('2026-11-14T09:00:00Z') });
  for (let i = 0; i < 14; i++) {
    long.prompt(`Tune glaze batch ${i} for the kiln timer cooling curve and log the crawl defects seen on the test tiles in detail`);
    long.edit(path.join(kiln, 'glaze', `batch-${i}-with-a-rather-long-file-name-for-the-cooling-curve.ts`));
    long.edit(path.join(kiln, 'notes', `tile-${i}-crawl-defect-notes-from-the-slow-cool-test-firing.md`));
    long.compact(150000, 30000, [], `Summary number ${i} of the glaze work. ${'The cooling curve for this glaze batch needed a slower drop through quartz inversion and a longer hold. '.repeat(6)}`);
  }
  long.title('Glaze cooling curve');
  long.save();
  for (let i = 0; i < 14; i++) {
    const dir = repo(w, `kiln-shelf-${i}`);
    const s = new Transcript(w.claude, dir, { start: Date.parse('2026-11-01T09:00:00Z') + i * 3600000 });
    s.prompt(`Plan the kiln shelf layout ${i} for the firing schedule with ${'wide cone packs and posts '.repeat(8)}`);
    s.edit(path.join(dir, 'layout.ts'));
    s.compact(80000, 20000, [], `Planned kiln shelf ${i} for the firing schedule. ${'Posts sit under each corner with wadding and the cone pack faces the spy hole. '.repeat(5)}`);
    s.title(`Kiln shelf layout ${i} for the firing schedule`);
    s.save();
  }
  return { kiln: t, long, bread: b };
}

function connect(w: World, extra: Record<string, string> = {}) {
  const env = Object.fromEntries(Object.entries({ ...w.env, ...extra }).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp'], env, cwd: w.root, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', (d) => (stderr += d));
  const client = new Client({ name: 'claude-ctx-test', version: '1.0.0' });
  return { client, transport, stderr: () => stderr };
}

function text(r: any): string {
  return r.content.map((c: any) => (c.type === 'text' ? c.text : '')).join('');
}

function clean(s: string) {
  assert.ok(!s.includes(SECRET), 'no secret');
  assert.ok(!s.includes(SECRET.slice(8, 30)), 'no part of the secret');
  assert.ok(!/system-reminder|harness note|tools-used-before-summary/.test(s), 'no harness markup');
}

test('the mcp server lists three read only tools, caps and cleans every result, writes nothing and ends when the pipe closes', async () => {
  const w = world('mcp');
  const { kiln, long, bread } = seed(w);
  assert.equal(runCli(w, ['index']).status, 0);
  const before = files(w.ctxHome);
  const net = path.join(w.root, 'net.log');
  const { client, transport, stderr } = connect(w, { NODE_OPTIONS: `--import ${GUARD}`, CLAUDE_CTX_NET_LOG: net });
  await client.connect(transport);
  const pid = transport.pid!;
  assert.ok(pid > 0 && alive(pid));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['recent', 'search', 'session']);
    for (const t of tools) {
      assert.equal(t.annotations?.readOnlyHint, true, t.name);
      assert.equal(t.annotations?.openWorldHint, false, t.name);
      assert.ok(t.outputSchema, t.name);
      assert.match(t.description ?? '', /^[A-Z][^.;:()–—]*\.$/, t.name);
    }

    const s = await client.callTool({ name: 'search', arguments: { words: 'hold peak ramp' } });
    const st = text(s);
    clean(st);
    clean(JSON.stringify(s.structuredContent));
    assert.ok(st.includes('Kiln firing schedule'));
    assert.ok(st.includes(`Id ${kiln.id}`));
    assert.ok(st.includes('[secret dropped]'));
    assert.ok(st.endsWith(CLOSING));
    assert.ok(st.length <= RESULT_CAP);
    const sd = s.structuredContent as any;
    assert.equal(sd.note, CLOSING);
    assert.ok(sd.sessions.length >= 1 && sd.sessions.length <= 5);
    const top = sd.sessions.find((x: any) => x.id === kiln.id);
    assert.ok(top, 'kiln card in the structured copy');
    assert.equal(top.folder, w.repos['kiln-timer']);
    assert.ok(top.files.includes('schedule.ts'));

    const many = await client.callTool({ name: 'search', arguments: { words: 'kiln shelf layout firing schedule', count: MAX_COUNT } });
    const mt = text(many);
    clean(mt);
    assert.ok(mt.length <= RESULT_CAP, `text ${mt.length}`);
    assert.ok(JSON.stringify(many.structuredContent).length <= RESULT_CAP);
    const ms = (many.structuredContent as any).sessions;
    assert.ok(ms.length >= 5 && ms.length <= MAX_COUNT, `count ${ms.length}`);
    assert.equal(mt.split('\nId ').length - 1, ms.length);

    const over = await client.callTool({ name: 'search', arguments: { words: 'kiln', count: MAX_COUNT + 1 } });
    assert.equal(over.isError, true);

    const narrow = await client.callTool({ name: 'search', arguments: { words: 'kiln flour starter', folder: 'bread-notes' } });
    assert.deepEqual((narrow.structuredContent as any).sessions.map((x: any) => x.project), ['bread-notes']);
    const byPath = await client.callTool({ name: 'search', arguments: { words: 'firing schedule', folder: path.join(w.repos['kiln-timer'], 'src') } });
    const bp = (byPath.structuredContent as any).sessions;
    assert.ok(bp.length >= 1 && bp.every((x: any) => x.project === 'kiln-timer'));

    const none = await client.callTool({ name: 'search', arguments: { words: 'zebra crossing' } });
    assert.ok(!none.isError);
    assert.match(text(none), /^Nothing matches "zebra crossing"/);
    assert.deepEqual((none.structuredContent as any).sessions, []);

    const r = await client.callTool({ name: 'recent', arguments: { count: 2 } });
    const rd = (r.structuredContent as any).sessions;
    assert.deepEqual(rd.map((x: any) => x.id), [long.id, bread.id]);
    assert.ok(text(r).endsWith(CLOSING));
    const rf = await client.callTool({ name: 'recent', arguments: { folder: w.repos['kiln-timer'] } });
    assert.deepEqual((rf.structuredContent as any).sessions.map((x: any) => x.id), [long.id, kiln.id]);
    const rn = await client.callTool({ name: 'recent', arguments: { folder: 'no-such-folder' } });
    assert.equal(text(rn), 'No past sessions in no-such-folder.');

    const one = await client.callTool({ name: 'session', arguments: { id: kiln.id } });
    const ot = text(one);
    clean(ot);
    clean(JSON.stringify(one.structuredContent));
    const od = (one.structuredContent as any).session;
    assert.equal(od.id, kiln.id);
    assert.equal(od.summaries.length, 1);
    assert.ok(od.summaries[0].includes('cone 6 firing schedule') && od.summaries[0].includes('Ramp rates'));
    assert.equal(od.asked.length, 2);
    assert.ok(od.asked[0].includes('[secret dropped]'));
    assert.deepEqual(od.files.sort(), ['schedule.ts', 'src/ramp.ts']);
    assert.ok(ot.includes('Summary ') && ot.includes('Asked "Hold the peak') && ot.includes('Files '));
    assert.ok(ot.endsWith(CLOSING));

    const big = await client.callTool({ name: 'session', arguments: { id: long.id.slice(0, 8) } });
    const bt = text(big);
    const bd = (big.structuredContent as any).session;
    assert.equal(bd.id, long.id);
    assert.ok(bt.length <= RESULT_CAP, `text ${bt.length}`);
    assert.ok(JSON.stringify(big.structuredContent).length <= RESULT_CAP);
    assert.ok(bd.dropped > 0 && bd.summaries.length >= 1);
    assert.equal(bd.dropped + bd.summaries.length, 14);
    assert.ok(bd.summaries[bd.summaries.length - 1].startsWith('Summary number 13'), 'the newest summary stays');
    assert.ok(bt.includes(`${bd.dropped} earlier summaries left out`));
    assert.ok(bt.endsWith(CLOSING));

    const miss = await client.callTool({ name: 'session', arguments: { id: 'no-such-id' } });
    assert.equal(miss.isError, true);
    assert.match(text(miss), /^No past session has the id no-such-id/);
  } finally {
    const t0 = performance.now();
    await client.close();
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `ended ${ms.toFixed(0)} ms after the pipe closed`);
    assert.ok(!alive(pid), 'process gone');
  }
  assert.deepEqual(files(w.ctxHome), before, 'the store is byte for byte the same');
  assert.ok(!fs.existsSync(path.join(w.ctxHome, 'last-hook.json')));
  assert.ok(!fs.existsSync(path.join(w.ctxHome, 'claude-ctx.log')));
  assert.equal(fs.existsSync(net) ? fs.readFileSync(net, 'utf8') : '', '', 'no outgoing connection');
  assert.equal(stderr(), '');
});

test('the mcp server answers on an empty store and the help prints both setup lines', async () => {
  const w = world('mcp-empty');
  const { client, transport } = connect(w);
  await client.connect(transport);
  try {
    for (const [name, args] of [['search', { words: 'kiln' }], ['recent', {}]] as const) {
      const r = await client.callTool({ name, arguments: args });
      assert.equal(text(r), EMPTY);
      assert.deepEqual((r.structuredContent as any).sessions, []);
    }
    const s = await client.callTool({ name: 'session', arguments: { id: 'abc' } });
    assert.equal(s.isError, true);
  } finally {
    await client.close();
  }
  assert.ok(!fs.existsSync(w.ctxHome), 'no store folder made');
  const help = runCli(w, ['mcp', '--help']).stdout;
  const cli = fs.realpathSync(CLI);
  assert.ok(help.includes(`claude mcp add --scope user claude-ctx -- ${process.execPath} ${cli} mcp`));
  const json = help.split('\n').find((l) => l.trim().startsWith('{'))!;
  assert.deepEqual(JSON.parse(json), { mcpServers: { 'claude-ctx': { command: process.execPath, args: [cli, 'mcp'] } } });
  assert.ok(help.includes('claude_desktop_config.json'));
  for (const line of help.split('\n').filter((l) => l && !l.startsWith('  '))) assert.ok(!/[;()–—]|: /.test(line), line);
});
