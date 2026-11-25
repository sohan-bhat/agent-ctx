import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { claudeDir, type Store } from './core/paths.ts';
import { loadCards } from './core/store.ts';
import { parseLine, usageOf } from './core/records.ts';
import { applyJobs, listTranscripts } from './core/update.ts';
import { releaseLock, tryLock } from './core/lock.ts';
import { budgetBytes, WORKER_LIMIT_MS } from './core/limits.ts';
import { advance, CHARS_PER_TOKEN, newAnalyzer, timeline, weight, type Analyzer } from './core/context.ts';
import { enqueue, makeItem, pin, pinsFor, queued, unpin, type ItemKind } from './core/items.ts';
import { promptTitle, tilde } from './core/format.ts';
import { storeSize } from './core/budget.ts';
import type { Card } from './core/session.ts';

export interface ServeOptions {
  open: boolean;
  port: number;
  quiet?: boolean;
}

export interface Running {
  url: string;
  port: number;
  token: string;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function webDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const d of [path.join(here, 'web'), path.join(here, '..', 'dist', 'web')]) if (fs.existsSync(path.join(d, 'index.html'))) return d;
  return path.join(here, 'web');
}

interface SessionRow {
  session: string;
  title?: string;
  prompt?: string;
  place: string;
  placeLabel: string;
  project: string;
  places: string[];
  first: string;
  last: string;
  turns: number;
  files: number;
  summaries: number;
  live: boolean;
  transcript: string | null;
  size: number;
}

function firstCwd(file: string, bytes = 65536): string | null {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = buf.subarray(0, n).toString('utf8').match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    return m ? JSON.parse(`"${m[1]}"`) : null;
  } catch {
    return null;
  }
}

function sessionRows(st: Store): SessionRow[] {
  const cards = loadCards(st);
  const files = new Map(listTranscripts(claudeDir()).map((f) => [f.session, f]));
  const by = new Map<string, Card[]>();
  for (const c of cards) {
    const l = by.get(c.session) ?? [];
    l.push(c);
    by.set(c.session, l);
  }
  const now = Date.now();
  const rows: SessionRow[] = [];
  for (const [session, cs] of by) {
    cs.sort((a, b) => a.part - b.part);
    const main = [...cs].sort((a, b) => b.turns - a.turns)[0];
    const f = files.get(session);
    rows.push({
      session,
      title: main.title,
      prompt: promptTitle(cs.find((c) => c.firstPrompt)?.firstPrompt),
      place: main.place,
      placeLabel: tilde(main.place),
      project: main.project,
      places: cs.map((c) => c.place),
      first: cs.map((c) => c.first).filter(Boolean).sort()[0] ?? '',
      last: cs.map((c) => c.last).filter(Boolean).sort().pop() ?? '',
      turns: cs.reduce((a, c) => a + c.turns, 0),
      files: cs.reduce((a, c) => a + c.files.length, 0),
      summaries: cs.reduce((a, c) => a + c.summaries.length, 0),
      live: !!f && now - f.mtime < 120000,
      transcript: f ? f.transcript : null,
      size: f ? f.size : 0,
    });
  }
  for (const [session, f] of files) {
    if (by.has(session)) continue;
    const cwd = firstCwd(f.transcript) ?? '';
    rows.push({
      session,
      place: cwd,
      placeLabel: tilde(cwd),
      project: path.basename(cwd),
      places: cwd ? [cwd] : [],
      first: new Date(f.mtime).toISOString(),
      last: new Date(f.mtime).toISOString(),
      turns: 0,
      files: 0,
      summaries: 0,
      live: now - f.mtime < 120000,
      transcript: f.transcript,
      size: f.size,
    });
  }
  rows.sort((a, b) => b.last.localeCompare(a.last));
  return rows;
}

interface Kept {
  a: Analyzer;
  size: number;
  mtime: number;
  used: number;
  weight: number;
}

export const ANALYSIS_BUDGET = 96 * 1024 * 1024;
export const ANALYSIS_MAX = 64;

