import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { AxeBuilder } from '@axe-core/playwright';
import { browser, context, drag, engine, labels, overflow, press, ready, touchDrag, waitFor, web } from './lib.mjs';

const BASE = '/agent-ctx/';
const REPO = /REPO = '([^']+)'/.exec(fs.readFileSync(path.join(web, 'src', 'agents.ts'), 'utf8'))[1];
const GUIDE = 'https://sohanbhat.me/agent-ctx/setup.md';
const LINE = `Follow ${GUIDE}`;
const HOME = `https://github.com/${REPO}`;
const DIST = path.join(web, 'dist-site');
const START = 8 * 60;
const END = 18 * 60;
const NAMES = ['Claude Code', 'Cursor', 'Codex', 'Antigravity', 'Grok Build', 'Muse Code', 'Claude desktop'];
const OPEN = 'Your context follows you';
const LEADS = ['from', 'to'];
const MARK = 'M0 0L5 0L5 3L3 3L3 13L5 13L5 16L0 16ZM6 6L10 6L10 10L6 10ZM8 0L12.243 0L20.243 8L12.243 16L8 16L16 8Z';
const LOCKUP = '163099391999c215';
const TAIL = '.';
const SPOKEN = 'Your context follows you from Claude Code to Cursor.';
const EDGE = [563, 555, 402, 394];
const sizes = (process.env.SIZES ?? '1440x900,390x664').split(',').map((s) => s.split('x').map(Number));
const schemes = (process.env.SCHEMES ?? 'dark,light').split(',');
const shots = process.env.SHOTS;
const walks = process.env.WALKS?.split(',');
const GROUND = { light: 'rgb(250, 250, 250)', dark: 'rgb(20, 20, 20)' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

function build(out, released) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.VITE_RELEASED;
    if (released) env.VITE_RELEASED = '1';
    const child = spawn(process.execPath, [path.join(web, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'site', ...(out ? ['--outDir', out] : [])], { cwd: web, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`the site build failed\n${log}`))));
  });
}

function serve(dir) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://local');
    if (pathname === BASE.slice(0, -1)) {
      res.writeHead(301, { location: BASE });
      res.end();
      return;
    }
    const file = pathname.startsWith(BASE) ? path.join(dir, decodeURIComponent(pathname.slice(BASE.length)) || 'index.html') : '';
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const stop = () =>
        new Promise((r) => {
          server.closeAllConnections();
          server.close(r);
        });
      resolve({ origin, url: `${origin}${BASE}`, stop });
    }),
  );
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function decode(png) {
  let at = 8;
  let w = 0;
  let h = 0;
  let n = 3;
  const parts = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const kind = png.toString('latin1', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      n = data[9] === 6 ? 4 : 3;
    } else if (kind === 'IDAT') parts.push(data);
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const row = w * n;
  const px = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    const mode = raw[y * (row + 1)];
    for (let x = 0; x < row; x++) {
      const a = x >= n ? px[y * row + x - n] : 0;
      const b = y ? px[(y - 1) * row + x] : 0;
      const c = x >= n && y ? px[(y - 1) * row + x - n] : 0;
      const q = a + b - c;
      const paeth = Math.abs(q - a) <= Math.abs(q - b) && Math.abs(q - a) <= Math.abs(q - c) ? a : Math.abs(q - b) <= Math.abs(q - c) ? b : c;
      const guess = mode === 1 ? a : mode === 2 ? b : mode === 3 ? (a + b) >> 1 : mode === 4 ? paeth : 0;
      px[y * row + x] = (raw[y * (row + 1) + 1 + x] + guess) & 255;
    }
  }
  return { w, h, n, px };
}

function encode({ w, h, n, px }) {
  const row = w * n;
  const raw = Buffer.alloc((row + 1) * h);
  for (let y = 0; y < h; y++) px.copy(raw, y * (row + 1) + 1, y * row, (y + 1) * row);
  const chunk = (kind, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(kind, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = n === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function whole(page, file, h) {
  const tall = await page.evaluate(() => document.documentElement.scrollHeight);
  const parts = [];
  for (let y = 0; y < tall; y += h) {
    const at = Math.max(0, Math.min(y, tall - h));
    await page.evaluate((v) => scrollTo(0, v), at);
    await page.waitForTimeout(250);
    const shot = decode(await page.screenshot());
    const skip = Math.round(((y - at) * shot.h) / h);
    parts.push({ ...shot, h: shot.h - skip, px: shot.px.subarray(skip * shot.w * shot.n) });
  }
  fs.writeFileSync(file, encode({ w: parts[0].w, n: parts[0].n, h: parts.reduce((a, p) => a + p.h, 0), px: Buffer.concat(parts.map((p) => p.px)) }));
  await page.evaluate(() => scrollTo(0, 0));
}

async function paint(page, dpr = 1) {
  const box = await page.locator('[aria-roledescription=space]').boundingBox();
  const { w, h, n, px } = decode(await page.screenshot({ clip: box }));
  const cell = 12 * dpr;
  const cols = Math.floor(w / cell);
  const rows = Math.floor(h / cell);
  const grid = new Uint16Array(cols * rows);
  const hues = new Map();
  let coloured = 0;
  let light = 0;
  for (let y = 0; y < rows * cell; y++)
    for (let x = 0; x < cols * cell; x++) {
      const i = (y * w + x) * n;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      light += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const max = Math.max(r, g, b);
      const spread = max - Math.min(r, g, b);
      if (spread < 60) continue;
      coloured++;
      grid[Math.floor(y / cell) * cols + Math.floor(x / cell)]++;
      const hue = max === r ? ((g - b) / spread + 6) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
      const band = Math.round(hue * 2) % 12;
      hues.set(band, (hues.get(band) ?? 0) + 1);
    }
  const spots = [];
  for (let cy = 2; cy < rows - 2; cy++)
    for (let cx = 2; cx < cols - 2; cx++) {
      if (grid[cy * cols + cx] < cell * cell * 0.9) continue;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) weight += grid[(cy + dy) * cols + cx + dx];
      spots.push({ x: box.x + ((cx + 0.5) * cell) / dpr, y: box.y + ((cy + 0.5) * cell) / dpr, weight });
    }
  spots.sort((a, b) => b.weight - a.weight);
  return { box, coloured, share: coloured / (w * h), light: light / (rows * cols * cell * cell), hues: [...hues.values()].filter((v) => v > 150 * dpr * dpr).length, spots };
}

const minutes = (text) => {
  const m = /(\d\d):(\d\d)/.exec(text ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const readout = async (page) => minutes(await page.locator('[data-readout]').textContent());
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const box = (page, sel) => page.locator(sel).first().boundingBox().catch(() => null);
const inside = (r, w, h) => !!r && r.width > 0 && r.height > 0 && r.x >= -0.5 && r.y >= -0.5 && r.x + r.width <= w + 0.5 && r.y + r.height <= h + 0.5;
const span = (r) => (r ? `${Math.round(r.y)} to ${Math.round(r.y + r.height)}` : 'missing');
const top = (page) => page.evaluate(() => Math.round(scrollY));
const panel = (page) => page.evaluate(() => document.querySelector('[data-panel]')?.getAttribute('data-panel') ?? null);
const ground = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const across = async (page, w) => {
  const o = await overflow(page);
  const [inner, full] = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  return { ok: o.scroll <= 0 && !o.wide.length && inner === w && full <= w, text: JSON.stringify({ ...o, inner, full }) };
};
const settle = async (page) => {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const now = await top(page);
    if (now === last) return now;
    last = now;
    await page.waitForTimeout(150);
  }
  return last;
};
const centre = async (page) => {
  await page.evaluate(() => document.querySelector('[data-site=demo]').scrollIntoView({ block: 'center' }));
  await settle(page);
  return box(page, '[aria-roledescription=space]');
};

const texts = (page) =>
  page.evaluate(() => {
    const out = [document.title, document.querySelector('meta[name=description]')?.getAttribute('content') ?? ''];
    const asked = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      const text = node.textContent.trim();
      if (!el || !text || el.closest('script, style')) continue;
      out.push(text);
      if (text.includes('?') && !el.closest('[data-site=faq] h3')) asked.push(text);
    }
    for (const name of ['aria-label', 'title', 'alt', 'placeholder', 'data-room']) for (const el of document.querySelectorAll(`[${name}]`)) out.push(el.getAttribute(name));
    return { out, asked };
  });

function faults(list) {
  const found = [];
  const rules = [
    ['a banned word', /\b(?:itself|its|it)\b/gi],
    ['a dash as punctuation', /[‒-―−]|(?:^|\s)-+(?=\s|$)/gm],
    ['a semicolon', /;/g],
    ['a colon in prose', /:(?=\s|$)/gm],
    ['a parenthesis', /[()]/g],
  ];
  for (const text of list) for (const [what, re] of rules) for (const m of text.matchAll(re)) found.push(`${what} in "${text.slice(Math.max(0, m.index - 24), m.index + 24).replace(/\s+/g, ' ').trim()}"`);
  return found;
}

const shape = (page) =>
  page.evaluate(() => {
    const out = (e) => !e.closest('[data-site=demo]');
    const count = (s) => s.trim().split(/\s+/).filter(Boolean).length;
    const size = (e) => parseFloat(getComputedStyle(e).fontSize);
    const heads = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(out);
    const small = (e, by) => !!e && !/^H[1-6]$/.test(e.tagName) && count(e.innerText ?? '') > 0 && count(e.innerText ?? '') <= 4 && size(e) <= by;
    const frame = document.querySelector('[data-site=demo]');
    const marks = heads.filter((h) => small(h.previousElementSibling, size(h))).map((h) => h.textContent.trim());
    if (frame && (small(frame.previousElementSibling, 99) || small(frame.nextElementSibling, 99))) marks.push('demo frame');
    if ([...document.querySelectorAll('body *')].some((e) => !e.children.length && /^demo$/i.test(e.textContent.trim()))) marks.push('demo');
    let words = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || el.closest('[data-site=faq], [data-site=demo], .sr-only, script, style') || !el.checkVisibility({ visibilityProperty: true })) continue;
      words += count(node.textContent);
    }
    const items = [...document.querySelectorAll('[data-site=faq] h3')].map((h) => ({ q: h.textContent.trim(), a: h.nextElementSibling?.tagName === 'P' ? h.nextElementSibling.textContent.trim() : '' }));
    const probe = document.createElement('span');
    probe.style.color = 'var(--border)';
    document.body.append(probe);
    const rule = getComputedStyle(probe).color;
    probe.remove();
    const rows = [...document.querySelectorAll('[data-site=faq] > div')].map((d) => {
      const [q, a] = [d.querySelector('h3'), d.querySelector('p')];
      const [qs, as, ds] = [q, a, d].map((e) => getComputedStyle(e));
      const [qr, ar, dr] = [q, a, d].map((e) => e.getBoundingClientRect());
      return { left: [qr.left, ar.left], top: [qr.top, ar.top], end: qr.bottom, share: (ar.left - qr.left) / dr.width, weight: [Number(qs.fontWeight), Number(as.fontWeight)], same: qs.fontSize === as.fontSize && qs.color === as.color, line: `${ds.borderTopWidth} ${ds.borderTopStyle} ${ds.borderTopColor}` };
    });
    const split = [];
    let named = 0;
    const faq = document.createTreeWalker(document.querySelector('[data-site=faq]') ?? document.body, NodeFilter.SHOW_TEXT);
    for (let node = faq.nextNode(); node; node = faq.nextNode())
      for (const m of node.textContent.matchAll(/agent-ctx/g)) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        named++;
        if (range.getClientRects().length !== 1) split.push(node.textContent.trim());
      }
    const nav = document.querySelector('nav');
    const foot = document.querySelector('footer');
    const pills = [...document.querySelectorAll('[data-site=action] a')];
    const typed = document.querySelector('[data-site=typed]');
    const said = typed?.cloneNode(true);
    for (const e of said?.querySelectorAll('[aria-hidden]') ?? []) e.remove();
    return {
      h1: heads.filter((h) => h.tagName === 'H1').map((h) => h.textContent.trim()),
      h2: heads.filter((h) => h.tagName === 'H2').map((h) => h.textContent.trim()),
      marks,
      words,
      items,
      rows,
      rule,
      named,
      split,
      bars: document.querySelectorAll('[data-site=day], [data-site=bar], [data-site=faq] svg').length,
      nav: nav ? { text: nav.innerText.trim().split(/\s+/), links: [...nav.querySelectorAll('a')].map((a) => a.href), parts: nav.children.length, toggles: nav.querySelectorAll('[role=switch]').length } : null,
      foot: foot ? { text: foot.innerText, links: [...foot.querySelectorAll('a')].map((a) => a.href), tops: [...foot.children].map((e) => Math.round(e.getBoundingClientRect().top / 8)) } : null,
      pills: pills.map((a) => [a.textContent.trim(), a.getAttribute('href'), a.dataset.variant]),
      status: document.querySelector('[data-site=status]')?.textContent ?? '',
      spoken: said?.textContent.trim() ?? '',
      live: !!typed?.closest('[aria-live], [role=status], [role=alert], [role=log]') || !!typed?.querySelector('[aria-live]'),
      kept: localStorage.length + sessionStorage.length,
      cookie: document.cookie,
    };
  });

