import fs from 'node:fs';
import path from 'node:path';
import { browser, context, engine, press, ready, server, web } from './lib.mjs';

const out = process.env.OUT ?? path.join(web, '..', '..', '..', 'shots', 'build-c');
fs.mkdirSync(out, { recursive: true });
const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');
const sizes = (process.env.SIZES ?? '1440x900,390x664').split(',').map((s) => s.split('x').map(Number));

async function openPanel(page, touch) {
  const box = await page.locator('[aria-roledescription=space]').boundingBox();
  const spots = await page.evaluate(() => window.__space?.spots() ?? []);
  const order = spots.filter((s) => s.look === 'solid' && s.x > 60 && s.x < box.width - 60 && s.y > 120 && s.y < box.height - 30).sort((a, b) => b.area - a.area);
  for (const s of order.slice(0, 10)) {
    await press(page, touch, box.x + s.x, box.y + s.y + 4);
    const ok = await page.waitForSelector('[data-panel]', { timeout: 2000 }).catch(() => null);
    if (ok) return true;
  }
  return false;
}

const srv = await server();
const b = await browser();
try {
  for (const scheme of schemes)
    for (const [w, h] of sizes) {
      const tag = `${process.env.ONLY ? `${engine}-` : ''}${w < 600 ? 'phone' : 'desktop'}-${scheme}`;
      if (!process.env.ONLY) {
        const { ctx, page } = await context(b, { w, h, scheme, dpr: 2 });
        await page.goto(srv.url);
        await ready(page);
        await page.locator('[data-slot=slider-thumb]').focus();
        await page.keyboard.press('End');
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${out}/signed-out-${tag}.png` });
        await ctx.close();
      }
      const { ctx, page, touch } = await context(b, { w, h, scheme, dpr: 2, signedIn: true, flags: { quiet: '1' } });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(srv.url).origin }).catch(() => {});
      await page.goto(srv.url);
      await ready(page);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/space-${tag}.png` });
      if (!process.env.ONLY) {
        await page.locator('header').screenshot({ path: `${out}/top-bar-${tag}.png` });
        await page.locator('[data-agent] button').first().click();
        await page.getByRole('menuitem', { name: 'Disconnect' }).waitFor();
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${out}/agent-menu-${tag}.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      if (process.env.ONLY) {
        const gl = await page.evaluate(() => {
          const c = document.createElement('canvas');
          const g = c.getContext('webgl2') ?? c.getContext('webgl');
          return { webgl: !!g, renderer: g ? String(g.getParameter(g.RENDERER)) : '', canvas: !!document.querySelector('[aria-roledescription=space] canvas'), list: !document.querySelector('[data-list]')?.classList.contains('sr-only') };
        });
        console.log(tag, JSON.stringify(gl));
        await ctx.close();
        continue;
      }
      if (w >= 600) {
        const box = await page.locator('[aria-roledescription=space]').boundingBox();
        const cx = Math.round(box.x + box.width / 2 - 150);
        const cy = Math.round(box.y + box.height / 2 - 100);
        await page.screenshot({ path: `${out}/crop-1to1-${tag}.png`, clip: { x: cx, y: cy, width: 300, height: 200 } });
      }
      if (await openPanel(page, touch)) {
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${out}/panel-${tag}.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);
      }
      await page.getByRole('button', { name: 'Add agent' }).click();
      await page.waitForSelector('[data-product]');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/add-agent-${tag}.png` });
      await page.locator('[data-product=claude-code]').click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/add-agent-path-${tag}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('menuitem', { name: 'Rules' }).click();
      await page.waitForSelector('[data-rule]');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/rules-${tag}.png` });
      await ctx.close();
      console.log('shot', tag);
    }
} finally {
  await b.close();
  await srv.stop();
}
