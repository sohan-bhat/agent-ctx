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
const LINE = `npx -y github:${REPO}`;
const HOME = `https://github.com/${REPO}`;
const DIST = path.join(web, 'dist-site');
const START = 8 * 60;
const END = 18 * 60;
const sizes = (process.env.SIZES ?? '1440x900,390x664').split(',').map((s) => s.split('x').map(Number));
const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');
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

async function paint(page, dpr = 1) {
  const box = await page.locator('[aria-roledescription=space]').boundingBox();
  const { w, h, n, px } = decode(await page.screenshot({ clip: box }));
  const cell = 12 * dpr;
  const cols = Math.floor(w / cell);
  const rows = Math.floor(h / cell);
  const grid = new Uint16Array(cols * rows);
  const hues = new Map();
  let coloured = 0;
  for (let y = 0; y < rows * cell; y++)
    for (let x = 0; x < cols * cell; x++) {
      const i = (y * w + x) * n;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
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
  return { box, coloured, share: coloured / (w * h), hues: [...hues.values()].filter((v) => v > 150 * dpr * dpr).length, spots };
}

const minutes = (text) => {
  const m = /(\d\d):(\d\d)/.exec(text ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const readout = async (page) => minutes(await page.locator('[data-readout]').textContent());
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const box = (page, sel) => page.locator(sel).first().boundingBox().catch(() => null);
const inside = (r, w, h) => !!r && r.width > 0 && r.height > 0 && r.x >= -0.5 && r.y >= -0.5 && r.x + r.width <= w + 0.5 && r.y + r.height <= h + 0.5;
const top = (page) => page.evaluate(() => Math.round(scrollY));
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
const panel = (page) => page.evaluate(() => document.querySelector('[data-panel]')?.getAttribute('data-panel') ?? null);

const words = (page) =>
  page.evaluate(() =>
    [document.title, document.querySelector('meta[name=description]')?.getAttribute('content') ?? '', document.body.innerText, ...[...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') ?? '')].join('\n'),
  );

function faults(text) {
  const found = [];
  const rules = [
    ['a banned word', /\b(?:itself|its|it)\b/gi],
    ['a dash as punctuation', /[‒-―−]|(?:^|\s)-+(?=\s|$)/gm],
    ['a semicolon', /;/g],
    ['a parenthesis', /[()]/g],
  ];
  for (const [what, re] of rules) for (const m of text.matchAll(re)) found.push(`${what} in "${text.slice(Math.max(0, m.index - 24), m.index + 24).replace(/\s+/g, ' ').trim()}"`);
  return found;
}

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
  const { ctx, page, errors, touch } = await context(b, { w, h, scheme });
  const cdp = touch && engine === 'chromium' ? await ctx.newCDPSession(page) : null;
  const asked = [];
  page.on('request', (r) => asked.push(r.url()));
  try {
    await page.goto(site.url);
    await ready(page);

    const h1 = await box(page, 'h1');
    const line = await box(page, '[data-site=line]');
    const action = await box(page, '[data-site=action] a');
    const mark = await box(page, '[data-site=wordmark]');
    check(`${tag} the wordmark, the h1, the line and the action pill are inside the first screen`, [mark, h1, line, action].every((r) => inside(r, w, h)), [mark, h1, line, action].map((r) => (r ? `${Math.round(r.y)} to ${Math.round(r.y + r.height)}` : 'missing')).join(', '));
    const scene = await box(page, '[aria-roledescription=space]');
    const slider = await box(page, '[data-slot=slider]');
    check(`${tag} the scene and the time slider are inside the first screen`, inside(scene, w, h) && inside(slider, w, h) && scene.height >= 200, scene && slider ? `scene ${Math.round(scene.width)} by ${Math.round(scene.height)}, slider ends at ${Math.round(slider.y + slider.height)}` : 'missing');

    await page.waitForTimeout(1600);
    const played = await readout(page);
    check(`${tag} the demo day plays from 08:00 and the page stays at the top`, played > START && played < END && (await top(page)) === 0, `${clock(played)} after 1.6 s, scroll ${await top(page)}`);

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
    await page.waitForTimeout(1500);

    const drawn = await paint(page);
    check(`${tag} the scene draws real pixels`, drawn.share > 0.02 && drawn.hues >= 2, `${drawn.coloured} coloured pixels in ${drawn.hues} hues, ${(drawn.share * 100).toFixed(1)} percent of the scene`);

    const id = await open(page, touch, drawn.spots);
    const title = id ? ((await page.locator('[data-panel] h2').textContent()) ?? '').trim() : '';
    check(`${tag} a press on a block opens a card`, !!id && title.length > 3, `item ${id}, ${title}`);
    if (touch) await page.locator('[data-slot=sheet-close]').tap().catch(() => {});
    else await page.mouse.click(h1 ? h1.x + 4 : 4, h1 ? h1.y + 4 : 4);
    const closed = await waitFor(async () => !(await panel(page)), 3000);
    check(`${tag} the card can be closed`, !!id && closed);
    await page.waitForTimeout(600);

    const cx = scene.x + scene.width / 2;
    const cy = scene.y + scene.height / 2;
    if (touch && cdp) await touchDrag(page, cdp, cx, cy + 70, cx, cy - 130);
    else {
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, 320);
    }
    const moved = await waitFor(async () => ((await top(page)) > 60 ? top(page) : 0), 2000);
    check(`${tag} the page scrolls from over the scene`, moved > 60, `scroll ${moved}`);
    await settle(page);
    await page.evaluate(() => scrollTo(0, 0));
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    await settle(page);

    const before = await labels(page);
    await drag(page, touch, cdp, scene.x + scene.width * 0.8, scene.y + scene.height * 0.9, scene.x + scene.width * 0.4, scene.y + scene.height * 0.9);
    await page.waitForTimeout(600);
    const after = await labels(page);
    const turned = before.length && after.length ? Math.max(...before.map((a, i) => Math.hypot(a.x - (after[i]?.x ?? a.x), a.y - (after[i]?.y ?? a.y)))) : 0;
    check(`${tag} a drag turns the scene`, turned > 8 && (await top(page)) === 0, `label moved ${turned.toFixed(1)} px`);

    const o = await overflow(page);
    check(`${tag} nothing is wider than the screen`, o.scroll <= 0 && !o.wide.length, JSON.stringify(o));

    const facts = await page.evaluate(() => ({
      h1: document.querySelectorAll('h1').length,
      parts: [...document.querySelectorAll('[data-site=part] h2')].map((e) => e.textContent.trim()),
      steps: document.querySelectorAll('[data-site=steps] li').length,
      rows: document.querySelectorAll('[data-site=rows] dt').length,
      links: [...document.querySelectorAll('footer a')].map((a) => a.href),
      foot: document.querySelector('footer')?.innerText ?? '',
      pill: document.querySelector('[data-site=action] a')?.href ?? '',
      status: document.querySelector('[data-site=status]')?.textContent ?? '',
    }));
    check(
      `${tag} the page has one h1, three parts, the action pill and the footer facts`,
      facts.h1 === 1 && facts.parts.length === 3 && facts.steps > 0 && facts.steps <= 3 && facts.rows === 4 && facts.links.includes(HOME) && /\bMIT\b/.test(facts.foot) && /cookie/.test(facts.foot) && facts.pill === HOME && /tested/.test(facts.status),
      `${facts.h1} h1, ${facts.parts.length} parts, ${facts.steps} steps, ${facts.rows} rows`,
    );

    const text = await words(page);
    const bad = faults(text);
    check(`${tag} the wording rules hold`, text.length > 400 && !bad.length, bad.slice(0, 4).join(' | '));
    check(`${tag} no install line is shown`, !text.includes('npx') && !(await page.locator('[data-site=install]').count()));

    const look = await page.evaluate(() => {
      const bars = [...document.querySelectorAll('[data-site=day] [data-site=bar]')];
      const wide = (svg) => [...svg.querySelectorAll('rect')].reduce((a, r) => a + r.getBoundingClientRect().width, 0);
      return { ground: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color, fills: bars.map((s) => getComputedStyle(s.querySelector('rect')).fill), full: bars.map((s) => s.getBoundingClientRect().width), on: bars.map(wide), cookie: document.cookie };
    });
    const seen = (site.fills[scheme] ??= look.fills.join());
    const other = site.fills[scheme === 'light' ? 'dark' : 'light'];
    check(`${tag} the page follows the system theme`, look.ground === GROUND[scheme] && look.fills.length === 2 && seen === look.fills.join() && other !== seen, `ground ${look.ground}, bars ${look.fills.join(' and ')}`);
    const share = look.on.map((v, i) => v / look.full[i]);
    check(`${tag} the day bars show 24 hours beside the hours with an agent open`, share.length === 2 && share[0] > 0.99 && share[1] > 0.1 && share[1] < 0.6, share.map((v) => `${(v * 24).toFixed(1)} hours`).join(' and '));

    const axe = await new AxeBuilder({ page }).analyze();
    const hits = axe.violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
    check(`${tag} the page has no accessibility violation`, !hits.length, hits.slice(0, 4).join(' | '));

    check(`${tag} no cookie is set`, look.cookie === '' && !(await ctx.cookies()).length);
    const away = asked.filter((u) => !u.startsWith(site.url));
    check(`${tag} every request stays under ${BASE} on the local server`, asked.length > 3 && !away.length, `${asked.length} requests${away.length ? `, away ${away.slice(0, 3).join(' ')}` : ''}`);
    check(`${tag} the page has no console error`, !errors.length, errors.join(' | '));
  } finally {
    await ctx.close();
  }
}

async function released(b, site, w, h) {
  const tag = `released ${w}x${h}`;
  const { ctx, page, errors, touch } = await context(b, { w, h });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: site.origin }).catch(() => {});
  try {
    await page.goto(site.url);
    await ready(page);
    const code = page.locator('[data-site=install]');
    const copy = page.locator('[data-site=action]').getByRole('button', { name: 'Copy' });
    const shown = ((await code.textContent().catch(() => '')) ?? '').trim();
    check(`${tag} the install line shows with a Copy button inside the first screen`, shown === LINE && inside(await box(page, '[data-site=install]'), w, h) && inside(await copy.boundingBox().catch(() => null), w, h), shown);
    if (touch) await copy.tap().catch(() => {});
    else await copy.click().catch(() => {});
    const done = await waitFor(() => page.locator('[data-site=action]').getByRole('button', { name: 'Copied' }).count(), 2000);
    const held = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check(`${tag} Copy puts the install line on the clipboard`, !!done && held === LINE, held);
    const o = await overflow(page);
    const bad = faults(await words(page));
    check(`${tag} the testing line and the pill are gone and the rules still hold`, !(await page.locator('[data-site=status]').count()) && !(await page.locator('[data-site=action] a').count()) && o.scroll <= 0 && !o.wide.length && !bad.length && !errors.length, [...bad, ...errors].slice(0, 3).join(' | '));
  } finally {
    await ctx.close();
  }
}

async function still(b, site) {
  const { ctx, page, errors } = await context(b, { w: 1440, h: 900, reduced: true });
  try {
    await page.goto(site.url);
    await ready(page);
    const t0 = await readout(page);
    await page.waitForTimeout(1500);
    const t1 = await readout(page);
    const blocks = Number(await page.locator('[aria-roledescription=space]').getAttribute('data-blocks'));
    check('reduced motion leaves the demo still at the end of the day', t0 === END && t1 === END && blocks > 20 && !errors.length, `${clock(t0)} then ${clock(t1)}, ${blocks} blocks`);
  } finally {
    await ctx.close();
  }
}

async function shoot(b, site, w, h, scheme, name = '') {
  const { ctx, page, touch } = await context(b, { w, h, scheme, dpr: 2 });
  try {
    await page.goto(site.url);
    await ready(page);
    await page.locator('[data-slot=slider-thumb]').focus();
    await page.keyboard.press('End');
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(shots, `${name}first-${w}x${h}-${scheme}.png`) });
    if (name) return;
    await page.screenshot({ path: path.join(shots, `page-${w}x${h}-${scheme}.png`), fullPage: true });
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
  const holds = all.filter((f) => /\.(?:html|js|css)$/.test(f) && fs.readFileSync(f, 'utf8').includes('npx -y'));
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
  plain = { ...(await serve(DIST)), fills: {} };
  later = await serve(path.join(temp, 'released'));
  b = await browser();
  for (const scheme of schemes) for (const [w, h] of sizes) await run(`${scheme} ${w}x${h} walk`, () => walk(b, plain, w, h, scheme));
  for (const [w, h] of sizes) await run(`released ${w}x${h} walk`, () => released(b, later, w, h));
  await run('reduced motion walk', () => still(b, plain));
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    for (const scheme of schemes) for (const [w, h] of sizes) await shoot(b, plain, w, h, scheme);
    for (const [w, h] of sizes) await shoot(b, later, w, h, 'light', 'released-');
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
