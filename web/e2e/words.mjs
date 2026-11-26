import { browser, context, ready, server } from './lib.mjs';

const visibleWords = (page) =>
  page.evaluate(() => {
    const hidden = (el) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        if (cs.overflow === 'hidden' && r.width <= 1 && r.height <= 1) return true;
      }
      return false;
    };
    const words = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      const text = (n.textContent ?? '').trim();
      if (!el || !text) continue;
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.bottom <= 0 || r.top >= innerHeight || hidden(el)) continue;
      const agent = !!el.closest('[data-label=district]') || (!!el.closest('[data-agent]') && !el.classList.contains('num'));
      for (const w of text.split(/\s+/).filter(Boolean)) words.push({ w, agent });
    }
    return words;
  });

const screens = [
  { name: 'signed out', signedIn: false, limit: 25, skipAgents: false },
  { name: 'signed in', signedIn: true, limit: 40, skipAgents: true },
];
const sizes = (process.env.SIZES ?? '1440x900,390x664').split(',').map((s) => s.split('x').map(Number));

const srv = await server();
const b = await browser();
let over = 0;
try {
  for (const [w, h] of sizes)
    for (const s of screens) {
      const { ctx, page } = await context(b, { w, h, signedIn: s.signedIn, flags: { quiet: '1' } });
      await page.goto(srv.url);
      await ready(page);
      if (!s.signedIn) {
        await page.locator('[data-slot=slider-thumb]').focus();
        await page.keyboard.press('End');
      }
      await page.waitForTimeout(1200);
      const all = await visibleWords(page);
      const counted = all.filter((x) => !(s.skipAgents && x.agent));
      const n = counted.length;
      if (n > s.limit) over++;
      console.log(`${s.name} ${w}x${h}  ${n} words, limit ${s.limit}${s.skipAgents ? `, ${all.length - n} agent name words not counted` : ''}`);
      console.log(`  ${counted.map((x) => x.w).join(' ')}`);
      await ctx.close();
    }
} finally {
  await b.close();
  await srv.stop();
}
process.exit(over ? 1 : 0);