async function open(page, touch, spots) {
  for (const s of spots.slice(0, 14)) {
    await press(page, touch, s.x, s.y);
    const id = await waitFor(() => panel(page), 2200);
    if (id) return id;
  }
  return null;
}

function seeded(seed) {
  const streams = new Map();
  const timeout = window.setTimeout;
  const timers = (window.__timers = { last: {}, asked: {} });
  let chain = 0;
  let chains = 0;
  const stream = (n) => {
    let a = (seed * 1000003 + n * 7919) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  window.setTimeout = (f, ms, ...rest) => {
    if (typeof f !== 'function') return timeout(f, ms, ...rest);
    const mine = chain || ++chains;
    const due = performance.now() + ms;
    (timers.asked[mine] ??= []).push(ms);
    return timeout(() => {
      chain = mine;
      timers.last = { chain: mine, ms, due };
      try {
        f(...rest);
      } finally {
        chain = 0;
      }
    }, ms);
  };
  Math.random = () => {
    if (!streams.has(chain)) streams.set(chain, stream(chain));
    return streams.get(chain)();
  };
}

const watch = (page) =>
  page.evaluate(
    ([names, leads, tail, open]) => {
      const t = (window.__typed = { boxed: [new Set(), new Set()], pad: [[], []], bare: [[], []], eased: 0, open: new Set(), shown: [[], []], keys: [[], []], blink: [[], []], place: [new Set(), new Set()], lead: [new Set(), new Set()], tail: new Set(), tall: new Set(), top: new Set(), drop: new Set(), under: new Set(), said: new Set(), pairs: 0, same: 0, typing: 0, unlit: 0, out: 0 });
      const p = document.querySelector('[data-site=typed]');
      const words = [];
      let end = null;
      let first = null;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement.closest('.sr-only')) continue;
        if (n.textContent === open) first = n;
        if (leads.includes(n.textContent)) words.push(n);
        if (n.textContent.trim() === tail) end = n;
      }
      const range = document.createRange();
      const look = () => {
        const fired = window.__timers?.last ?? {};
        const at = p.getBoundingClientRect();
        const spots = [...p.querySelectorAll('[data-site=agent]')];
        const carets = [...p.querySelectorAll('.site-caret')];
        const said = p.cloneNode(true);
        for (const e of said.querySelectorAll('[aria-hidden]')) e.remove();
        t.said.add(said.textContent.trim());
        t.tall.add(Math.round(at.height));
        t.top.add(p.offsetTop);
        t.under.add(document.querySelector('[data-site=line]')?.offsetTop);
        carets.slice(0, 2).forEach((c, i) => {
          const state = (c.hasAttribute('data-blink') ? 2 : 0) + (c.hasAttribute('data-off') ? 1 : 0);
          if (t.blink[i].at(-1)?.[0] !== state) t.blink[i].push([state, fired.ms, fired.due]);
        });
        if (spots.length !== 2) return;
        [...p.querySelectorAll('[data-site=box]')].slice(0, 2).forEach((e, i) => {
          const r = e.getBoundingClientRect();
          const word = spots[i].getBoundingClientRect();
          t.boxed[i].add(`${Math.round(r.height * 10) / 10} tall at ${Math.round((r.top - at.top) * 10) / 10}`);
          t.pad[i].push(r.width - word.width);
          if (!spots[i].textContent) t.bare[i].push(r.width);
          if (e.getAnimations().length || getComputedStyle(e).transitionDuration.split(',').some((v) => parseFloat(v) > 0)) t.eased++;
        });
        const whole = spots.map((e) => names.includes(e.textContent));
        const box = spots.map((e) => e.getBoundingClientRect());
        t.drop.add(Math.round(box[1].top - box[0].top));
        if (first) {
          range.selectNodeContents(first);
          const r = range.getBoundingClientRect();
          t.open.add(`${Math.round(r.left - at.left)} ${Math.round(r.top - at.top)}`);
        }
        words.forEach((n, i) => {
          range.selectNodeContents(n);
          t.lead[i].add(Math.round(range.getBoundingClientRect().left - at.left));
        });
        if (end) {
          range.selectNodeContents(end);
          const last = range.getBoundingClientRect();
          t.tail.add(Math.round(last.left - at.left));
          if (last.right > at.right + 0.5) t.out++;
        } else t.out++;
        spots.forEach((e, i) => {
          t.place[i].add(Math.round(box[i].left - at.left));
          if (t.keys[i].at(-1)?.[0] === e.textContent) return;
          t.keys[i].push([e.textContent, fired.chain, fired.due]);
          if (whole[i]) t.shown[i].push(e.textContent);
        });
        if (whole.every(Boolean)) t.pairs++;
        if (whole.every(Boolean) && spots[0].textContent === spots[1].textContent) t.same++;
        whole.forEach((v, i) => {
          if (v) return;
          t.typing++;
          if (!carets[i] || getComputedStyle(carets[i]).opacity !== '1') t.unlit++;
        });
      };
      new MutationObserver(look).observe(p, { subtree: true, childList: true, characterData: true, attributes: true });
      setInterval(look, 50);
      look();
    },
    [NAMES, LEADS, TAIL, OPEN],
  );

const typedOf = (page) =>
  page.evaluate(([leads, tail, open]) => {
    const t = window.__typed;
    const list = (v) => [...v];
    const p = document.querySelector('[data-site=typed]');
    const range = document.createRange();
    const edge = (node) => {
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    };
    const spots = [...p.querySelectorAll('[data-site=agent]')];
    const carets = [...p.querySelectorAll('.site-caret')].map((e) => e.getBoundingClientRect());
    const probe = p.appendChild(document.createElement('span'));
    const token = (name) => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color;
    };
    const tokens = { muted: token('--muted'), border: token('--border'), page: getComputedStyle(document.body).backgroundColor };
    probe.remove();
    const boxes = [...p.querySelectorAll('[data-site=box]')].map((e) => {
      const r = e.getBoundingClientRect();
      const c = getComputedStyle(e);
      const sides = ['Top', 'Right', 'Bottom', 'Left'];
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, ground: c.backgroundColor, image: c.backgroundImage, shadow: c.boxShadow, ink: c.color, edges: sides.map((v) => `${c[`border${v}Width`]} ${c[`border${v}Style`]} ${c[`border${v}Color`]}`), radius: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((v) => parseFloat(c[`border${v}Radius`])) };
    });
    const words = [];
    let end = null;
    let first = null;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest('.sr-only')) continue;
      if (n.textContent === open) first = edge(n);
      if (leads.includes(n.textContent)) words.push(edge(n));
      if (n.textContent.trim() === tail) end = edge(n);
    }
    const at = p.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(p).lineHeight);
    const row = (r) => (r ? Math.floor(((r.top + r.bottom) / 2 - at.top) / line) : -1);
    const rows = spots.map((e, i) => {
      const r = e.getBoundingClientRect();
      const c = carets[i];
      const word = [...e.childNodes].find((n) => n.nodeType === 3);
      return { top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2, on: !!c && c.top + c.height / 2 > r.top && c.top + c.height / 2 < r.bottom, after: !!c && c.left >= (word ? edge(word).right : r.left) - 0.5 };
    });
    const ends = [...words, ...spots.map((e) => e.getBoundingClientRect()), ...carets, ...boxes].filter((r) => row(r) === row(end)).map((r) => r.right);
    return {
      ...t,
      asked: window.__timers?.asked ?? {},
      open: list(t.open),
      stack: [first, words[0], spots[0]?.getBoundingClientRect(), words[1], spots[1]?.getBoundingClientRect(), end].map(row),
      place: t.place.map(list),
      lead: t.lead.map(list),
      tail: list(t.tail),
      tall: list(t.tall),
      top: list(t.top),
      drop: list(t.drop),
      under: list(t.under),
      said: list(t.said),
      carets: carets.length,
      rows,
      line,
      em: parseFloat(getComputedStyle(p).fontSize),
      high: p.getBoundingClientRect().height,
      boxes,
      tokens,
      boxed: t.boxed.map(list),
      held: boxes.length === 2 && carets.length === 2 && boxes.every((r, i) => carets[i].left >= r.left && carets[i].right <= r.right && carets[i].top + carets[i].height / 2 > r.top && carets[i].top + carets[i].height / 2 < r.bottom),
      gap: words[1] && boxes[0] ? words[1].left - boxes[0].right : NaN,
      space: end && boxes[1] ? end.left - boxes[1].right : NaN,
      low: !!end && !!rows[1] && (end.top + end.bottom) / 2 > rows[1].top && (end.top + end.bottom) / 2 < rows[1].bottom,
      last: !!end && end.right >= Math.max(...ends) - 0.5,
    };
  }, [LEADS, TAIL, OPEN]);

