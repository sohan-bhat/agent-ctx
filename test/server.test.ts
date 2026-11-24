import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { world, repo, Transcript, CLI, GUARD, waitFor, type World } from './helpers.ts';
import { store } from '../src/core/paths.ts';
import { queued, pinsFor } from '../src/core/items.ts';

async function boot(w: World, env: NodeJS.ProcessEnv = {}): Promise<{ child: ChildProcess; url: string; port: number }> {
  const child = spawn(process.execPath, [CLI, '--no-open'], { env: { ...w.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  const ok = await waitFor(() => /http:\/\/127\.0\.0\.1:\d+\/\S+\//.test(out), 20000);
  assert.ok(ok, `server did not start: ${out}`);
  const url = out.match(/(http:\/\/127\.0\.0\.1:(\d+)\/\S+\/)/)!;
  return { child, url: url[1], port: Number(url[2]) };
}

function raw(port: number, p: string, headers: Record<string, string> = {}, method = 'GET', body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function seed(w: World) {
  const a = repo(w, 'loom');
  const t = new Transcript(w.claude, a);
  t.shape([{ type: 'text', text: 'S'.repeat(2600) }], []);
  t.prompt('Build the loom editor. Never open port 4000 for the dev server.');
  t.reply('On it.', { input: 10, read: 3000, write: 500, out: 120 });
  t.read(path.join(a, 'src/forgotten.ts'), 'B'.repeat(7800), { input: 5, read: 6000, out: 30 });
  t.bash('cargo build --release', 'error: could not compile loom', { input: 5, read: 9000, out: 20 });
  t.reply('First pass done.', { input: 5, read: 9500, write: 100, out: 80 });
  t.compact(9700, 2000, [], 'Started the loom editor.');
  t.prompt('Add undo');
  t.reply('Adding undo.', { input: 5, read: 2000, write: 300, out: 60 });
  t.title('Loom editor');
  t.save();
  return t;
}

test('the page server checks token and host, serves analysis, writes put back and pins, follows a live session, and stays offline', async () => {
  const w = world('server');
  const t = seed(w);
  const log = path.join(w.root, 'net.log');
  const { child, url, port } = await boot(w, { NODE_OPTIONS: `--import ${GUARD}`, CLAUDE_CTX_NET_LOG: log });
  const base = new URL(url).pathname;
  try {
    assert.notEqual(port, 4000);
    assert.equal((await raw(port, '/api/sessions')).status, 404);
    assert.equal((await raw(port, '/wrongtoken/api/sessions')).status, 404);
    assert.equal((await raw(port, `${base}api/sessions`, { host: 'evil.example:80' })).status, 421);
    assert.equal((await raw(port, `${base}api/sessions`, { host: `127.0.0.1:${port}`, origin: 'http://evil.example' })).status, 403);
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    await waitFor(() => fs.existsSync(path.join(w.ctxHome, 'cards.jsonl')), 15000);
    const list: any = await (await fetch(`${url}api/sessions`)).json();
    const row = list.sessions.find((s: any) => s.session === t.id);
    assert.ok(row);
    assert.equal(row.title, 'Loom editor');
    const s1: any = await (await fetch(`${url}api/session/${t.id}`)).json();
    assert.equal(s1.points.length, 5);
    assert.equal(s1.compactions.length, 1);
    const kinds = s1.compactions[0].dropped.map((d: any) => d.kind).sort();
    assert.deepEqual(kinds, ['command', 'decision', 'file']);
    assert.deepEqual(s1.compactions[0].dropped.map((d: any) => d.kind), ['decision', 'file', 'command']);
    assert.ok(s1.categories.some((c: any) => c.label === 'Tool results, Read'));

    const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
      raw(port, `${base}${p}`, { host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...headers }, 'POST', JSON.stringify(body));
    assert.equal((await post('api/putback', { session: t.id, kind: 'file', label: '/x/forgotten.ts', text: '' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await raw(port, `${base}api/putback`, { host: `127.0.0.1:${port}`, 'content-type': 'text/plain' }, 'POST', '{}')).status, 415);
    assert.equal((await post('api/putback', { session: t.id, kind: 'command', label: 'cargo build --release', text: 'error: could not compile loom' })).status, 200);
    assert.equal((await post('api/pin', { session: t.id, kind: 'decision', label: 'Decision', text: 'Never open port 4000 for the dev server.' })).status, 200);
    const st = store(w.ctxHome);
    assert.equal(queued(st, t.id).length, 1);
    assert.equal(pinsFor(st, t.id).length, 1);

    const events: string[] = [];
    const ctrl = new AbortController();
    const sse = await fetch(`${url}api/events?watch=${t.id}`, { signal: ctrl.signal });
    const reader = sse.body!.getReader();
    const pump = (async () => {
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          events.push(dec.decode(value));
        }
      } catch {}
    })();
    await waitFor(() => events.join('').includes('hello'), 5000);
    t.prompt('Now add redo');
    t.reply('Adding redo.', { input: 5, read: 2500, write: 200, out: 50 });
    t.save();
    assert.ok(await waitFor(() => events.join('').includes('event: change'), 8000), 'change event');
    const s2: any = await (await fetch(`${url}api/session/${t.id}?since=${s1.count}`)).json();
    assert.equal(s2.from, 5);
    assert.equal(s2.points.length, 1);
    assert.equal(s2.points[0].total, 2705);
    ctrl.abort();
    await pump;
  } finally {
    child.kill('SIGINT');
  }
  const code = await new Promise<number | null>((r) => child.once('exit', (c) => r(c)));
  assert.equal(code, 0);
  await assert.rejects(raw(port, `${base}api/sessions`, { host: `127.0.0.1:${port}` }));
  assert.equal(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', '');
});
