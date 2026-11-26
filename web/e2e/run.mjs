import { browser, context, drag, labels, overflow, pinch, press, ready, server, space, waitFor } from './lib.mjs';

const sizes = (process.env.SIZES ?? '1440x900,390x664,360x640').split(',').map((s) => s.split('x').map(Number));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

async function signedOut(b, url, w, h) {
  const tag = `${w}x${h}`;
  const { ctx, page, errors, touch } = await context(b, { w, h });
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  try {
    await page.goto(url);
    await ready(page);
    const s = await waitFor(async () => {
      const v = await space(page);
      return v && v.blocks > 0 ? v : null;
    }, 10000);
    check(`${tag} signed out scene shows blocks`, s && s.blocks > 0, `blocks ${s?.blocks}`);
    check(`${tag} signed out shows the word demo`, await page.getByText('demo', { exact: true }).isVisible());
    const box = await page.locator('[aria-roledescription=space]').boundingBox();
    const before = await labels(page);
    await drag(page, touch, cdp, box.x + box.width * 0.82, box.y + box.height * 0.9, box.x + box.width * 0.42, box.y + box.height * 0.9);
    await page.waitForTimeout(600);
    const after = await labels(page);
    const moved = before.length && after.length ? Math.max(...before.map((a, i) => Math.hypot(a.x - (after[i]?.x ?? a.x), a.y - (after[i]?.y ?? a.y)))) : 0;
    check(`${tag} a drag turns the demo scene`, moved > 8, `label moved ${moved.toFixed(1)} px`);
    const o = await overflow(page);
    check(`${tag} signed out has nothing wider than the screen`, o.scroll <= 0 && !o.wide.length, JSON.stringify(o));
    check(`${tag} signed out has no console error`, !errors.length, errors.join(' | '));
  } finally {
    await ctx.close();
  }
}

async function openPanel(page, touch) {
  const box = await page.locator('[aria-roledescription=space]').boundingBox();
  const spots = await page.evaluate(() => window.__space?.spots() ?? []);
  const order = spots.filter((s) => s.look === 'solid' && s.x > 30 && s.x < box.width - 30 && s.y > 30 && s.y < box.height - 30).sort((a, b) => b.area - a.area);
  for (const s of order.slice(0, 10)) {
    await press(page, touch, box.x + s.x, box.y + s.y + 4);
    const id = await waitFor(() => page.evaluate(() => document.querySelector('[data-panel]')?.getAttribute('data-panel') ?? null), 2000);
    if (id) return id;
  }
  return null;
}

async function signedIn(b, url, w, h) {
  const tag = `${w}x${h}`;
  const { ctx, page, errors, touch } = await context(b, { w, h, signedIn: true, flags: { every: '2500', connect: '900' } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  try {
    await page.goto(url);
    await ready(page);
    await page.waitForTimeout(800);
    const box = await page.locator('[aria-roledescription=space]').boundingBox();

    const id = await openPanel(page, touch);
    check(`${tag} a press on a block opens the panel`, !!id, `item ${id}`);
    if (id) {
      const pin = page.locator(`[data-panel="${id}"] [role=switch]`);
      const was = await pin.getAttribute('aria-checked');
      const pins0 = (await space(page)).pins;
      await press(page, touch, ...(await pin.boundingBox().then((r) => [r.x + r.width / 2, r.y + r.height / 2])));
      const now = await waitFor(async () => ((await pin.getAttribute('aria-checked')) !== was ? await pin.getAttribute('aria-checked') : null), 3000);
      const pins1 = (await space(page)).pins;
      check(`${tag} Pin changes state`, now && now !== was && pins1 === pins0 + (was === 'true' ? -1 : 1), `${was} to ${now}, pins ${pins0} to ${pins1}`);
      await page.keyboard.press('Escape');
      await waitFor(() => page.evaluate(() => !document.querySelector('[data-panel]')), 3000);
    }

    if (touch) {
      const before = await labels(page);
      await pinch(page, cdp, box.x + box.width / 2, box.y + box.height / 2, 60, 200);
      await page.waitForTimeout(600);
      const after = await labels(page);
      const moved = before.length && after.length ? Math.max(...before.map((a, i) => Math.hypot(a.x - (after[i]?.x ?? a.x), a.y - (after[i]?.y ?? a.y)))) : 0;
      check(`${tag} pinch zooms the scene`, moved > 8, `label moved ${moved.toFixed(1)} px`);
    }

    const b0 = (await space(page)).blocks;
    const grew = await waitFor(async () => {
      const v = (await space(page)).blocks;
      return v > b0 ? v : null;
    }, 9000);
    check(`${tag} a live item raises the block count`, !!grew, `${b0} to ${grew}`);

    const thumb = page.locator('[data-slot=slider-thumb]');
    const tb = await thumb.boundingBox();
    const track = await page.locator('[data-slot=slider]').boundingBox();
    const before = (await space(page)).blocks;
    await drag(page, touch, cdp, tb.x + tb.width / 2, tb.y + tb.height / 2, track.x + track.width * 0.35, tb.y + tb.height / 2);
    await page.waitForTimeout(900);
    const sunk = (await space(page)).blocks;
    check(`${tag} the scrubber sinks blocks`, sunk < before, `${before} to ${sunk}`);
    await thumb.focus();
    await page.keyboard.press('End');
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: 'Add agent' }).click();
    await page.waitForSelector('[data-product]');
    const products = await page.locator('[data-product]').count();
    check(`${tag} Add agent lists the products`, products === 9, `${products} products`);
    await page.locator('[data-product=cursor]').click();
    const href = await page.locator('[data-path=cursor] a').first().getAttribute('href');
    check(`${tag} the Cursor entry links to cursor://`, href?.startsWith('cursor://'), href?.slice(0, 48));
    await page.getByRole('button', { name: 'All agents' }).click();
    await page.locator('[data-product=gemini]').click();
    await page.locator('[data-path=gemini]').getByRole('button', { name: 'Copy' }).click();
    const t0 = Date.now();
    const joined = await waitFor(() => page.locator('[data-agent="Gemini CLI"]').count(), 4000, 50);
    const closed = await waitFor(() => page.evaluate(() => !document.querySelector('[data-path]')), 2000);
    check(`${tag} a new agent shows in the top bar and the list closes`, joined && closed, `${Date.now() - t0} ms after copy`);

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Rules' }).click();
    await page.waitForSelector('[data-rule]');
    const r0 = await page.locator('[data-rule]').count();
    const text = `Use tabs in the config files ${w}`;
    await page.getByRole('textbox', { name: 'New rule' }).fill(text);
    await page.getByRole('radio', { name: 'All projects' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const r1 = await waitFor(async () => {
      const n = await page.locator('[data-rule]').count();
      return n > r0 ? n : null;
    }, 3000);
    check(`${tag} the Rules sheet adds a rule`, r1 === r0 + 1 && (await page.getByText(text).count()) > 0, `${r0} to ${r1}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const o = await overflow(page);
    check(`${tag} signed in has nothing wider than the screen`, o.scroll <= 0 && !o.wide.length, JSON.stringify(o));
    check(`${tag} signed in has no console error`, !errors.length, errors.join(' | '));
  } finally {
    await ctx.close();
  }
}

const srv = await server();
const b = await browser();
try {
  for (const [w, h] of sizes) {
    await signedOut(b, srv.url, w, h);
    await signedIn(b, srv.url, w, h);
  }
} finally {
  await b.close();
  await srv.stop();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