function hand(log, asked) {
  const votes = {};
  for (const v of log.slice(1)) votes[v[1]] = (votes[v[1]] ?? 0) + 1;
  const waits = asked[Object.keys(votes).sort((a, z) => votes[z] - votes[a])[0]] ?? [];
  const out = { texts: log.map((v) => v[0]), type: [], erase: [], pause: [], starts: [] };
  let steps = 0;
  for (let k = 1; k < log.length; k++) {
    for (let was = log[k - 1][0]; was !== log[k][0]; steps++) {
      const next = log[k][0].startsWith(was) ? log[k][0].slice(0, was.length + 1) : was.slice(0, -1);
      if (next.length < was.length) (NAMES.includes(was) ? out.pause : out.erase).push(waits[steps]);
      else if (was) out.type.push(waits[steps]);
      if (NAMES.includes(was)) out.starts.push(log[k][2]);
      was = next;
    }
  }
  return { ...out, lined: waits.length - steps >= 0 && waits.length - steps <= 1 };
}

function rhythm(log) {
  const out = { on: [], off: [], starts: [] };
  for (let k = 1; k < log.length; k++) {
    if (log[k - 1][0] < 2 || log[k][0] < 2) continue;
    (log[k][0] === 3 ? out.on : out.off).push(log[k][1]);
    out.starts.push(log[k][2]);
  }
  return out;
}

const ranged = (list, [low, high], kinds) => list.length >= 6 && list.every((v) => v >= low && v <= high) && new Set(list.map((v) => Math.round(v))).size >= kinds;
const near = (a, z, ms) => a.starts.filter((v) => z.starts.some((u) => Math.abs(u - v) <= ms)).length / Math.max(1, a.starts.length);
const reach = (list) => (list.length ? `${list.length} times from ${Math.round(Math.min(...list))} to ${Math.round(Math.max(...list))} ms` : 'no times');
const sized = (loc) =>
  loc.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { width: r.width, mid: r.top + r.height / 2, wide: e.offsetWidth, shift: getComputedStyle(e).transform };
  });
const scaled = (now, calm) => (calm?.width > 0 && now?.width > 0 ? now.width / calm.width : 0);
const steady = (typed) => typed.tall.length === 1 && Math.abs(typed.tall[0] - typed.line) < 1 && typed.top.length === 1 && typed.under.length === 1 && typed.drop.join() === '0' && typed.open.length === 1 && typed.lead[0].length === 1 && typed.place[0].length === 1 && typed.out === 0;
const placed = (typed) => `heights ${typed.tall.join(' ')}, line ${typed.line}, tops ${typed.top.join(' ')}, "${OPEN} ${LEADS[0]}" ${typed.open.join(' or ')} and ${typed.lead[0].join(' or ')} px and "${LEADS[1]}" ${typed.lead[1].length} places from the left, ${typed.out} moments past the column, sentence at ${typed.under.join(' ')}`;

