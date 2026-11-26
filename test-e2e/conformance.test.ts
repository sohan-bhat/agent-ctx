import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { readFileSync } from 'node:fs';
import { BASELINE, REVISIONS, withToken } from './conformance.mjs';

function upstream(): Promise<{ port: number; seen: IncomingHttpHeaders[]; close: () => void }> {
  return new Promise((done) => {
    const seen: IncomingHttpHeaders[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers);
      res.end('ok');
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      done({ port, seen, close: () => server.close() });
    });
  });
}

function hit(port: number, host: string): Promise<number> {
  return new Promise((done, fail) => {
    const r = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { host, origin: 'http://evil.example' } }, (res) => {
      res.resume();
      res.on('end', () => done(res.statusCode ?? 0));
    });
    r.on('error', fail);
    r.end('{}');
  });
}

test('the relay adds the bearer token and passes a foreign Host and Origin through unchanged', async () => {
  const up = await upstream();
  const gate = await withToken('tok-123', { host: '127.0.0.1', port: up.port });
  try {
    assert.equal(await hit(gate.port, `localhost:${gate.port}`), 200);
    assert.equal(await hit(gate.port, 'evil.example'), 200);
    assert.equal(up.seen[0].authorization, 'Bearer tok-123');
    assert.equal(up.seen[0].host, `127.0.0.1:${up.port}`);
    assert.equal(up.seen[1].host, 'evil.example');
    assert.equal(up.seen[1].origin, 'http://evil.example');
  } finally {
    await gate.close();
    up.close();
  }
});

test('the baseline gives one reason for every entry and runs both requirement sets', () => {
  assert.deepEqual(REVISIONS, ['2025-11-25', '2026-07-28']);
  const lines = readFileSync(BASELINE, 'utf8').trim().split('\n');
  assert.equal(lines[0], 'server:');
  for (const l of lines.slice(1)) assert.match(l, /^  - [a-z0-9-]+(?::[a-z0-9-]+)? # \S.+$/, l);
});