function readTail(file: string, size: number): { model?: string; peak: number } {
  const out: { model?: string; peak: number } = { peak: 0 };
  try {
    const len = Math.min(size, 4 << 20);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.subarray(0, n).toString('utf8').split('\n');
    if (len < size) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      const text = lines[i];
      if (!text.includes('"usage"') || !text.includes('"type":"assistant"')) continue;
      const r = parseLine(text);
      if (!r || r.isSidechain) continue;
      const u = usageOf(r);
      if (u) out.peak = Math.max(out.peak, u.total);
      if (!out.model && typeof r.message?.model === 'string' && r.message.model.startsWith('claude-')) out.model = r.message.model;
    }
    if (!out.model) {
      const head = Buffer.alloc(Math.min(size, 1 << 18));
      const fd2 = fs.openSync(file, 'r');
      const m = fs.readSync(fd2, head, 0, head.length, 0);
      fs.closeSync(fd2);
      out.model = head.subarray(0, m).toString('utf8').match(/"model":"(claude-[^"<]+)"/)?.[1];
    }
  } catch {}
  return out;
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function start(st: Store, opts: ServeOptions): Promise<Running> {
  const token = randomBytes(18).toString('base64url');
  const web = webDir();
  const kept = new Map<string, Kept>();
  const busy = new Map<string, Promise<void>>();
  const paths = new Map<string, string>();
  const clients = new Set<{ res: http.ServerResponse; watch: string | null }>();
  const watched = new Map<string, { file: string; count: number; size: number }>();
  let port = 0;
  let indexing: Promise<void> | null = null;

  const send = (res: http.ServerResponse, code: number, body: unknown, type = 'application/json') => {
    const data = type === 'application/json' ? JSON.stringify(body) : (body as string | Buffer);
    res.writeHead(code, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'cross-origin-resource-policy': 'same-origin',
    });
    res.end(data);
  };

  const broadcast = (event: string, data: unknown, only?: string) => {
    for (const c of clients) {
      if (only && c.watch !== only) continue;
      c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const transcriptOf = (session: string): string | null => {
    const f = listTranscripts(claudeDir()).find((x) => x.session === session);
    if (f) return f.transcript;
    const c = loadCards(st).find((x) => x.session === session);
    return c && fs.existsSync(c.transcript) ? c.transcript : null;
  };

  const pathOf = (session: string): string | null => {
    const known = paths.get(session);
    if (known && fs.existsSync(known)) return known;
    const file = transcriptOf(session);
    if (file) paths.set(session, file);
    return file;
  };

  const trim = (keep: string) => {
    let total = 0;
    for (const k of kept.values()) total += k.weight;
    const order = [...kept.entries()].sort((x, y) => x[1].used - y[1].used);
    for (const [file, k] of order) {
      if (total <= ANALYSIS_BUDGET && kept.size <= ANALYSIS_MAX) break;
      if (file === keep || busy.has(file)) continue;
      kept.delete(file);
      total -= k.weight;
    }
  };

  const analyze = async (session: string): Promise<Analyzer | null> => {
    const file = pathOf(session);
    if (!file) return null;
    for (;;) {
      const running = busy.get(file);
      if (!running) break;
      await running.catch(() => {});
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return kept.get(file)?.a ?? null;
    }
    let k = kept.get(file);
    if (k && (stat.size < k.size || (stat.size === k.size && stat.mtimeMs !== k.mtime))) {
      kept.delete(file);
      k = undefined;
    }
    if (!k) {
      k = { a: newAnalyzer(session, file), size: 0, mtime: 0, used: 0, weight: 0 };
      kept.set(file, k);
    }
    const entry = k;
    entry.used = Date.now();
    if (entry.a.ctx.offset < stat.size) {
      const total = stat.size;
      let last = 0;
      const job = advance(entry.a, total, (at) => {
        const now = Date.now();
        if (now - last < 100) return;
        last = now;
        broadcast('reading', { session, at, size: total }, session);
      }).then(() => undefined);
      busy.set(file, job);
      try {
        await job;
      } finally {
        busy.delete(file);
      }
      entry.size = entry.a.ctx.offset;
      entry.mtime = entry.a.ctx.offset >= stat.size ? stat.mtimeMs : 0;
      entry.weight = weight(entry.a);
      trim(file);
    }
    return entry.a;
  };

  const peek = (session: string) => {
    const file = pathOf(session);
    if (!file) return null;
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      return null;
    }
    const k = kept.get(file);
    const tail = readTail(file, size);
    const cwd = k?.a.ctx.cwd ?? firstCwd(file, 1 << 20) ?? undefined;
    const card = loadCards(st).find((c) => c.session === session);
    return {
      session,
      title: k?.a.ctx.title ?? card?.title,
      prompt: promptTitle(card?.firstPrompt),
      cwd: cwd ? tilde(cwd) : undefined,
      root: cwd,
      model: k?.a.ctx.model ?? tail.model,
      peak: tail.peak,
      size,
      ready: !!k && k.a.ctx.offset >= size,
    };
  };

  const refresh = () => {
    if (indexing) return indexing;
    indexing = (async () => {
      if (!tryLock(st.lock, WORKER_LIMIT_MS + 5000)) return;
      try {
        const files = listTranscripts(claudeDir());
        await applyJobs(st, claudeDir(), files.map((f) => ({ session: f.session, transcript: f.transcript })));
      } catch {
      } finally {
        releaseLock(st.lock);
      }
      broadcast('sessions', { at: Date.now() });
    })().finally(() => {
      indexing = null;
    });
    return indexing;
  };

  const watch = (session: string) => {
    const file = transcriptOf(session);
    if (!file) return;
    const w = watched.get(session);
    if (w) {
      w.count++;
      return;
    }
    const entry = { file, count: 1, size: 0 };
    watched.set(session, entry);
    fs.watchFile(file, { interval: 700 }, (cur) => {
      if (cur.size !== entry.size) {
        entry.size = cur.size;
        broadcast('change', { session, size: cur.size }, session);
      }
    });
  };

  const unwatch = (session: string | null) => {
    if (!session) return;
    const w = watched.get(session);
    if (!w) return;
    w.count--;
    if (w.count <= 0) {
      fs.unwatchFile(w.file);
      watched.delete(session);
    }
  };

  const readBody = (req: http.IncomingMessage): Promise<any> =>
    new Promise((resolve, reject) => {
      let n = 0;
      const parts: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        n += c.length;
        if (n > 64 * 1024) {
          reject(new Error('too large'));
          req.destroy();
          return;
        }
        parts.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 421, { error: 'host' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(res, 403, { error: 'origin' });
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin' && req.headers['sec-fetch-site'] !== 'none') return send(res, 403, { error: 'site' });
    const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const segs = u.pathname.split('/');
    if (segs.length < 2 || !sameToken(segs[1] ?? '', token)) return send(res, 404, { error: 'not found' });
    if (segs.length === 2) {
      res.writeHead(308, { location: `/${token}/` });
      return res.end();
    }
    const rest = segs.slice(2).join('/');
    try {
      if (req.method === 'GET' && (rest === '' || rest === 'index.html')) {
        const f = path.join(web, 'index.html');
        if (!fs.existsSync(f)) return send(res, 200, '<!doctype html><title>claude-ctx</title><p>The page is not built. Run npm run build.</p>', 'text/html; charset=utf-8');
        return send(res, 200, fs.readFileSync(f), MIME['.html']);
      }
      if (req.method === 'GET' && rest.startsWith('assets/')) {
        const f = path.resolve(web, rest);
        if (!f.startsWith(path.resolve(web) + path.sep) || !fs.existsSync(f)) return send(res, 404, { error: 'not found' });
        res.setHeader('cache-control', 'no-store');
        return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] ?? 'application/octet-stream');
      }
      if (req.method === 'GET' && rest === 'api/sessions') {
        return send(res, 200, { sessions: sessionRows(st), indexing: !!indexing, home: tilde(st.home), store: { bytes: storeSize(st.home), cap: budgetBytes() } });
      }
      if (req.method === 'GET' && rest.startsWith('api/session/')) {
        const id = decodeURIComponent(rest.slice('api/session/'.length));
        if (u.searchParams.get('peek')) {
          const p = peek(id);
          return p ? send(res, 200, p) : send(res, 404, { error: 'no transcript' });
        }
        const since = Math.max(0, Number(u.searchParams.get('since')) || 0);
        const a = await analyze(id);
        if (!a) return send(res, 404, { error: 'no transcript' });
        const pts = a.ctx.points;
        const from = since <= pts.length ? since : 0;
        const tl = timeline(a);
        const closedFrom = Math.max(0, Number(u.searchParams.get('closed')) || 0);
        const labelsFrom = Math.max(0, Number(u.searchParams.get('labels')) || 0);
        const cf = from > 0 && closedFrom <= tl.closed.length ? closedFrom : 0;
        const lf = from > 0 && labelsFrom <= tl.labels.length ? labelsFrom : 0;
        return send(res, 200, {
          session: id,
          title: a.ctx.title,
          prompt: promptTitle(loadCards(st).find((c) => c.session === id && c.firstPrompt)?.firstPrompt),
          cwd: a.ctx.cwd ? tilde(a.ctx.cwd) : undefined,
          root: a.ctx.cwd,
          model: a.ctx.model,
          offset: a.ctx.offset,
          system: a.ctx.system,
          ratio: CHARS_PER_TOKEN,
          from,
          count: pts.length,
          totals: pts.slice(from).map((p) => p.total),
          compactions: a.ctx.compactions.map(({ before: _, ...c }) => c),
          timeline: { cats: tl.cats, labelsFrom: lf, labels: tl.labels.slice(lf), closedFrom: cf, closed: tl.closed.slice(cf), live: tl.live },
          queued: queued(st, id),
          pins: pinsFor(st, id),
        });
      }
      if (req.method === 'GET' && rest === 'api/events') {
        const watchId = u.searchParams.get('watch');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
        res.write(`event: hello\ndata: {}\n\n`);
        const client = { res, watch: watchId };
        clients.add(client);
        if (watchId) watch(watchId);
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(client);
          unwatch(watchId);
        });
        return;
      }
      if (req.method === 'POST' && (rest === 'api/putback' || rest === 'api/pin' || rest === 'api/unpin')) {
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'json only' });
        const b = await readBody(req);
        if (rest === 'api/unpin') return send(res, 200, { ok: unpin(st, String(b.id ?? '')) });
        const kinds: ItemKind[] = ['file', 'command', 'decision', 'note'];
        if (typeof b.session !== 'string' || !b.session || !kinds.includes(b.kind)) return send(res, 400, { error: 'bad item' });
        const item = makeItem(b.session, b.kind, String(b.label ?? ''), String(b.text ?? ''));
        const ok = rest === 'api/putback' ? enqueue(st, item) : pin(st, item);
        broadcast('items', { session: b.session }, b.session);
        return send(res, ok ? 200 : 503, { ok, item });
      }
      if (req.method === 'POST' && rest === 'api/refresh') {
        void refresh();
        return send(res, 202, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: e instanceof Error ? e.message : 'error' });
    }
  };

  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  let want = opts.port && opts.port !== 4000 ? opts.port : 0;
  await new Promise<void>((resolve, reject) => {
    const tryListen = () => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        if (want && e.code === 'EADDRINUSE') {
          want = 0;
          tryListen();
        } else reject(e);
      });
      server.listen(want, '127.0.0.1', () => resolve());
    };
    tryListen();
  });
  port = (server.address() as { port: number }).port;
  if (port === 4000) {
    await new Promise<void>((r) => server.close(() => r()));
    return start(st, { ...opts, port: 0 });
  }
  const url = `http://127.0.0.1:${port}/${token}/`;
  void refresh();
  const close = async () => {
    for (const c of clients) c.res.end();
    clients.clear();
    for (const w of watched.values()) fs.unwatchFile(w.file);
    watched.clear();
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { url, port, token, close };
}

export async function serve(st: Store, opts: ServeOptions): Promise<void> {
  const run = await start(st, opts);
  process.stdout.write(`The page is open at ${run.url}\nPress Ctrl+C to close it.\n`);
  if (opts.open) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    try {
      spawn(cmd, [run.url], { stdio: 'ignore', detached: true }).unref();
    } catch {}
  }
  await new Promise<void>((resolve) => {
    const stop = () => {
      void run.close().then(resolve);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