async function walk(b, site, w, h, scheme) {
  const tag = `${scheme} ${w}x${h}`;
  const wide = w >= 1000;
  const other = scheme === 'light' ? 'dark' : 'light';
  const { ctx, page, errors, touch } = await context(b, { w, h, scheme });
  const cdp = touch && engine === 'chromium' ? await ctx.newCDPSession(page) : null;
  const asked = [];
  page.on('request', (r) => asked.push(r.url()));
  const tap = (loc) => (touch ? loc.tap() : loc.click());
  try {
    await ctx.addInitScript(seeded, 1);
    await page.goto(site.url);
    await ready(page);
    await watch(page);

    const first = [await box(page, 'h1'), await box(page, '[data-site=typed]'), await box(page, '[data-site=line]'), await box(page, '[data-site=action] a >> nth=0'), await box(page, '[data-site=action] a >> nth=1')];
    check(`${tag} the name, the typed line, the sentence and both pills are inside the first screen`, first.every((r) => inside(r, w, h)), first.map(span).join(', '));
    const rows = await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('[data-site=line]'));
      const by = new Map();
      for (const r of range.getClientRects()) by.set(Math.round(r.top), (by.get(Math.round(r.top)) ?? 0) + r.width);
      return [...by.values()].map((v) => Math.round(v));
    });
    check(`${tag} no row of the sentence under the typed line is shorter than half of the longest row`, rows.length > 0 && Math.min(...rows) >= Math.max(...rows) / 2, `rows of ${rows.join(' and ')} px`);
    const frame = await box(page, '[data-site=demo]');
    const column = await box(page, '[data-site=column]');
    check(`${tag} the top of the demo frame is inside the first screen`, !!frame && frame.y > 0 && frame.y < h - 40, `frame ${span(frame)}`);
    check(`${tag} the text column is ${w >= 720 ? 'between 600 and 700 px wide' : 'as wide as the screen allows'}`, !!column && (w >= 720 ? column.width >= 600 && column.width <= 700 : Math.abs(column.width - (w - (w >= 640 ? 64 : 32))) <= 1), `${Math.round(column?.width ?? 0)} px`);
    check(`${tag} the demo frame is ${wide ? 'wider than the text column and at most 1100 px' : 'no wider than the screen'}`, !!frame && !!column && (wide ? frame.width >= column.width + 200 && frame.width <= 1100.5 : frame.width <= w), `${Math.round(frame?.width ?? 0)} px`);
    await page.waitForTimeout(700);
    const rest = await top(page);

    let scene = await centre(page);
    const slider = await box(page, '[data-slot=slider]');
    check(`${tag} the scene and the time slider fit in one screen`, inside(scene, w, h) && inside(slider, w, h) && scene.height >= 200, scene && slider ? `scene ${Math.round(scene.width)} by ${Math.round(scene.height)}, slider ends at ${Math.round(slider.y + slider.height)}` : 'missing');
    await page.waitForTimeout(1600);
    const played = await readout(page);
    check(`${tag} the demo day plays from 08:00 and the page stays at the top until a press`, played > START && played < END && rest === 0, `${clock(played)}, scroll ${rest} before the first press`);

    const thumb = page.locator('[data-slot=slider-thumb]');
    const tb = await thumb.boundingBox();
    const track = await page.locator('[data-slot=slider]').boundingBox();
    await drag(page, touch, cdp, tb.x + tb.width / 2, tb.y + tb.height / 2, track.x + track.width * 0.35, tb.y + tb.height / 2);
    await page.waitForTimeout(300);
    const dragged = await readout(page);
    await page.waitForTimeout(700);
    const rested = await readout(page);
    check(`${tag} the slider moves by pointer`, Math.abs(dragged - (START + 0.35 * (END - START))) <= 40 && rested === dragged, `${clock(dragged)} then ${clock(rested)}`);

    await thumb.focus();
    await page.keyboard.press('End');
    const last = await readout(page);
    await page.keyboard.press('ArrowLeft');
    const back = await readout(page);
    await page.keyboard.press('End');
    check(`${tag} the slider moves by keyboard`, last === END && back === END - 1, `End gives ${clock(last)}, ArrowLeft gives ${clock(back)}`);
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(2, 2);
    scene = await centre(page);
    await page.waitForTimeout(1500);

    const drawn = await paint(page);
    check(`${tag} the scene draws real pixels`, drawn.share > 0.02 && drawn.hues >= 2, `${drawn.coloured} coloured pixels in ${drawn.hues} hues, ${(drawn.share * 100).toFixed(1)} percent of the scene`);

    const look = await page.evaluate(() => ({ ground: getComputedStyle(document.body).backgroundColor, tones: [getComputedStyle(document.body).color, getComputedStyle(document.querySelector('footer')).borderTopColor] }));
    const seen = (site.tones[scheme] ??= look.tones);
    check(`${tag} the page follows the system theme`, look.ground === GROUND[scheme] && seen.join() === look.tones.join() && (!site.tones[other] || look.tones.every((v, i) => v !== site.tones[other][i])), `ground ${look.ground}, text ${look.tones[0]}, footer rule ${look.tones[1]}`);

    const toggle = page.locator('nav [role=switch]');
    const was = await toggle.getAttribute('aria-checked').catch(() => null);
    await page.evaluate(() => scrollTo(0, 0));
    await tap(toggle).catch(() => {});
    await centre(page);
    await page.waitForTimeout(900);
    const forced = { ground: await ground(page), light: (await paint(page)).light, on: await toggle.getAttribute('aria-checked').catch(() => null) };
    await page.evaluate(() => scrollTo(0, 0));
    await tap(toggle).catch(() => {});
    scene = await centre(page);
    await page.waitForTimeout(900);
    const home = { ground: await ground(page), light: (await paint(page)).light };
    const key = `${w}x${h}`;
    const mine = ((site.light[key] ??= {})[scheme] = { own: drawn.light, forced: forced.light });
    const twin = site.light[key][other];
    const same = !twin || (Math.abs(forced.light - twin.own) <= 4 && Math.abs(twin.forced - mine.own) <= 4);
    check(
      `${tag} the theme switch turns the page and the scene to the other theme and back`,
      was === String(scheme === 'dark') && forced.on === String(scheme !== 'dark') && forced.ground === GROUND[other] && Math.abs(forced.light - drawn.light) > 40 && home.ground === GROUND[scheme] && Math.abs(home.light - drawn.light) <= 4 && same,
      `scene light ${drawn.light.toFixed(1)} to ${forced.light.toFixed(1)} to ${home.light.toFixed(1)}${twin ? `, the ${other} run had ${twin.own.toFixed(1)} and ${twin.forced.toFixed(1)}` : ''}`,
    );

    const id = await open(page, touch, drawn.spots);
    const title = id ? ((await page.locator('[data-panel] h2').textContent()) ?? '').trim() : '';
    check(`${tag} a press on a block opens a card`, !!id && title.length > 3, `item ${id}, ${title}`);
    if (touch) await page.locator('[data-slot=sheet-close]').tap().catch(() => {});
    else await page.mouse.click(4, 4);
    const closed = await waitFor(async () => !(await panel(page)), 3000);
    check(`${tag} the card can be closed`, !!id && closed);
    await page.waitForTimeout(600);

    const cx = scene.x + scene.width / 2;
    const cy = scene.y + scene.height / 2;
    const from = await top(page);
    if (touch && cdp) await touchDrag(page, cdp, cx, cy + 70, cx, cy - 130);
    else {
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, 320);
    }
    const moved = await waitFor(async () => ((await top(page)) > from + 60 ? (await top(page)) - from : 0), 2000);
    check(`${tag} the page scrolls from over the scene`, moved > 60, `scrolled ${moved}`);
    await settle(page);
    await page.mouse.move(2, 2);
    scene = await centre(page);
    await page.waitForTimeout(300);

    const before = await labels(page);
    const held = await top(page);
    await drag(page, touch, cdp, scene.x + scene.width * 0.8, scene.y + scene.height * 0.9, scene.x + scene.width * 0.4, scene.y + scene.height * 0.9);
    await page.waitForTimeout(600);
    const after = await labels(page);
    const turned = before.length && after.length ? Math.max(...before.map((a, i) => Math.hypot(a.x - (after[i]?.x ?? a.x), a.y - (after[i]?.y ?? a.y)))) : 0;
    check(`${tag} a drag turns the scene`, turned > 8 && (await top(page)) === held, `label moved ${turned.toFixed(1)} px`);

    const o = await across(page, w);
    check(`${tag} nothing is wider than the screen`, o.ok, o.text);

    const s = await shape(page);
    check(`${tag} the page has exactly one h1 and exactly one h2 and the h2 says FAQ`, s.h1.length === 1 && s.h1[0] === 'agent-ctx' && s.h2.length === 1 && s.h2[0] === 'FAQ', `h1 ${s.h1.join(' and ')}, h2 ${s.h2.join(' and ')}`);
    const sentences = (a) => (a.match(/[.!?](?=\s|$)/g) ?? []).length;
    const weak = s.items.filter((i) => !i.q.endsWith('?') || i.a.length < 20 || sentences(i.a) < 1 || sentences(i.a) > 2);
    check(`${tag} eight questions exist and each has an answer of one or two sentences`, s.items.length === 8 && !weak.length, `${s.items.length} questions${weak.length ? `, weak ${weak.map((i) => i.q).join(' ')}` : ''}`);
    const rowed = s.rows.length === 8;
    if (wide) check(`${tag} every question starts left of the answer of the same row and on the same top line`, rowed && s.rows.every((r) => r.share > 0.25 && r.share < 0.42 && Math.abs(r.top[0] - r.top[1]) <= 2), `${s.rows.length} rows, the answer starts after ${s.rows.map((r) => Math.round(r.share * 100)).join(' ')} percent of the row`);
    else check(`${tag} each answer starts below the question of the same row`, rowed && s.rows.every((r) => r.top[1] >= r.end - 0.5 && Math.abs(r.left[0] - r.left[1]) < 1), `${s.rows.length} rows, ${s.rows.map((r) => Math.round(r.top[1] - r.end)).join(' ')} px under the question`);
    check(`${tag} every FAQ row has a top line of 1 px in the border colour`, rowed && s.rows.every((r) => r.line === `1px solid ${s.rule}`), `${[...new Set(s.rows.map((r) => r.line))].join(' | ')} with the border colour ${s.rule}`);
    if (wide) check(`${tag} the question has the weight, the size and the colour of the answer`, rowed && s.rows.every((r) => r.same && r.weight[0] === r.weight[1]), `weights ${s.rows[0]?.weight.join(' and ')}`);
    else check(`${tag} the stacked question is a little heavier than the answer at the same size and colour`, rowed && s.rows.every((r) => r.same && r.weight[0] > r.weight[1] && r.weight[0] <= 500), `weights ${s.rows[0]?.weight.join(' and ')}`);
    check(`${tag} the name agent-ctx is never broken across two lines in the FAQ`, s.named === 8 && !s.split.length, `${s.named} times${s.split.length ? `, broken in ${s.split.join(' | ')}` : ''}`);
    check(`${tag} no small label sits above a heading or beside the demo`, !s.marks.length, s.marks.join(' | '));
    check(`${tag} fewer than 60 words stand outside the FAQ and the demo frame`, s.words > 20 && s.words < 60, `${s.words} words`);
    check(`${tag} the top bar holds the GitHub link and the theme switch and nothing else`, !!s.nav && s.nav.parts === 3 && s.nav.toggles === 1 && s.nav.links.length === 1 && s.nav.links[0] === HOME && s.nav.text.join(' ') === 'GitHub Dark', s.nav ? s.nav.text.join(' ') : 'missing');
    check(
      `${tag} the main pill goes to GitHub, the plain pill to the FAQ, and the testing line shows`,
      s.pills.length === 2 && s.pills[0].join() === ['View on GitHub', HOME, 'default'].join() && s.pills[1].join() === ['Read the FAQ', '#faq', 'outline'].join() && /first release is being tested/.test(s.status),
      s.pills.map((p) => p[0]).join(' and '),
    );
    check(`${tag} no bar and no drawing stands in the FAQ`, s.items.length === 8 && s.bars === 0, `${s.bars} found`);
    check(`${tag} the footer holds the licence, the repository link and the cookie sentence${wide ? ' in one line' : ''}`, !!s.foot && /\bMIT\b/.test(s.foot.text) && s.foot.links.includes(HOME) && /No cookie is set/.test(s.foot.text) && /another host/.test(s.foot.text) && (!wide || new Set(s.foot.tops).size === 1), s.foot ? `${new Set(s.foot.tops).size} lines` : 'missing');

    const t = await texts(page);
    const bad = faults(t.out);
    check(`${tag} the wording rules hold in every text node`, t.out.length > 40 && !bad.length, bad.slice(0, 4).join(' | '));
    check(`${tag} a question mark stands only on the eight questions`, !t.asked.length, t.asked.slice(0, 3).join(' | '));
    check(`${tag} no setup prompt is shown`, !t.out.join('\n').includes('setup.md') && !(await page.locator('[data-site=install]').count()));

    await waitFor(() => page.evaluate(() => window.__typed.shown.every((v) => v.length >= 2)), 15000);
    const typed = await typedOf(page);
    const level = typed.rows.length === 2 && Math.abs(typed.rows[0].top - typed.rows[1].top) < 1;
    const spaced = (v) => v > 0.15 * typed.em && v < 0.45 * typed.em;
    const tight = (v) => v > -0.5 && v < 0.1 * typed.em;
    const stacked = `rows ${typed.stack.map((v) => v + 1).join(' ')} for "${OPEN}", "${LEADS[0]}", the first name, "${LEADS[1]}", the second name and the full stop, ${Math.round(typed.high)} px tall with a line height of ${typed.line} px`;
    if (wide) {
      check(`${tag} the typed sentence is one line`, typed.carets === 2 && level && Math.abs(typed.high - typed.line) < 1, `${Math.round(typed.high)} px tall with a line height of ${typed.line} px`);
      check(`${tag} the first box stands before "to" with one word space`, level && typed.rows[0].on && typed.rows[0].after && spaced(typed.gap), `${typed.gap.toFixed(1)} px from the first box to the next word`);
    } else check(`${tag} the typed block has three rows, "${OPEN}" on row one, "${LEADS[0]}" with the first name on row two and "${LEADS[1]}" with the second name on row three`, typed.carets === 2 && typed.rows.length === 2 && typed.rows.every((r) => r.on && r.after) && typed.stack.join(' ') === '0 1 1 2 2 2' && Math.abs(typed.high - 3 * typed.line) < 1, stacked);
    check(`${tag} the full stop stands outside the second box, right after that box, and ends the row of the second name`, typed.rows.length === 2 && typed.rows[1].on && typed.rows[1].after && tight(typed.space) && typed.low && typed.last, `${typed.space.toFixed(1)} px from the second box to the full stop`);
    const [one, two] = typed.boxes;
    const lum = (text) => {
      const [r, g, b] = text.match(/[\d.]+/g).slice(0, 3).map((v) => Number(v) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const against = (a, z) => (Math.max(lum(a), lum(z)) + 0.05) / (Math.min(lum(a), lum(z)) + 0.05);
    const both = typed.boxes.length === 2;
    check(`${tag} the ground of both boxes is the muted token and the border is a hairline in the border token, and both differ from the ground of the page`, both && typed.boxes.every((v) => v.ground === typed.tokens.muted && v.ground !== typed.tokens.page && v.image === 'none' && v.shadow === 'none' && v.edges.every((e) => e === `1px solid ${typed.tokens.border}`)) && typed.tokens.border !== typed.tokens.page, both ? `ground ${one.ground} with the token ${typed.tokens.muted}, border ${one.edges[0]} with the token ${typed.tokens.border}, page ${typed.tokens.page}` : `${typed.boxes.length} boxes`);
    check(`${tag} each box has a corner radius of about a third of an em`, both && typed.boxes.every((v) => v.radius.every((r) => r > 0.28 * typed.em && r < 0.4 * typed.em)), both ? `${one.radius.join(' ')} px at ${typed.em} px` : `${typed.boxes.length} boxes`);
    check(`${tag} each cursor stands inside the box of that name after the last letter`, typed.held && typed.rows.every((r) => r.on && r.after), `${typed.boxes.length} boxes and ${typed.carets} cursors`);
    check(`${tag} an empty box keeps a small width that holds the cursor`, typed.bare.every((v) => v.length > 0 && v.every((w) => w > 0.5 * typed.em && w < 1.6 * typed.em)), typed.bare.map((v) => (v.length ? `${Math.min(...v).toFixed(1)} px in ${v.length} looks` : 'never seen empty')).join(' and '));
    const play = typed.pad.map((v) => (v.length ? Math.max(...v) - Math.min(...v) : NaN));
    check(`${tag} the width of each box follows the letters in the same step with no transition`, typed.pad.every((v) => v.length > 20) && play.every((v) => v < 0.3) && typed.eased === 0, `${typed.pad.map((v, i) => `${v.length} looks with ${play[i].toFixed(2)} px of play`).join(' and ')}, ${typed.eased} looks with a transition`);
    check(`${tag} no box changes height or top while the names change`, typed.boxed.every((v) => v.length === 1) && typed.tall.length === 1, typed.boxed.map((v) => v.join(' or ') || 'no box').join(' and '));
    if (!wide) check(`${tag} the boxes of row two and row three keep a gap of at least 4 px`, both && two.top - one.bottom >= 4, both ? `${(two.top - one.bottom).toFixed(1)} px` : `${typed.boxes.length} boxes`);
    check(`${tag} the text in each box has a contrast of at least 4.5 to 1 against the box`, both && typed.boxes.every((v) => against(v.ink, v.ground) >= 4.5), both ? `${against(one.ink, one.ground).toFixed(1)} to 1` : `${typed.boxes.length} boxes`);
    check(`${tag} each spot of the typed block shows at least two agent names over time`, typed.shown.every((v) => new Set(v).size >= 2), typed.shown.map((v) => v.join(', ')).join(' and '));
    check(`${tag} the two spots never show the same complete name at one moment`, typed.pairs > 0 && typed.same === 0, `${typed.same} of ${typed.pairs} moments with two complete names`);
    if (wide) check(`${tag} the typed line keeps one height, "${OPEN} ${LEADS[0]}" never moves and the words after the first name move sideways`, steady(typed) && typed.lead[1].length > 1 && typed.tail.length > 1, placed(typed));
    else check(`${tag} the typed block stays three rows tall and no name and nothing under the block moves`, typed.tall.length === 1 && Math.abs(typed.tall[0] - 3 * typed.line) < 1 && typed.under.length === 1 && typed.open.length === 1 && typed.place.every((v) => v.length === 1) && typed.lead.every((v) => v.length === 1) && typed.tail.length > 1 && typed.out === 0, `heights ${typed.tall.join(' ')}, line ${typed.line}, names ${typed.place.map((v) => v.join(' or ')).join(' and ')} px from the left, sentence at ${typed.under.join(' ')}`);
    check(`${tag} the cursor that types stays lit`, typed.typing > 0 && typed.unlit === 0, `${typed.unlit} of ${typed.typing} moments with a dark cursor in a word`);
    const underlined = await page.evaluate(() => {
      const p = document.querySelector('[data-site=typed]');
      return [p, ...p.querySelectorAll('*')].filter((e) => getComputedStyle(e).textDecorationLine !== 'none').length;
    });
    const inked = await page.evaluate(() => ({ text: getComputedStyle(document.body).color, logo: [...new Set([...document.querySelectorAll('[data-site=logo] [data-part]')].map((e) => getComputedStyle(e).fill))] }));
    check(`${tag} the logo has the foreground colour of the page`, inked.logo.length === 1 && inked.logo[0] === inked.text, `logo ${inked.logo.join(' ') || 'missing'}, text ${inked.text}`);
    check(`${tag} no word of the typed sentence has an underline`, underlined === 0, `${underlined} underlined parts`);
    check(`${tag} screen readers get one still sentence and no live updates while names change`, s.spoken === SPOKEN && typed.said.length === 1 && !s.live, typed.said.join(' | '));

    const axe = await new AxeBuilder({ page }).analyze();
    const hits = axe.violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
    check(`${tag} the page has no accessibility violation`, !hits.length, hits.slice(0, 4).join(' | '));

    check(`${tag} no cookie is set and nothing is stored`, s.cookie === '' && s.kept === 0 && !(await ctx.cookies()).length);
    const away = asked.filter((u) => !u.startsWith(site.url));
    check(`${tag} every request stays under ${BASE} on the local server`, asked.length > 3 && !away.length, `${asked.length} requests${away.length ? `, away ${away.slice(0, 3).join(' ')}` : ''}`);
    check(`${tag} the page has no console error`, !errors.length, errors.join(' | '));
  } finally {
    await ctx.close();
  }
}

