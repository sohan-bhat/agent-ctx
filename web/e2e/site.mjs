import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { AxeBuilder } from '@axe-core/playwright';
import { browser, context, drag, engine, labels, overflow, press, ready, touchDrag, waitFor, web } from './lib.mjs';

const BASE = '/agent-ctx/';
const REPO = /REPO = '([^']+)'/.exec(fs.readFileSync(path.join(web, 'src', 'agents.ts'), 'utf8'))[1];
const LINE = 'curl -fsSL https://sohanbhat.me/agent-ctx/install.sh | sh';
const HOME = `https://github.com/${REPO}`;
const DIST = path.join(web, 'dist-site');
const START = 8 * 60;
const END = 18 * 60;
const NAMES = ['Claude Code', 'Cursor', 'Codex', 'Gemini CLI', 'Claude desktop'];
const SPOKEN = 'Work started in Claude Code is continued in Cursor.';
const sizes = (process.env.SIZES ?? '1440x900,390x664').split(',').map((s) => s.split('x').map(Number));
const schemes = (process.env.SCHEMES ?? 'dark,light').split(',');
const shots = process.env.SHOTS;
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
    const day = document.querySelector('[data-site=day]');
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
      day: day ? { text: day.innerText.trim().split(/\s*\n\s*/), under: day.previousElementSibling?.previousElementSibling?.textContent ?? '' } : null,
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
    await page.goto(site.url);
    await ready(page);
    await page.evaluate((names) => {
      const t = (window.__typed = { seen: [new Set(), new Set()], place: [new Set(), new Set()], tall: new Set(), under: new Set(), said: new Set(), apart: new Set(), pairs: 0, same: 0, typing: 0, both: 0, unlit: 0 });
      const p = document.querySelector('[data-site=typed]');
      const look = () => {
        const at = p.getBoundingClientRect();
        const spots = [...p.querySelectorAll('[data-site=agent]')];
        const carets = [...p.querySelectorAll('.site-caret')];
        const said = p.cloneNode(true);
        for (const e of said.querySelectorAll('[aria-hidden]')) e.remove();
        t.said.add(said.textContent.trim());
        t.tall.add(Math.round(at.height));
        t.under.add(document.querySelector('[data-site=line]')?.offsetTop);
        if (spots.length !== 2 || carets.length !== 2) return;
        const whole = spots.map((e) => names.includes(e.textContent));
        spots.forEach((e, i) => {
          const r = e.getBoundingClientRect();
          t.place[i].add(`${Math.round(r.left - at.left)} ${Math.round(r.top - at.top)}`);
          if (whole[i]) t.seen[i].add(e.textContent);
          else if (getComputedStyle(carets[i]).animationName !== 'none') t.unlit++;
        });
        const mid = whole.filter((v) => !v).length;
        if (!mid) t.pairs++;
        if (!mid && spots[0].textContent === spots[1].textContent) t.same++;
        if (mid) t.typing++;
        if (mid === 2) t.both++;
        const turn = carets.map((c) => c.getAnimations()[0]?.effect?.getComputedTiming().progress);
        if (turn.every((v) => typeof v === 'number')) t.apart.add(Math.round(Math.abs(turn[0] - turn[1]) * 100));
      };
      new MutationObserver(look).observe(p, { subtree: true, childList: true, characterData: true, attributes: true });
      setInterval(look, 50);
      look();
    }, NAMES);

    const first = [await box(page, 'h1'), await box(page, '[data-site=typed]'), await box(page, '[data-site=line]'), await box(page, '[data-site=action] a >> nth=0'), await box(page, '[data-site=action] a >> nth=1')];
    check(`${tag} the name, the typed line, the sentence and both pills are inside the first screen`, first.every((r) => inside(r, w, h)), first.map(span).join(', '));
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

    const look = await page.evaluate(() => {
      const bars = [...document.querySelectorAll('[data-site=day] [data-site=bar]')];
      const on = (svg) => [...svg.querySelectorAll('rect')].reduce((a, r) => a + r.getBoundingClientRect().width, 0);
      return { ground: getComputedStyle(document.body).backgroundColor, fills: bars.map((s) => getComputedStyle(s.querySelector('rect')).fill), share: bars.map((s) => on(s) / s.getBoundingClientRect().width) };
    });
    const seen = (site.fills[scheme] ??= look.fills);
    check(`${tag} the page follows the system theme`, look.ground === GROUND[scheme] && look.fills.length === 2 && seen.join() === look.fills.join() && (!site.fills[other] || look.fills.every((v, i) => v !== site.fills[other][i])), `ground ${look.ground}, bars ${look.fills.join(' and ')}`);

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
    check(`${tag} no small label sits above a heading or beside the demo`, !s.marks.length, s.marks.join(' | '));
    check(`${tag} fewer than 60 words stand outside the FAQ and the demo frame`, s.words > 20 && s.words < 60, `${s.words} words`);
    check(`${tag} the top bar holds the GitHub link and the theme switch and nothing else`, !!s.nav && s.nav.parts === 3 && s.nav.toggles === 1 && s.nav.links.length === 1 && s.nav.links[0] === HOME && s.nav.text.join(' ') === 'GitHub Dark', s.nav ? s.nav.text.join(' ') : 'missing');
    check(
      `${tag} the main pill goes to GitHub, the plain pill to the FAQ, and the testing line shows`,
      s.pills.length === 2 && s.pills[0].join() === ['View on GitHub', HOME, 'default'].join() && s.pills[1].join() === ['Read the FAQ', '#faq', 'outline'].join() && /first release is being tested/.test(s.status),
      s.pills.map((p) => p[0]).join(' and '),
    );
    check(`${tag} the day bars sit under the answer about the background with the two labels only`, !!s.day && s.day.text.join('|') === 'A background server|agent-ctx' && /background/.test(s.day.under) && look.share.length === 2 && look.share[0] > 0.99 && look.share[1] > 0.1 && look.share[1] < 0.6, s.day ? `${s.day.text.join(' and ')}, ${look.share.map((v) => `${(v * 24).toFixed(1)} hours`).join(' and ')}` : 'missing');
    check(`${tag} the footer holds the licence, the repository link and the cookie sentence${wide ? ' in one line' : ''}`, !!s.foot && /\bMIT\b/.test(s.foot.text) && s.foot.links.includes(HOME) && /No cookie is set/.test(s.foot.text) && /another host/.test(s.foot.text) && (!wide || new Set(s.foot.tops).size === 1), s.foot ? `${new Set(s.foot.tops).size} lines` : 'missing');

    const t = await texts(page);
    const bad = faults(t.out);
    check(`${tag} the wording rules hold in every text node`, t.out.length > 40 && !bad.length, bad.slice(0, 4).join(' | '));
    check(`${tag} a question mark stands only on the eight questions`, !t.asked.length, t.asked.slice(0, 3).join(' | '));
    check(`${tag} no install line is shown`, !t.out.join('\n').includes('install.sh') && !(await page.locator('[data-site=install]').count()));

    await waitFor(() => page.evaluate(() => window.__typed.seen.every((v) => v.size >= 2)), 12000);
    const typed = await page.evaluate(() => {
      const t = window.__typed;
      const list = (v) => [...v];
      const p = document.querySelector('[data-site=typed]');
      const spots = [...p.querySelectorAll('[data-site=agent]')];
      const carets = [...p.querySelectorAll('.site-caret')].map((e) => e.getBoundingClientRect());
      const rows = spots.map((e, i) => {
        const r = e.getBoundingClientRect();
        const c = carets[i];
        const word = [...e.childNodes].find((n) => n.nodeType === 3);
        const range = document.createRange();
        if (word) range.selectNode(word);
        return { top: r.top, bottom: r.bottom, on: !!c && c.top + c.height / 2 > r.top && c.top + c.height / 2 < r.bottom, after: !!c && c.left >= (word ? range.getBoundingClientRect().right : r.left) - 0.5 };
      });
      return { ...t, seen: t.seen.map(list), place: t.place.map(list), tall: list(t.tall), under: list(t.under), said: list(t.said), apart: list(t.apart), carets: carets.length, rows, line: parseFloat(getComputedStyle(p).lineHeight) };
    });
    check(`${tag} the typed block has two lines and each line ends in a cursor of its own`, typed.carets === 2 && typed.rows.length === 2 && typed.rows.every((r) => r.on && r.after) && typed.rows[0].bottom <= typed.rows[1].top + 1, `${typed.carets} cursors, ${typed.rows.length} names`);
    check(`${tag} each spot of the typed block shows at least two agent names over time`, typed.seen.every((v) => v.length >= 2), typed.seen.map((v) => v.join(', ')).join(' and '));
    check(`${tag} the two spots never show the same complete name at one moment`, typed.pairs > 0 && typed.same === 0, `${typed.same} of ${typed.pairs} moments with two complete names`);
    check(`${tag} at most one spot is in the middle of a word at any moment`, typed.typing > 0 && typed.both === 0, `${typed.both} of ${typed.typing} moments in the middle of a word`);
    check(`${tag} the typed block stays two lines tall and no name and nothing under the block moves`, typed.tall.length === 1 && Math.abs(typed.tall[0] - 2 * typed.line) < 1 && typed.under.length === 1 && typed.place.every((v) => v.length === 1), `heights ${typed.tall.join(' ')}, line ${typed.line}, names at ${typed.place.map((v) => v.join(' or ')).join(' and ')}, sentence at ${typed.under.join(' ')}`);
    check(`${tag} the cursor that types stays lit and the idle cursors blink half a period apart`, typed.typing > 0 && typed.unlit === 0 && typed.apart.join() === '50', `${typed.unlit} of ${typed.typing} moments with a blinking cursor in a word, idle cursors ${typed.apart.join(' ')} percent of a period apart`);
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
    const code = page.locator('[data-site=install]');
    const copy = page.locator('[data-site=action]').getByRole('button', { name: 'Copy' });
    const shown = ((await code.textContent().catch(() => '')) ?? '').trim();
    const s = await shape(page);
    check(
      `${tag} the install line with Copy and the plain pill to GitHub are inside the first screen`,
      shown === LINE && inside(await box(page, '[data-site=install]'), w, h) && inside(await copy.boundingBox().catch(() => null), w, h) && s.pills.length === 1 && s.pills[0].join() === ['View on GitHub', HOME, 'outline'].join() && inside(await box(page, '[data-site=action] a'), w, h),
      shown,
    );
    if (touch) await copy.tap().catch(() => {});
    else await copy.click().catch(() => {});
    const done = await waitFor(() => page.locator('[data-site=action]').getByRole('button', { name: 'Copied' }).count(), 2000);
    const held = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check(`${tag} Copy puts the install line on the clipboard`, !!done && held === LINE, held);
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
    await page.goto(site.url);
    await ready(page);
    const names = async () => (await page.locator('[data-site=agent]').allTextContents()).join(' and ');
    const t0 = await readout(page);
    const n0 = await names();
    await page.waitForTimeout(4200);
    const t1 = await readout(page);
    const n1 = await names();
    const carets = await page.evaluate(() => [...document.querySelectorAll('.site-caret')].map((e) => getComputedStyle(e).animationName));
    const blocks = Number(await page.locator('[aria-roledescription=space]').getAttribute('data-blocks'));
    check('reduced motion leaves the demo still at the end of the day', t0 === END && t1 === END && blocks > 20 && !errors.length, `${clock(t0)} then ${clock(t1)}, ${blocks} blocks`);
    check('reduced motion leaves the typed lines still with Claude Code and Cursor', n0 === NAMES.slice(0, 2).join(' and ') && n1 === n0 && carets.length === 2 && carets.every((v) => v === 'none'), `${n0} then ${n1}, cursor animations ${carets.join(' ')}`);
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
  const holds = all.filter((f) => /\.(?:html|js|css)$/.test(f) && fs.readFileSync(f, 'utf8').includes('install.sh | sh'));
  check('the built page holds no install line without VITE_RELEASED', !holds.length, holds.map((f) => path.basename(f)).join(' '));
  const bytes = all.reduce((a, f) => a + fs.statSync(f).size, 0);
  console.log(`NOTE the built page is ${(bytes / 1024).toFixed(0)} kB in ${all.length} files`);
}

async function run(name, f) {
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
  plain = { ...(await serve(DIST)), fills: {}, light: {} };
  later = await serve(path.join(temp, 'released'));
  b = await browser();
  for (const scheme of schemes) for (const [w, h] of sizes) await run(`${scheme} ${w}x${h} walk`, () => walk(b, plain, w, h, scheme));
  for (const [w, h] of sizes) await run(`released ${w}x${h} walk`, () => released(b, later, w, h));
  await run('reduced motion walk', () => still(b, plain));
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
