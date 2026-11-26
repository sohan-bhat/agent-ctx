import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = process.env.PW ?? '/usr/local/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';

export async function browser() {
  const { chromium } = await import(PW);
  return chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
}

export async function server(port = Number(process.env.PORT ?? 5199)) {
  if (process.env.URL) return { url: process.env.URL, stop: async () => {} };
  const child = spawn(process.execPath, [path.join(web, 'node_modules/vite/bin/vite.js'), '--mode', 'mock', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: web, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const t0 = Date.now();
  while (!/ready in/.test(log)) {
    if (Date.now() - t0 > 30000 || child.exitCode !== null) throw new Error(`dev server did not start\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  const url = `http://127.0.0.1:${port}/`;
  const stop = () =>
    new Promise((r) => {
      if (child.exitCode !== null) return r();
      child.once('exit', r);
      child.kill('SIGTERM');
    });
  return { url, stop };
}

export async function context(b, { w, h, scheme = 'light', signedIn = false, dpr = 1, flags = {}, reduced = false }) {
  const touch = w < 600;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: scheme, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(
    ([on, f]) => {
      try {
        localStorage.clear();
        if (on) localStorage.setItem('agent-ctx-mock', 'in');
        for (const [k, v] of Object.entries(f)) localStorage.setItem(`agent-ctx-mock-${k}`, v);
      } catch {}
    },
    [signedIn, flags],
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  return { ctx, page, errors, touch };
}

export async function ready(page) {
  await page.waitForSelector('[aria-roledescription=space][data-ready="1"]', { timeout: 30000 });
}

export const space = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[aria-roledescription=space]');
    return el ? { blocks: Number(el.dataset.blocks), flat: Number(el.dataset.flat), outlines: Number(el.dataset.outlines), pins: Number(el.dataset.pins) } : null;
  });

export async function touchDrag(page, cdp, x0, y0, x1, y1, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export async function pinch(page, cdp, cx, cy, from, to, steps = 12) {
  const pts = (d) => [
    { x: cx - d / 2, y: cy, id: 1 },
    { x: cx + d / 2, y: cy, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / steps) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export async function drag(page, touch, cdp, x0, y0, x1, y1) {
  if (touch) return touchDrag(page, cdp, x0, y0, x1, y1);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12);
  await page.mouse.up();
}

export async function press(page, touch, x, y) {
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

export const labels = (page) => page.evaluate(() => [...document.querySelectorAll('[data-label=plate]')].map((e) => ({ t: e.textContent, ...JSON.parse(JSON.stringify(e.getBoundingClientRect())) })).filter((r) => r.width > 0));

export const overflow = (page) =>
  page.evaluate(() => {
    const W = innerWidth;
    const wide = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().width > W + 0.5).map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? `.${e.className.split(' ')[0]}` : ''));
    return { scroll: document.documentElement.scrollWidth - W, wide: wide.slice(0, 5) };
  });

export async function waitFor(f, ms = 8000, step = 100) {
  const t0 = Date.now();
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}