async function released(b, site, w, h) {
  const tag = `released ${w}x${h}`;
  const { ctx, page, errors, touch } = await context(b, { w, h, scheme: 'dark' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin }).catch(() => {});
  try {
    await page.goto(site.url);
    await ready(page);
    const copy = page.locator('[data-site=action]').getByRole('button', { name: 'Copy' });
    const pill = await page.evaluate(() => {
      const e = document.querySelector('[data-site=install]');
      if (!e) return { text: '', said: '', title: '', room: 0, need: 1, flow: '', cut: '', mono: false };
      const said = e.cloneNode(true);
      for (const x of said.querySelectorAll('[aria-hidden]')) x.remove();
      e.scrollLeft = 80;
      const part = [...e.querySelectorAll('*')].find((x) => getComputedStyle(x).textOverflow === 'ellipsis') ?? e;
      const range = document.createRange();
      range.selectNodeContents(e.querySelector('.select-all') ?? e);
      const rects = [...range.getClientRects()];
      const edge = e.getBoundingClientRect();
      const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      let parts = -1;
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        const at = node.textContent.indexOf('agent-ctx');
        if (at < 0) continue;
        const name = document.createRange();
        name.setStart(node, at);
        name.setEnd(node, at + 9);
        parts = name.getClientRects().length;
      }
      return { text: e.textContent, said: said.textContent.trim(), title: e.getAttribute('title') ?? '', room: e.clientWidth, need: e.scrollWidth, moved: e.scrollLeft, over: e.getBoundingClientRect().right - (document.querySelector('[data-site=column]')?.getBoundingClientRect().right ?? 0), flow: getComputedStyle(e).overflowX, cut: `${getComputedStyle(part).textOverflow} ${getComputedStyle(part).whiteSpace}`, high: e.getBoundingClientRect().height, rows: new Set(rects.map((r) => Math.round(r.top))).size, parts, held: rects.length > 0 && rects.every((r) => r.left >= edge.left - 0.5 && r.right <= edge.right + 0.5 && r.top >= edge.top - 0.5 && r.bottom <= edge.bottom + 0.5), mono: /mono/i.test(getComputedStyle(e).fontFamily) };
    });
    const s = await shape(page);
    check(
      `${tag} the prompt pill with Copy and the plain pill to GitHub are inside the first screen`,
      inside(await box(page, '[data-site=install]'), w, h) && inside(await copy.boundingBox().catch(() => null), w, h) && s.pills.length === 1 && s.pills[0].join() === ['View on GitHub', HOME, 'outline'].join() && inside(await box(page, '[data-site=action] a'), w, h),
      `pill ${span(await box(page, '[data-site=install]'))}, Copy ${span(await copy.boundingBox().catch(() => null))}, link ${span(await box(page, '[data-site=action] a'))}`,
    );
    check(`${tag} the pill shows the prompt in the console font behind a sign that is hidden from a screen reader`, /^>\s*Follow https/.test(pill.text) && pill.said === LINE && pill.title === LINE && pill.mono, pill.text);
    check(`${tag} the link inside the prompt is ${GUIDE}`, (pill.said.match(/https?:\/\/\S+/g) ?? []).join() === GUIDE, (pill.said.match(/https?:\/\/\S+/g) ?? []).join(' '));
    check(`${tag} the whole prompt is visible in the pill, on one row from 640 px and on two rows at most below, with no cut and no scroll, and the pill ends inside the text column`, pill.room > 100 && pill.need <= pill.room && pill.over <= 0.5 && pill.moved === 0 && pill.flow !== 'auto' && pill.flow !== 'scroll' && !/ellipsis/.test(pill.cut) && pill.held && pill.rows >= 1 && pill.rows <= (w >= 640 ? 1 : 2) && pill.high < (w >= 640 ? 50 : 80), `${pill.need} px of content in ${pill.room} px, ${pill.cut}, ${pill.rows} rows, ${Math.round(pill.high ?? 0)} px tall, ${pill.held ? 'all inside' : 'text outside the pill'}`);
    const readme = fs.readFileSync(path.join(web, '..', 'README.md'), 'utf8');
    const lines = [/\n {4}(curl -fsSL \S+ \| sh)\n/.exec(readme)?.[1] ?? 'no curl line', /\n {4}(npx -y \S+)\n/.exec(readme)?.[1] ?? 'no npx line'];
    const hand = s.items.find((i) => /without an agent/.test(i.q));
    check(`${tag} the FAQ has nine rows and one of them holds the two install lines of the README for a setup without an agent`, s.items.length === 9 && !!hand && lines.every((l) => hand.a.includes(l)), hand ? hand.a : `${s.items.length} rows and no such row`);
    const boxes = await page.evaluate(() => {
      const ground = getComputedStyle(document.body).backgroundColor;
      const edge = document.querySelector('[data-site=faq]')?.getBoundingClientRect();
      return [...document.querySelectorAll('[data-site=faq] code')].map((c) => {
        const cs = getComputedStyle(c);
        const rects = [...c.getClientRects()];
        return { text: c.textContent, mono: /mono/i.test(cs.fontFamily), ground: cs.backgroundColor !== ground && cs.backgroundColor !== 'rgba(0, 0, 0, 0)', line: cs.borderTopWidth === '1px', held: !!edge && rects.every((r) => r.left >= edge.left - 0.5 && r.right <= edge.right + 0.5) };
      });
    });
    check(`${tag} each command of the FAQ stands in a box in the console font with a hairline and a ground that differs from the page, inside the column`, boxes.length === 3 && boxes.every((x) => x.mono && x.ground && x.line && x.held) && lines.every((l) => boxes.some((x) => x.text === l)) && boxes.some((x) => /agent-ctx uninstall$/.test(x.text)), boxes.map((x) => `${x.text} ${x.mono ? 'mono' : 'not mono'} ${x.ground ? 'ground' : 'no ground'} ${x.held ? 'inside' : 'outside'}`).join(' | ') || 'no box');
    check(`${tag} the name agent-ctx inside the prompt is never broken across two rows`, pill.parts === 1, `${pill.parts} parts`);
    const button = page.locator('[data-site=action] button');
    const spot = await button.boundingBox().catch(() => null);
    const calm = await sized(button).catch(() => ({ width: 0, mid: 0, wide: 0 }));
    await page.mouse.move((spot?.x ?? 0) + (spot?.width ?? 0) / 2, (spot?.y ?? 0) + (spot?.height ?? 0) / 2);
    await page.mouse.down();
    await page.waitForTimeout(220);
    const down = await sized(button).catch(() => ({ width: 0, mid: 0, wide: 0 }));
    await page.mouse.up();
    const small = scaled(down, calm);
    check(`${tag} while Copy is held down the button has no vertical move and a scale between 0.95 and 0.99`, small >= 0.95 && small <= 0.99 && Math.abs(down.mid - calm.mid) < 0.5, `scale ${small.toFixed(3)}, moved ${(down.mid - calm.mid).toFixed(2)} px`);
    await page.waitForTimeout(450);
    const up = scaled(await sized(button).catch(() => null), calm);
    check(`${tag} within 500 ms after release the scale is 1 again`, Math.abs(up - 1) < 0.003, `scale ${up.toFixed(4)}`);
    const done = await waitFor(() => page.locator('[data-site=action]').getByRole('button', { name: 'Copied' }).count(), 2000);
    const told = await sized(button).catch(() => ({ wide: -1 }));
    const held = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check(`${tag} Copy puts the prompt without the leading sign on the clipboard`, !!done && held === LINE, held);
    const back = await waitFor(() => page.locator('[data-site=action]').getByRole('button', { name: 'Copy', exact: true }).count(), 3000);
    const again = await sized(button).catch(() => ({ wide: -2 }));
    check(`${tag} the Copy button has the same width before a press, in the Copied state and after the return`, !!done && !!back && calm.wide > 0 && told.wide === calm.wide && again.wide === calm.wide, `${calm.wide} then ${told.wide} then ${again.wide} px`);
    await button.focus().catch(() => {});
    await page.keyboard.down('Space');
    await page.waitForTimeout(220);
    const key = scaled(await sized(button).catch(() => null), calm);
    await page.keyboard.up('Space');
    check(`${tag} a press with the Space key gives the same scale as a pointer press`, key > 0 && key < 0.99 && Math.abs(key - small) < 0.006, `scale ${key.toFixed(3)} by key and ${small.toFixed(3)} by pointer`);
    const o = await across(page, w);
    const t = await texts(page);
    const bad = faults(t.out);
    check(`${tag} the testing line is gone, the rules hold and the word count stays under 60`, !s.status && o.ok && !bad.length && !t.asked.length && s.words < 60 && !errors.length, [`${s.words} words`, ...bad, ...errors].slice(0, 3).join(' | '));
  } finally {
    await ctx.close();
  }
}

