import { AxeBuilder } from '@axe-core/playwright';
import { browser, context, press, ready, server } from './lib.mjs';

const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');
const sizes = (process.env.SIZES ?? '1440x900,390x664').split(',').map((s) => s.split('x').map(Number));
const found = new Map();
let total = 0;

async function scan(page, label) {
  const r = await new AxeBuilder({ page }).analyze();
  for (const v of r.violations) {
    total += v.nodes.length;
    const key = `${v.id} ${v.impact}`;
    const row = found.get(key) ?? { n: 0, where: new Set(), sample: v.nodes[0]?.target?.join(' ') ?? '', help: v.help };
    row.n += v.nodes.length;
    row.where.add(label);
    found.set(key, row);
  }
  console.log(`${label}  ${r.violations.reduce((a, v) => a + v.nodes.length, 0)} violations`);
}

async function openPanel(page, touch) {
  const box = await page.locator('[aria-roledescription=space]').boundingBox();
  const spots = await page.evaluate(() => window.__space?.spots() ?? []);
  for (const s of spots.filter((x) => x.look === 'solid' && x.x > 40 && x.x < box.width - 40 && x.y > 60 && x.y < box.height - 30).sort((a, b) => b.area - a.area).slice(0, 10)) {
    await press(page, touch, box.x + s.x, box.y + s.y + 4);
    if (await page.waitForSelector('[data-panel]', { timeout: 2000 }).catch(() => null)) return true;
  }
  return false;
}

const srv = await server();
const b = await browser();
try {
  for (const scheme of schemes)
    for (const [w, h] of sizes) {
      const tag = `${scheme} ${w}x${h}`;
      {
        const { ctx, page } = await context(b, { w, h, scheme });
        await page.goto(srv.url);
        await ready(page);
        await page.locator('[data-slot=slider-thumb]').focus();
        await page.keyboard.press('End');
        await page.waitForTimeout(800);
        await scan(page, `${tag} signed out`);
        await ctx.close();
      }
      const { ctx, page, touch } = await context(b, { w, h, scheme, signedIn: true, flags: { quiet: '1' } });
      await page.goto(srv.url);
      await ready(page);
      await page.waitForTimeout(800);
      await scan(page, `${tag} space`);
      if (await openPanel(page, touch)) {
        await page.waitForTimeout(500);
        await scan(page, `${tag} panel`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } else console.log(`${tag} panel did not open`);
      await page.getByRole('button', { name: 'Add agent' }).click();
      await page.waitForSelector('[data-product]');
      await page.waitForTimeout(300);
      await scan(page, `${tag} add agent`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('menuitem', { name: 'Rules' }).click();
      await page.getByRole('textbox', { name: 'New rule' }).waitFor();
      await page.waitForTimeout(300);
      await scan(page, `${tag} rules`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('menuitem', { name: 'Merge projects' }).click();
      await page.locator('[data-merge=merge-from]').waitFor();
      await page.waitForTimeout(300);
      await scan(page, `${tag} merge`);
      await ctx.close();
    }
} finally {
  await b.close();
  await srv.stop();
}
for (const [key, row] of found) console.log(`${key}  ${row.n} nodes in ${[...row.where].length} screens  ${row.help}  ${row.sample}`);
console.log(`\n${total} violations in all`);
process.exit(total ? 1 : 0);