async function still(b, site) {
  const { ctx, page, errors } = await context(b, { w: 1440, h: 900, scheme: 'dark', reduced: true });
  try {
    await ctx.addInitScript(() => {
      const io = new MutationObserver(() => {
        const svg = document.querySelector('[data-site=logo]');
        const demo = document.querySelector('[data-site=demo]');
        if (!svg || !demo) return;
        window.__first = { draw: svg.getAttribute('data-draw'), held: demo.hasAttribute('data-wait') };
        io.disconnect();
      });
      io.observe(document, { subtree: true, childList: true });
    });
    await page.goto(site.url);
    const drawn = () => page.evaluate(() => [...document.querySelectorAll('[data-site=logo] path')].map((e) => `${e.getAnimations().length} ${getComputedStyle(e).fillOpacity} ${getComputedStyle(e).stroke}`));
    const early = await drawn();
    await ready(page);
    await watch(page);
    const names = async () => (await page.locator('[data-site=agent]').allTextContents()).join(' and ');
    const t0 = await readout(page);
    const n0 = await names();
    await page.waitForTimeout(4200);
    const t1 = await readout(page);
    const n1 = await names();
    const carets = await page.evaluate(() => window.__typed.blink.map((v) => v.map((x) => x[0]).join(' ')));
    const blocks = Number(await page.locator('[aria-roledescription=space]').getAttribute('data-blocks'));
    check('reduced motion leaves the demo still at the end of the day', t0 === END && t1 === END && blocks > 20 && !errors.length, `${clock(t0)} then ${clock(t1)}, ${blocks} blocks`);
    const late = await drawn();
    await page.evaluate(() => scrollTo(0, 0));
    const pill = page.locator('[data-site=action] a >> nth=1');
    const spot = await pill.boundingBox();
    const calm = await sized(pill);
    await page.mouse.move(spot.x + spot.width / 2, spot.y + spot.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(220);
    const down = await sized(pill);
    await page.mouse.move(4, 4);
    await page.mouse.up();
    check('with reduced motion a held button has no transform', down.shift === 'none' && Math.abs(scaled(down, calm) - 1) < 0.0005 && Math.abs(down.mid - calm.mid) < 0.01, `transform ${down.shift}, scale ${scaled(down, calm).toFixed(4)}, moved ${(down.mid - calm.mid).toFixed(2)} px`);
    check('reduced motion leaves the logo still and filled at the start and later', early.length === 27 && [...early, ...late].every((v) => v === '0 1 none'), [...new Set([...early, ...late])].join(' | ') || 'no logo');
    const first = await page.evaluate(() => window.__first ?? null);
    check('with reduced motion the logo is at rest and the scene is asked for at the first sight of the page', first?.draw === 'done' && first.held === false, first ? `drawing state ${first.draw}, scene ${first.held ? 'held back' : 'asked for'}` : 'no logo');
    check('reduced motion leaves the typed lines still with Claude Code and Cursor', n0 === NAMES.slice(0, 2).join(' and ') && n1 === n0 && carets.length === 2 && carets.every((v) => v === '0'), `${n0} then ${n1}, cursor states ${carets.join(' and ')}`);
  } finally {
    await ctx.close();
  }
}

async function chance(b, site, seed, changes) {
  const { ctx, page } = await context(b, { w: 1440, h: 900, scheme: 'dark' });
  await ctx.addInitScript(seeded, seed);
  await page.goto(site.url);
  await page.waitForSelector('[data-site=typed]');
  await watch(page);
  await ready(page);
  await waitFor(() => page.evaluate((n) => window.__typed.shown.every((v) => v.length > n && new Set(v).size >= 3), changes), 90000, 500);
  return { ctx, page, typed: await typedOf(page) };
}

async function random(b, site) {
  const one = await chance(b, site, 1, 4);
  try {
    const { page, typed } = one;
    const hands = typed.keys.map((log) => hand(log, typed.asked));
    const all = hands.flatMap((v) => v.texts);
    const odd = all.filter((v) => !NAMES.some((n) => n.startsWith(v)));
    check('with seed 1 every shown text is the start of one of the names', all.length > 40 && !odd.length, `${all.length} texts${odd.length ? `, odd ${odd.slice(0, 3).join(' | ')}` : ''}`);
    check('with seed 1 the two complete names are never the same at one moment', typed.pairs > 0 && typed.same === 0, `${typed.same} of ${typed.pairs} moments with two complete names`);
    check('with seed 1 the page starts with Claude Code and Cursor and each spot shows at least three different names in four changes', typed.shown.every((v, i) => v[0] === NAMES[i] && v.length > 4 && new Set(v).size >= 3), typed.shown.map((v) => v.join(', ')).join(' and '));
    check('with seed 1 the key delays of each spot have at least four different lengths inside the ranges', hands.every((v) => v.lined && ranged(v.type, [60, 170], 4) && ranged(v.erase, [30, 80], 4)), hands.map((v, i) => `spot ${i + 1} types ${reach(v.type)} and deletes ${reach(v.erase)}`).join(', '));
    const pauses = hands.flatMap((v) => v.pause);
    const share = [near(hands[0], hands[1], 40), near(hands[1], hands[0], 40)];
    check('with seed 1 the pauses differ from each other and the two spots start changes at different moments', ranged(pauses, [1500, 5000], pauses.length) && share.every((v) => v < 1 / 3), `pauses ${pauses.map((v) => Math.round(v)).join(' ')} ms, ${share.map((v) => Math.round(v * 100)).join(' and ')} percent of the starts near a start of the other spot`);
    check(`the typed line keeps one height and one top while both names change and "${OPEN} ${LEADS[0]}" never moves`, steady(typed), placed(typed));
    const beats = typed.blink.map(rhythm);
    const both = [near(beats[0], beats[1], 40), near(beats[1], beats[0], 40)];
    check(
      'each idle cursor blinks in a random rhythm and the two cursors do not toggle together',
      beats.every((v) => ranged(v.on, [350, 900], 3) && ranged(v.off, [200, 550], 3)) && both.every((v) => v < 1 / 3),
      beats.map((v, i) => `cursor ${i + 1} on ${reach(v.on)} and off ${reach(v.off)}, ${Math.round(both[i] * 100)} percent of ${v.starts.length} toggles near a toggle of the other cursor`).join(', '),
    );
    const state = () => page.evaluate(() => [...document.querySelectorAll('[data-site=agent]')].map((e) => e.textContent).join(' and ') + window.__typed.blink.map((v) => ` ${v.length}`).join(''));
    const hide = (hidden) =>
      page.evaluate((v) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => v });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await hide(true);
    await page.waitForTimeout(300);
    const dark = await state();
    await page.waitForTimeout(3000);
    const kept = await state();
    await hide(false);
    await page.waitForTimeout(6000);
    const woke = await state();
    check('no name changes and no cursor blinks while the page is hidden, and both go on afterwards', kept === dark && woke !== kept, `${dark} then ${kept} then ${woke}`);
    const two = await chance(b, site, 2, 3);
    try {
      const order = (v) => v.shown.map((names) => names.slice(0, 4).join(' > ')).join(' and ');
      check('with seed 2 the order of names differs from the order with seed 1', order(two.typed) !== order(typed), `${order(typed)} against ${order(two.typed)}`);
    } finally {
      await two.ctx.close();
    }
  } finally {
    await one.ctx.close();
  }
}

async function fit(b, site) {
  for (const [w, lines, where] of [[1440, 1, ''], [EDGE[0], 1, ', just above the switch to one line'], [EDGE[1], 2, ', just below the switch to one line'], [EDGE[2], 2, ', just above the switch to two lines'], [EDGE[3], 3, ', just below the switch to two lines'], [390, 3, ''], [360, 3, '']]) {
    const { ctx, page } = await context(b, { w, h: 800, scheme: 'dark', reduced: true });
    try {
      await page.goto(site.url);
      await ready(page);
      const got = await page.evaluate(
        ([names, tail, open]) => {
          const p = document.querySelector('[data-site=typed]');
          const spots = [...p.querySelectorAll('[data-site=agent]')];
          const carets = [...p.querySelectorAll('.site-caret')];
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          const range = document.createRange();
          let end = null;
          let first = null;
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.parentElement.closest('.sr-only')) continue;
            if (n.textContent === open) first = n;
            if (n.textContent.trim() === tail) end = n;
          }
          const line = parseFloat(getComputedStyle(p).lineHeight);
          const out = { room: p.getBoundingClientRect().width, pairs: 0, fits: [0, 0, 0, 0], wide: 0, pair: '' };
          if (spots.length !== 2 || carets.length !== 2 || !end || !first || p.querySelectorAll('[data-site=box]').length !== 2) return out;
          for (const a of names)
            for (const z of names) {
              if (a === z) continue;
              spots[0].firstChild.nodeValue = a;
              spots[1].firstChild.nodeValue = z;
              range.selectNodeContents(first);
              const head = range.getBoundingClientRect();
              range.selectNodeContents(end);
              const at = p.getBoundingClientRect();
              const last = range.getBoundingClientRect();
              const size = Math.max(head.right, last.right, ...[...carets, ...p.querySelectorAll('[data-site=box]')].map((c) => c.getBoundingClientRect().right)) - at.left;
              const rows = new Set([head.top, ...spots.map((e) => e.getBoundingClientRect().top), last.top].map((v) => Math.round((v - at.top) / line))).size;
              out.pairs++;
              if (size > out.wide) Object.assign(out, { wide: size, pair: `${a} and ${z}` });
              if (size <= at.width + 0.5 && Math.round(at.height / line) === rows) out.fits[rows]++;
            }
          return out;
        },
        [NAMES, TAIL, OPEN],
      );
      const all = NAMES.length * (NAMES.length - 1);
      const told = `the longest line ends at ${got.wide.toFixed(1)} px with ${got.pair} in a column of ${got.room} px, ${got.fits.slice(1).join(' and ')} pairs fit on one, two and three lines`;
      if (lines === 1) check(`at ${w} px wide${where}, every pair of two names fits on one line`, got.pairs === all && got.fits[1] === all, told);
      else if (lines === 2) check(`at ${w} px wide${where}, the typed block has two lines and each line fits with every name`, got.pairs === all && got.fits[2] === all, told);
      else check(`at ${w} px wide${where}, the typed block has three lines and every line fits with every name`, got.pairs === all && got.fits[3] === all, told);
    } finally {
      await ctx.close();
    }
  }
}

function sampled() {
  const logo = (window.__logo = { tops: new Set(), frames: 0, got: null, at: 0, done: 0 });
  const tick = () => {
    const typed = document.querySelector('[data-site=typed]');
    if (typed) logo.tops.add(Math.round(typed.getBoundingClientRect().top * 100) / 100);
    logo.frames++;
    requestAnimationFrame(tick);
  };
  const look = () => {
    const svg = document.querySelector('[data-site=logo]');
    if (!svg) return;
    if (!logo.frames) tick();
    if (logo.got && !logo.done && svg.getAttribute('data-draw') === 'done') logo.done = performance.now();
    if (logo.got) return;
    const paths = [...svg.querySelectorAll('path')];
    const runs = paths.flatMap((e) => e.getAnimations());
    if (!runs.length) return;
    const num = (v) => parseFloat(v) || 0;
    const timing = (a) => a.effect.getComputedTiming();
    const end = Math.max(...runs.map((a) => Number(timing(a).endTime) || 0));
    const seek = (t) => {
      for (const a of runs) a.currentTime = t;
    };
    const shapes = [...svg.querySelectorAll('[data-part]')].map((fill) => {
      const lines = fill.parentElement === svg ? [] : [...fill.parentElement.querySelectorAll('[data-line]')];
      return { fill, lines, start: Math.min(...[fill, ...lines].flatMap((e) => e.getAnimations().map((a) => timing(a).delay))) };
    });
    const lines = shapes.flatMap((v) => v.lines);
    const traces = lines.flatMap((e) => e.getAnimations().filter((a) => a.effect.getKeyframes().some((k) => 'strokeDashoffset' in k)));
    const sizes = lines.map((e) => e.getTotalLength());
    const whole = sizes.reduce((a, v) => a + v, 0);
    const traced = (t) => {
      seek(t);
      return lines.reduce((a, e, i) => a + sizes[i] * (1 - Math.min(1, num(getComputedStyle(e).strokeDashoffset))), 0) / (whole || 1);
    };
    const shown = (e) => {
      const c = getComputedStyle(e);
      return c.stroke !== 'none' && num(c.strokeOpacity) > 0.02 && num(c.strokeDashoffset) < 0.999;
    };
    const filled = (e) => Number(getComputedStyle(e).fillOpacity);
    const unit = svg.getScreenCTM()?.a ?? 0;
    seek(300);
    const early = { parts: shapes.filter((v) => v.lines.some((e) => shown(e) && num(getComputedStyle(e).strokeDashoffset) > 0)).length, fills: shapes.map((v) => filled(v.fill)), dash: lines.map((e) => num(getComputedStyle(e).strokeDashoffset)) };
    seek(end / 2);
    const ink = getComputedStyle(document.body).color;
    const drawn = shapes.map((v) => ({
      d: v.fill.getAttribute('d'),
      part: v.fill.getAttribute('data-part'),
      lines: v.lines.map((e) => e.getAttribute('d')),
      unit: v.lines.every((e) => e.getAttribute('pathLength') === '1'),
      wide: v.lines.map((e) => Math.round(num(getComputedStyle(e).strokeWidth) * unit * 1000) / 1000),
      sharp: v.lines.every((e) => getComputedStyle(e).strokeLinejoin === 'miter'),
      inked: v.lines.every((e) => getComputedStyle(e).stroke === ink),
      starts: [...new Set([v.fill, ...v.lines].flatMap((e) => e.getAnimations().map((a) => timing(a).delay)))],
    }));
    const holes = [];
    for (let k = 1; k <= 20; k++) {
      const t = (end * k) / 20;
      seek(t);
      shapes.forEach((v, i) => {
        if (t > v.start + 30 && !v.lines.some(shown) && filled(v.fill) <= 0.02) holes.push(`shape ${i + 1} at ${Math.round(t)} ms`);
      });
    }
    let step = 0;
    let last = shapes.map(() => 0);
    for (let t = 0; t <= end + 16; t += 16) {
      seek(t);
      const now = shapes.map((v) => filled(v.fill));
      step = Math.max(step, ...now.map((v, i) => Math.abs(v - last[i])));
      last = now;
    }
    const from = Math.min(...traces.map((a) => timing(a).delay), end);
    const stop = (a) => a.effect.getKeyframes().find((k) => 'strokeDashoffset' in k && num(k.strokeDashoffset) === 0)?.computedOffset ?? 1;
    const to = Math.max(0, ...traces.map((a) => timing(a).delay + Number(timing(a).duration) * stop(a)));
    const speeds = [];
    for (let k = 0; k < 10; k++) speeds.push((traced(from + (to - from) * (0.64 + 0.04 * k)) - traced(from + (to - from) * (0.6 + 0.04 * k))) / (0.04 * (to - from)));
    let low = from;
    let high = to;
    for (let k = 0; k < 30; k++) {
      const mid = (low + high) / 2;
      if (traced(mid) < 0.9) low = mid;
      else high = mid;
    }
    logo.got = { end, runs: runs.length, early, drawn, holes, step, from, to, speeds, tail: to > from ? (to - high) / (to - from) : 0, lines: lines.length };
    seek(0);
    logo.at = performance.now();
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-draw'] });
}

async function drawing(b, site, w, h) {
  const { ctx, page } = await context(b, { w, h, scheme: 'dark' });
  await ctx.addInitScript(sampled);
  await page.goto(site.url, { waitUntil: 'commit' });
  await waitFor(() => page.evaluate(() => !!window.__logo?.got).catch(() => false), 8000);
  return { ctx, page, got: await page.evaluate(() => window.__logo?.got ?? null).catch(() => null) };
}

async function logo(b, site) {
  const small = await drawing(b, site, 390, 664);
  await small.ctx.close();
  const { ctx, page, got } = await drawing(b, site, 1440, 900);
  try {
    const read = () =>
      page.evaluate(() => {
        const svg = document.querySelector('[data-site=logo]');
        const runs = [...(svg?.querySelectorAll('path') ?? [])].flatMap((e) => e.getAnimations());
        return {
          mode: svg?.getAttribute('data-draw') ?? '',
          took: window.__logo?.done ? window.__logo.done - window.__logo.at : 0,
          end: Math.max(0, ...runs.map((a) => Number(a.effect.getComputedTiming().endTime) || 0)),
          going: runs.filter((a) => a.playState === 'running').length,
          left: runs.length,
          tops: [...(window.__logo?.tops ?? [])],
          frames: window.__logo?.frames ?? 0,
          fills: [...(svg?.querySelectorAll('[data-part]') ?? [])].map((e) => Number(getComputedStyle(e).fillOpacity)),
          lines: [...(svg?.querySelectorAll('[data-line]') ?? [])].map((e) => getComputedStyle(e).stroke),
        };
      });
    const calm = (v) => v.fills.length === 12 && v.fills.every((x) => x === 1) && v.lines.length === 15 && v.lines.every((x) => x === 'none') && !v.left;
    const held = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return { text: h1?.textContent.trim() ?? '', drawings: h1?.querySelectorAll('svg').length ?? 0, hidden: h1?.querySelector('svg')?.getAttribute('aria-hidden') ?? '' };
    });
    const shapes = got?.drawn ?? [];
    const of = (name) => shapes.filter((v) => v.part === name);
    const sum = (list) => crypto.createHash('sha256').update(`${of('mark').map(list).join('')}|${of('word').map(list).join('')}`).digest('hex').slice(0, 16);
    const sums = [sum((v) => v.d), sum((v) => v.lines.join(''))];
    const single = shapes.every((v) => v.unit && v.lines.length > 0 && v.lines.every((d) => /^M[^M]+$/.test(d)));
    check('the h1 holds one SVG with the three mark shapes and the nine wordmark shapes of the lockup and still reads agent-ctx', held.text === 'agent-ctx' && held.drawings === 1 && held.hidden === 'true' && of('mark').length === 3 && of('word').length === 9 && single && sums.every((v) => v === LOCKUP), `${held.drawings} drawings, ${of('mark').length} and ${of('word').length} shapes, ${got?.lines ?? 0} contours, sums ${sums.join(' and ')}, text ${held.text}`);
    const early = got?.early ?? { parts: 0, fills: [], dash: [] };
    check('a sample at 0.3 s of the drawing shows a shape with a part of the outline and no shape with a fill', early.parts > 0 && early.dash.some((v) => v > 0 && v < 1) && early.fills.length === 12 && early.fills.every((v) => v === 0), `${early.parts} shapes with a part of the outline, fills ${[...new Set(early.fills)].join(' ') || 'missing'}`);
    const wide = [small.got, got].map((v) => (v?.drawn ?? []).flatMap((x) => x.wide));
    const starts = shapes.map((v) => (v.starts.length === 1 ? v.starts[0] : NaN));
    const steps = starts.slice(1).map((v, i) => v - starts[i]);
    check(
      'every contour of the twelve shapes has a sharp line of 0.75 px in the colour of the text at 1440 and at 390 px wide, all contours of one shape start together and the steps between the shapes grow from left to right',
      wide.every((v) => v.length === 15 && v.every((x) => Math.abs(x - 0.75) < 0.005)) && shapes.length === 12 && shapes.every((v) => v.sharp && v.inked) && steps.length === 11 && steps.every((v, i) => v > 0 && (!i || v > steps[i - 1])),
      `${wide.map((v) => `${v.length} lines of ${[...new Set(v)].join(' or ') || 'no'} px`).join(' and ')}, steps ${steps.map((v) => Math.round(v)).join(' ')} ms`,
    );
    check('at twenty moments of the drawing every shape that the wave has reached shows a line or a fill', !!got && got.lines === 15 && !got.holes.length, got ? got.holes.slice(0, 4).join(', ') || `${got.lines} contours` : 'no drawing');
    check('no fill opacity steps by more than 0.08 between two samples of the drawing that are 16 ms apart', !!got && got.lines === 15 && got.step > 0 && got.step <= 0.08, got ? `largest step ${got.step.toFixed(3)}` : 'no drawing');
    const speeds = got?.speeds ?? [];
    check(
      'the traced length of all contours slows steadily over the last 40 percent of the tracing time and the last 10 percent of the length takes between 20 and 35 percent of that time',
      speeds.length === 10 && speeds[0] > 0 && speeds.every((v, i) => !i || v < speeds[i - 1] * 0.999) && got.tail >= 0.2 && got.tail <= 0.35,
      got ? `the last tenth takes ${(got.tail * 100).toFixed(1)} percent of ${Math.round(got.to - got.from)} ms, speeds ${speeds.map((v) => (v * 1000).toFixed(2)).join(' ')}` : 'no drawing',
    );
    await waitFor(() => page.evaluate(() => document.querySelector('[data-site=logo]')?.getAttribute('data-draw') === 'done'), 5000);
    await page.waitForTimeout(400);
    const rest = await read();
    check('after the drawing every shape is filled, no stroke and no animation is left and the drawing ended within 2.2 s', calm(rest) && rest.mode === 'done' && got?.runs === 27 && got.end > 1000 && got.end <= 2200, `the drawing ends at ${Math.round(got?.end ?? 0)} ms and took ${Math.round(rest.took)} ms on this run, ${rest.fills.filter((v) => v === 1).length} of ${rest.fills.length} shapes filled, ${rest.left} animations left`);
    check('the top of the typed sentence never moves from the first sight of the logo until 2 s after the drawing', rest.frames > 60 && rest.tops.length === 1, `${rest.tops.join(' and ')} px in ${rest.frames} frames`);
    const at = await box(page, '[data-site=logo]');
    await page.mouse.move((at?.x ?? 0) + (at?.width ?? 0) / 2, (at?.y ?? 0) + (at?.height ?? 0) / 2);
    await page.waitForTimeout(150);
    const over = await read();
    await page.waitForTimeout(1100);
    const done = await read();
    await page.mouse.move(1400, 500);
    await page.waitForTimeout(300);
    const left = await read();
    check('a pointer over the logo draws the logo again within about 1 s and the drawing on load is not played again', over.going === 27 && over.end > 500 && over.end <= 1000 && !done.going && !left.going && calm(left), `${over.going} animations draw until ${Math.round(over.end)} ms, ${left.left} animations after the pointer left`);
  } finally {
    await ctx.close();
  }
}

function paced() {
  const pace = (window.__pace = { frames: [], seen: 0, run: 0, done: 0, scene: 0, held: null, there: null, boxes: [] });
  const place = () => {
    const r = document.querySelector('[data-site=demo]').getBoundingClientRect();
    const next = document.querySelector('[data-site=faq]')?.getBoundingClientRect().top ?? 0;
    return [r.left, r.top + scrollY, r.width, r.height, next + scrollY].map((v) => Math.round(v * 100) / 100).join(' ');
  };
  new MutationObserver(() => {
    const now = performance.now();
    const svg = document.querySelector('[data-site=logo]');
    const demo = document.querySelector('[data-site=demo]');
    if (!svg || !demo) return;
    const mode = svg.getAttribute('data-draw');
    if (!pace.seen) {
      pace.seen = now;
      pace.held = demo.hasAttribute('data-wait');
      pace.boxes.push(place());
    }
    if (!pace.run && mode === 'run') pace.run = now;
    if (!pace.done && mode === 'done') {
      pace.done = now;
      pace.there = !!document.querySelector('[aria-roledescription=space]');
    }
    if (!pace.scene && document.querySelector('[aria-roledescription=space]')) {
      pace.scene = now;
      pace.boxes.push(place());
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-draw'] });
  const tick = () => {
    pace.frames.push(performance.now());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__place = place;
}

async function slowed(b, site) {
  const loads = [];
  const smooth = (v) => v.ok && v.frames > 40 && v.worst <= 50 && v.whole <= 100;
  for (let i = 0; i < 5 && !loads.some(smooth); i++) {
    const { ctx, page } = await context(b, { w: 390, h: 664, scheme: 'dark' });
    try {
      await ctx.addInitScript(paced);
      await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.goto(site.url, { waitUntil: 'commit' });
      await ready(page).catch(() => {});
      loads.push(
        await page.evaluate(() => {
          const p = window.__pace;
          const gaps = (from) => {
            const inside = p.frames.filter((t) => t >= from && t <= p.done);
            return inside.length > 1 ? Math.max(...inside.slice(1).map((t, k) => t - inside[k])) : Infinity;
          };
          const seen = p.frames.find((t) => t >= p.seen) ?? 0;
          return { ok: p.run > 0 && p.done > p.run, worst: p.run && p.done ? gaps(p.run) : Infinity, whole: p.run && p.done ? gaps(seen) : Infinity, frames: p.frames.filter((t) => t >= p.run && t <= p.done).length, took: p.done - p.run, held: p.held, there: p.there, scene: p.scene - p.done, ready: performance.now() - p.done, boxes: [...p.boxes, document.querySelector('[data-site=demo]') ? window.__place() : ''] };
        }),
      );
    } finally {
      await ctx.close();
    }
  }
  const best = loads.find(smooth) ?? loads.reduce((a, v) => (v.worst < a.worst ? v : a), loads[0]);
  const ms = (v) => (Number.isFinite(v) ? `${Math.round(v)}` : 'no');
  check('with the processor slowed four times at 390x664 no gap between two frames is longer than 50 ms while the logo draws and none is longer than 100 ms from the first sight of the logo', smooth(best), `${loads.length === 1 ? 'one load' : `${loads.length} loads`} with a worst gap of ${loads.map((v) => `${ms(v.worst)} ms in the drawing and ${ms(v.whole)} ms from the first sight`).join(', ')}, ${best.frames} frames in the ${ms(best.took)} ms of the drawing`);
  check(
    'the scene is held back while the logo draws and arrives after the end of the drawing in a frame of one size and one place',
    loads.every((v) => v.ok && v.held === true && v.there === false && v.scene >= 0 && v.boxes.length === 3 && new Set(v.boxes).size === 1),
    `${loads.map((v) => (v.ok ? `scene ${v.there ? 'present at' : `${ms(v.scene)} ms after`} the end of the drawing` : 'no drawing')).join(', ')}, frame at ${[...new Set(loads.flatMap((v) => v.boxes))].join(' | ')}`,
  );
}

async function lost(b, site) {
  const { ctx, page } = await context(b, { w: 1440, h: 900, scheme: 'dark' });
  try {
    await ctx.addInitScript(() => {
      const frame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (f) => frame((t) => f(t - 500));
      for (const name of ['animationend', 'animationcancel']) window.addEventListener(name, (e) => e.stopImmediatePropagation(), true);
      const modes = (window.__modes = []);
      new MutationObserver(() => {
        const mode = document.querySelector('[data-site=logo]')?.getAttribute('data-draw');
        if (mode && modes[modes.length - 1] !== mode) modes.push(mode);
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-draw'] });
    });
    await page.goto(site.url, { waitUntil: 'commit' });
    const there = await page.waitForSelector('[aria-roledescription=space][data-ready="1"]', { timeout: 12000 }).then(() => true, () => false);
    const got = await page.evaluate(() => ({ modes: window.__modes ?? [], held: document.querySelector('[data-site=demo]')?.hasAttribute('data-wait') ?? true, left: [...document.querySelectorAll('[data-site=logo] path')].flatMap((e) => e.getAnimations()).length }));
    check('the logo still draws and the scene still arrives when every frame stamp is old and the end event of the drawing is lost', there && got.modes.join(' ') === 'wait run done' && !got.held && !got.left, `drawing states ${got.modes.join(' then ') || 'missing'}, scene ${there ? 'ready' : 'absent'}`);
  } finally {
    await ctx.close();
  }
}

async function shoot(b, site, w, h, scheme, name = '') {
  const { ctx, page, touch } = await context(b, { w, h, scheme, dpr: 2, reduced: true });
  try {
    await page.goto(site.url);
    await ready(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, `${name}first-${w}x${h}-${scheme}.png`) });
    if (name) return;
    await whole(page, path.join(shots, `page-${w}x${h}-${scheme}.png`), h);
    await centre(page);
    await page.waitForTimeout(400);
    if (!(await open(page, touch, (await paint(page, 2)).spots))) return;
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(shots, `card-${w}x${h}-${scheme}.png`) });
  } finally {
    await ctx.close();
  }
}

function built(dir) {
  const all = files(dir);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const css = all.filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(f, 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const refs = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]).concat([...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]));
  const off = refs.filter((r) => !r.startsWith(BASE));
  const far = [...`${html}\n${css}`.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"')]*/gi)].map((m) => m[0]);
  check(`every asset address in the built page starts with ${BASE}`, refs.length >= 4 && !off.length && !far.length, `${refs.length} addresses${off.length || far.length ? `, off ${[...off, ...far].slice(0, 3).join(' ')}` : ''}`);
  const holds = all.filter((f) => /\.(?:html|js|css)$/.test(f) && /install\.sh|setup\.md|Set up agent-ctx/.test(fs.readFileSync(f, 'utf8')));
  const icon = /<link rel="icon"[^>]*href="([^"]+)"/.exec(html)?.[1] ?? '';
  const file = path.join(dir, decodeURIComponent(icon.slice(BASE.length).split('?')[0]));
  const tile = icon.startsWith(BASE) && fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : '';
  const asks = (rel) => [...html.matchAll(/<link ([^>]+)>/g)].map((m) => m[1]).filter((v) => v.includes(`rel="${rel}"`) && /\scrossorigin[\s=>]|\scrossorigin$/.test(v)).map((v) => /href="([^"]+)"/.exec(v)?.[1] ?? '');
  const head = [...asks('preload').filter((v) => /-latin-wght-normal-[\w-]+\.woff2$/.test(v)), ...asks('modulepreload').filter((v) => /\/Scene-[\w-]+\.js$/.test(v))];
  check('the head of the built page asks early for the two fonts of the first screen and for the scene chunk', head.length === 3 && head.every((v) => v.startsWith(BASE) && fs.existsSync(path.join(dir, v.slice(BASE.length)))), head.map((v) => path.basename(v)).join(' ') || 'no early request');
  check('the favicon link ends in a versioned SVG that holds the mark for a light and a dark tab', /favicon-[\w-]{6,}\.svg$|\.svg\?v=\w+$/.test(icon) && tile.includes(`d="${MARK}"`) && /prefers-color-scheme:\s*dark/.test(tile), icon);
  check('the built page holds no setup prompt without VITE_RELEASED', !holds.length, holds.map((f) => path.basename(f)).join(' '));
  const bytes = all.reduce((a, f) => a + fs.statSync(f).size, 0);
  console.log(`NOTE the built page is ${(bytes / 1024).toFixed(0)} kB in ${all.length} files`);
}

async function run(name, f) {
  if (walks && !walks.some((v) => name.includes(v))) return;
  try {
    await f();
    check(`${name} ran to the end`, true);
  } catch (e) {
    check(`${name} ran to the end`, false, String(e).split('\n')[0].slice(0, 200));
  }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ctx-site-'));
let plain = null;
let later = null;
let b = null;
try {
  await build(null, false);
  await build(path.join(temp, 'released'), true);
  built(DIST);
  plain = { ...(await serve(DIST)), tones: {}, light: {} };
  later = await serve(path.join(temp, 'released'));
  b = await browser();
  for (const scheme of schemes) for (const [w, h] of sizes) await run(`${scheme} ${w}x${h} walk`, () => walk(b, plain, w, h, scheme));
  for (const [w, h] of sizes) await run(`released ${w}x${h} walk`, () => released(b, later, w, h));
  await run('reduced motion walk', () => still(b, plain));
  await run('random typing walk', () => random(b, plain));
  await run('switch point walk', () => fit(b, plain));
  await run('logo walk', () => logo(b, plain));
  await run('lost event walk', () => lost(b, plain));
  if (engine === 'chromium') await run('slowed walk', () => slowed(b, plain));
  else console.log('NOTE the slowed walk needs the processor switch of Chrome and was left out');
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    for (const scheme of schemes) for (const [w, h] of sizes) await shoot(b, plain, w, h, scheme);
    for (const scheme of schemes) for (const [w, h] of sizes) await shoot(b, later, w, h, scheme, 'released-');
  }
} finally {
  await b?.close();
  await plain?.stop();
  await later?.stop();
  fs.rmSync(temp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
if (failed.length) {
  for (const f of failed) console.log(`  failed  ${f.name}`);
  process.exit(1);
}
