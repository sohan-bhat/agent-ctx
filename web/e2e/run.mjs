import { AxeBuilder } from '@axe-core/playwright';
import { browser, context, drag, engine, labels, overflow, pinch, press, ready, server, space, waitFor } from './lib.mjs';

const sizesOf = (d) => (process.env.SIZES ?? d).split(',').map((s) => s.split('x').map(Number));
const sizes = sizesOf('1440x900,390x664,360x640');
const results = [];
async function fill(page) {
  await page.waitForTimeout(900);
  const e = await page.evaluate(() => window.__space?.extent() ?? null);
  if (!e) return { ok: false, text: 'no extent' };
  const fw = (e.x1 - e.x0) / e.w;
  const fh = (e.y1 - e.y0) / e.h;
  return { ok: Math.max(fw, fh) >= 0.6, text: `width ${(fw * 100).toFixed(0)} percent, height ${(fh * 100).toFixed(0)} percent` };
}

const shownPlates = (page) => page.evaluate(() => [...document.querySelectorAll('[data-label=plate]')].filter((e) => e.checkVisibility({ visibilityProperty: true })).length);

const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

async function signedOut(b, url, w, h) {
  const tag = `${w}x${h}`;
  const { ctx, page, errors, touch } = await context(b, { w, h });
  const cdp = touch && engine === 'chromium' ? await ctx.newCDPSession(page) : null;
  try {
    await page.goto(url);
    await ready(page);
    const s = await waitFor(async () => {
      const v = await space(page);
      return v && v.blocks > 0 ? v : null;
    }, 10000);
    check(`${tag} signed out scene shows blocks`, s && s.blocks > 0, `blocks ${s?.blocks}`);
    check(`${tag} signed out shows the word demo`, await page.getByText('demo', { exact: true }).isVisible());
    const f = await fill(page);
    check(`${tag} demo plates fill the canvas`, f.ok, f.text);
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
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin }).catch(() => {});
  const cdp = touch && engine === 'chromium' ? await ctx.newCDPSession(page) : null;
  try {
    await page.goto(url);
    await ready(page);
    await page.waitForTimeout(800);
    const box = await page.locator('[aria-roledescription=space]').boundingBox();
    const projects = page.locator('[aria-label=Projects]');
    await projects.getByRole('radio', { name: 'All', exact: true }).click();
    const all = await fill(page);
    check(`${tag} All fills the canvas`, all.ok, all.text);
    await projects.getByRole('radio', { name: 'harbor', exact: true }).click();
    const one = await fill(page);
    check(`${tag} one project fills the canvas`, one.ok, one.text);
    const alone = await shownPlates(page);
    check(`${tag} only the chosen plate shows`, alone === 1, `${alone} plate names`);
    await projects.getByRole('radio', { name: 'All', exact: true }).click();
    await page.waitForTimeout(700);

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
      await waitFor(() => page.evaluate(() => !document.querySelector('[data-panel], [data-slot=sheet-overlay], [data-slot=popover-content]')), 3000);
      await page.waitForTimeout(300);
    }

    if (touch && cdp) {
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

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Merge projects' }).click();
    await page.locator('[data-merge=merge-from]').click();
    await page.getByRole('option', { name: 'field-notes' }).click();
    await page.locator('[data-merge=merge-into]').click();
    await page.getByRole('option', { name: 'harbor' }).click();
    await page.getByRole('button', { name: 'Merge', exact: true }).click();
    const closedMerge = await waitFor(() => page.evaluate(() => !document.querySelector('[role=dialog]')), 4000);
    const names = () => page.evaluate(() => [...document.querySelectorAll('[aria-label=Projects] [role=radio]')].map((e) => e.textContent));
    const merged = closedMerge && (await waitFor(async () => !(await names()).includes('field-notes'), 4000));
    const left = (await names()).length;
    check(`${tag} Merge projects folds one project into another`, merged && left === 3, `${left} choices left with All`);

    const o = await overflow(page);
    check(`${tag} signed in has nothing wider than the screen`, o.scroll <= 0 && !o.wide.length, JSON.stringify(o));
    check(`${tag} signed in has no console error`, !errors.length, errors.join(' | '));
  } finally {
    await ctx.close();
  }
}

const focused = (page) =>
  page.evaluate(() => {
    const e = document.activeElement;
    return e ? { label: e.getAttribute('aria-label') ?? '', text: (e.textContent ?? '').trim().slice(0, 40), role: e.getAttribute('role') ?? '', space: e.getAttribute('aria-roledescription') === 'space', name: e.getAttribute('name') ?? '', list: !!e.closest('[data-list]') } : null;
  });

async function tabTo(page, test, key = 'Tab', max = 40) {
  for (let i = 0; i < max; i++) {
    if (test(await focused(page))) return true;
    await page.keyboard.press(key);
  }
  return test(await focused(page));
}

async function openByPress(page, touch) {
  const box = await page.locator('[aria-roledescription=space]').boundingBox();
  const spots = await page.evaluate(() => window.__space?.spots() ?? []);
  for (const s of spots.filter((x) => x.look === 'solid' && x.x > 40 && x.x < box.width - 40 && x.y > 60 && x.y < box.height - 30).sort((a, b) => b.area - a.area).slice(0, 10)) {
    await press(page, touch, box.x + s.x, box.y + s.y + 4);
    if (await page.waitForSelector('[data-panel]', { timeout: 2000 }).catch(() => null)) return true;
  }
  return false;
}

async function keyboard(b, url) {
  const { ctx, page, errors } = await context(b, { w: 1440, h: 900, signedIn: true, flags: { quiet: '1' } });
  try {
    await page.goto(url);
    await ready(page);
    await page.waitForTimeout(600);
    const add = await tabTo(page, (f) => f?.text === 'Add agent');
    check('keys reach Add agent by Tab', add);
    await page.keyboard.press('Enter');
    const listed = await waitFor(() => page.locator('[data-product]').count(), 3000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const f1 = await focused(page);
    check('Escape closes Add agent and focus returns to it', listed && f1?.text === 'Add agent', JSON.stringify(f1));

    const scene = await tabTo(page, (f) => f?.space);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    const opened = await waitFor(() => page.locator('[data-panel]').count(), 4000);
    const inPanel = (await focused(page))?.role === 'switch';
    check('keys open a block panel from the scene', scene && !!opened && inPanel);
    const before = await page.locator('[data-panel] [role=switch]').getAttribute('aria-checked');
    await page.keyboard.press('Space');
    const after = await waitFor(async () => {
      const v = await page.locator('[data-panel] [role=switch]').getAttribute('aria-checked');
      return v !== before ? v : null;
    }, 3000);
    check('Space toggles Pin', !!after, `${before} to ${after}`);
    await page.keyboard.press('Escape');
    await waitFor(() => page.evaluate(() => !document.querySelector('[data-panel]')), 3000);
    await page.waitForTimeout(300);
    check('Escape closes the panel and focus returns to the scene', (await focused(page))?.space);

    const menu = await tabTo(page, (f) => f?.label === 'Menu', 'Shift+Tab', 12);
    await page.keyboard.press('Enter');
    await waitFor(() => page.getByRole('menuitem', { name: 'Rules' }).count(), 2000);
    await tabTo(page, (f) => f?.text === 'Rules', 'ArrowDown', 8);
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'New rule' }).waitFor();
    const r0 = await page.locator('[data-rule]').count();
    const input = await tabTo(page, (f) => f?.name === 'rule', 'Tab', 30);
    await page.keyboard.type('Write tests before the fix');
    await page.keyboard.press('Enter');
    const added = await waitFor(async () => (await page.locator('[data-rule]').count()) === r0 + 1, 3000);
    check('keys open Rules from the menu and add a rule', menu && input && added);
    await page.keyboard.press('Escape');
    await waitFor(() => page.evaluate(() => !document.querySelector('[role=dialog]')), 3000);
    await page.waitForTimeout(300);
    check('Escape closes Rules and focus returns to Menu', (await focused(page))?.label === 'Menu');
    check('keyboard walk has no console error', !errors.length, errors.join(' | '));
  } finally {
    await ctx.close();
  }
}

async function sample(page, x, y) {
  const shot = await page.screenshot({ clip: { x: x - 2, y: y - 2, width: 4, height: 4 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  }, shot.toString('base64'));
}

async function theme(b, url, w, h) {
  const tag = `${w}x${h}`;
  const { ctx, page, errors, touch } = await context(b, { w, h, scheme: 'light', signedIn: true, flags: { quiet: '1' } });
  try {
    await page.goto(url);
    await ready(page);
    await page.waitForTimeout(800);
    const box = await page.locator('[aria-roledescription=space]').boundingBox();
    const e = await page.evaluate(() => window.__space.extent());
    const px = box.x + (e.x0 + e.x1) / 2;
    const py = box.y + e.y1 - 5;
    const opened = await openByPress(page, touch);
    await page.waitForTimeout(700);
    const blocks0 = (await space(page)).blocks;
    const light = await sample(page, px, py);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(900);
    const dark = await sample(page, px, py);
    const stillOpen = await page.locator('[data-panel]').count();
    const blocks1 = (await space(page)).blocks;
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(900);
    const back = await sample(page, px, py);
    const open2 = await page.locator('[data-panel]').count();
    const blocks2 = (await space(page)).blocks;
    check(`${tag} the scene redraws in the new palette`, opened && light - dark > 60 && back - dark > 60, `plate luminance ${light.toFixed(0)} to ${dark.toFixed(0)} to ${back.toFixed(0)}`);
    check(`${tag} the panel stays open and blocks stay through the switch`, stillOpen && open2 && blocks0 === blocks1 && blocks1 === blocks2, `blocks ${blocks0} ${blocks1} ${blocks2}`);
    check(`${tag} the switch has no console error`, !errors.length, errors.join(' | '));
  } finally {
    await ctx.close();
  }
}

async function reduced(b, url) {
  {
    const { ctx, page, errors } = await context(b, { w: 1440, h: 900, reduced: true });
    try {
      await page.goto(url);
      await ready(page);
      const t0 = await page.locator('[data-readout]').textContent();
      const n0 = (await space(page)).blocks;
      await page.waitForTimeout(2000);
      const t1 = await page.locator('[data-readout]').textContent();
      check('reduced motion leaves the demo still at the end of the day', t0 === t1 && n0 > 20, `${t0} then ${t1}, ${n0} blocks`);
      check('reduced motion demo has no console error', !errors.length, errors.join(' | '));
    } finally {
      await ctx.close();
    }
  }
  const { ctx, page } = await context(b, { w: 1440, h: 900, reduced: true, signedIn: true, flags: { every: '1500' } });
  try {
    await page.goto(url);
    await ready(page);
    await page.waitForTimeout(500);
    const known = new Set(Object.keys(await page.evaluate(() => window.__heights())));
    const fresh = await waitFor(async () => {
      const hs = await page.evaluate(() => window.__heights());
      const id = Object.keys(hs).find((k) => !known.has(k));
      return id ? { id, h: hs[id] } : null;
    }, 6000, 16);
    await page.waitForTimeout(500);
    const later = fresh ? await page.evaluate((id) => window.__heights()[id], fresh.id) : null;
    check('reduced motion shows a live item at once', fresh && later && fresh.h > 0 && Math.abs(later - fresh.h) < 1e-3, fresh ? `height ${fresh.h.toFixed(3)} at first sight, ${later?.toFixed(3)} after 500 ms` : 'no live item');
  } finally {
    await ctx.close();
  }
}

async function rulesAndAgents(b, url, w, h) {
  const tag = `${w}x${h}`;
  const { ctx, page, errors } = await context(b, { w, h, signedIn: true, flags: { quiet: '1' } });
  try {
    await page.goto(url);
    await ready(page);
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Rules' }).click();
    await page.getByRole('textbox', { name: 'New rule' }).waitFor();
    const first = page.locator('[data-pending]').first();
    const id = await first.getAttribute('data-pending');
    const shown = (await first.locator('[data-line]').textContent())?.trim();
    const who = (await first.locator('.num').textContent())?.trim() ?? '';
    check(`${tag} a pending rule shows the delivered line and who proposed it`, shown === '"push to the release branch after each fix"' && /^Codex .+, harbor$/.test(who), `${shown} | ${who}`);
    await page.evaluate(([i]) => window.__mockEdit(i, 'push to main after each fix'), [id]);
    const kept0 = await page.locator('[data-rule]').count();
    await first.getByRole('button', { name: 'Accept' }).click();
    const told = await waitFor(async () => ((await page.locator('[data-changed]').textContent()) ?? '').includes('This rule changed'), 3000);
    const fresh = await waitFor(async () => ((await page.locator(`[data-pending="${id}"] [data-line]`).textContent()) ?? '').includes('push to main after each fix'), 3000);
    check(`${tag} Accept on a changed rule reloads and says so`, told && fresh && (await page.locator('[data-rule]').count()) === kept0);
    await page.locator(`[data-pending="${id}"]`).getByRole('button', { name: 'Accept' }).click();
    const accepted = await waitFor(async () => (await page.locator('[data-rule]').count()) === kept0 + 1 && !(await page.locator(`[data-pending="${id}"]`).count()), 3000);
    const keptLine = await page.locator(`[data-rule="${id}"] [data-line]`).textContent().catch(() => '');
    check(`${tag} Accept sends the shown line and the kept list shows that line`, accepted && keptLine?.trim() === '"push to main after each fix"', keptLine ?? '');
    await page.keyboard.press('Escape');
    await waitFor(() => page.evaluate(() => !document.querySelector('[role=dialog]')), 3000);
    await page.locator('[data-agent="Cursor"] button').click();
    await page.getByRole('menuitem', { name: 'Disconnect' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
    const gone = await waitFor(async () => (await page.locator('[data-agent="Cursor"]').count()) === 0, 3000);
    check(`${tag} Disconnect behind a confirmation takes the agent off the bar`, gone);
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    const out = await waitFor(() => page.getByRole('link', { name: 'Sign in with GitHub' }).count(), 5000);
    check(`${tag} Sign out shows the signed out page`, !!out);
    check(`${tag} rules and agents have no console error`, !errors.length, errors.join(' | '));
  } finally {
    await ctx.close();
  }
}

async function noWebGL(url) {
  const b = await browser(['--disable-webgl', '--disable-3d-apis']);
  const { ctx, page, errors } = await context(b, { w: 1440, h: 900, signedIn: true, flags: { quiet: '1' } });
  try {
    await page.goto(url);
    const list = page.locator('[data-list]');
    await list.waitFor({ timeout: 15000 });
    const visible = await list.evaluate((e) => !e.classList.contains('sr-only') && e.getBoundingClientRect().width > 200);
    const heads = await list.locator('h2').allTextContents();
    const rows = await list.locator('button').count();
    check('without WebGL the plain list shows, grouped by project and agent', visible && heads.length >= 3 && rows > 50 && !(await page.locator('canvas').count()), `${heads.join(', ')}, ${rows} rows`);
    const first = list.locator('button').first();
    const text = (await first.locator('span').first().textContent())?.trim() ?? '';
    await first.click();
    await page.waitForSelector('[data-panel]');
    const panel = (await page.locator('[data-panel]').textContent()) ?? '';
    const sw = page.locator('[data-panel] [role=switch]');
    const was = await sw.getAttribute('aria-checked');
    await sw.click();
    const now = await waitFor(async () => ((await sw.getAttribute('aria-checked')) !== was ? true : null), 3000);
    await page.keyboard.press('Escape');
    await waitFor(() => page.evaluate(() => !document.querySelector('[data-panel]')), 3000);
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => !!document.activeElement?.closest('[data-list]'));
    check('the list opens the same panel, Pin works and focus returns to the row', panel.includes(text) && now && back, `${text}, panel ${panel.includes(text)}, pin ${now}, back ${back}, focus ${JSON.stringify(await focused(page))}`);
    check('the list view has no console error', !errors.length, errors.join(' | '));
  } finally {
    await ctx.close();
    await b.close();
  }
}

const found = new Map();

async function scan(page, label) {
  const r = await new AxeBuilder({ page }).analyze();
  for (const v of r.violations) {
    const key = `${v.id} ${v.impact}`;
    const row = found.get(key) ?? { n: 0, where: new Set(), sample: v.nodes[0]?.target?.join(' ') ?? '', help: v.help };
    row.n += v.nodes.length;
    row.where.add(label);
    found.set(key, row);
  }
  const n = r.violations.reduce((a, v) => a + v.nodes.length, 0);
  check(`${label} has no accessibility violation`, n === 0, `${n} violations`);
}

async function access(b, url) {
  for (const scheme of (process.env.SCHEMES ?? 'light,dark').split(','))
    for (const [w, h] of sizesOf('1440x900,390x664')) {
      const tag = `${scheme} ${w}x${h}`;
      {
        const { ctx, page } = await context(b, { w, h, scheme });
        try {
          await page.goto(url);
          await ready(page);
          await page.locator('[data-slot=slider-thumb]').focus();
          await page.keyboard.press('End');
          await page.waitForTimeout(800);
          await scan(page, `${tag} signed out`);
        } finally {
          await ctx.close();
        }
      }
      const { ctx, page, touch } = await context(b, { w, h, scheme, signedIn: true, flags: { quiet: '1' } });
      try {
        await page.goto(url);
        await ready(page);
        await page.waitForTimeout(800);
        await scan(page, `${tag} space`);
        if (await openByPress(page, touch)) {
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
      } finally {
        await ctx.close();
      }
    }
  for (const [key, row] of found) console.log(`${key}  ${row.n} nodes in ${[...row.where].length} screens  ${row.help}  ${row.sample}`);
}

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

async function wordCount(b, url) {
  for (const [w, h] of sizesOf('1440x900,390x664'))
    for (const s of screens) {
      const { ctx, page } = await context(b, { w, h, signedIn: s.signedIn, flags: { quiet: '1' } });
      try {
        await page.goto(url);
        await ready(page);
        if (!s.signedIn) {
          await page.locator('[data-slot=slider-thumb]').focus();
          await page.keyboard.press('End');
        }
        await page.waitForTimeout(1200);
        const all = await visibleWords(page);
        const counted = all.filter((x) => !(s.skipAgents && x.agent));
        const n = counted.length;
        check(`${s.name} ${w}x${h} shows at most ${s.limit} words`, n <= s.limit, `${n} words${s.skipAgents ? `, ${all.length - n} agent name words not counted` : ''}`);
        console.log(`  ${counted.map((x) => x.w).join(' ')}`);
      } finally {
        await ctx.close();
      }
    }
}

async function part(name, f) {
  try {
    await f();
  } catch (e) {
    check(`${name} runs to the end`, false, String(e?.message ?? e).split('\n')[0]);
  }
}

const srv = await server();
try {
  const b = await browser();
  try {
    for (const [w, h] of sizes) {
      await part(`${w}x${h} signed out`, () => signedOut(b, srv.url, w, h));
      await part(`${w}x${h} signed in`, () => signedIn(b, srv.url, w, h));
    }
    await part('keyboard walk', () => keyboard(b, srv.url));
    await part('1440x900 theme switch', () => theme(b, srv.url, 1440, 900));
    await part('390x664 theme switch', () => theme(b, srv.url, 390, 664));
    await part('reduced motion', () => reduced(b, srv.url));
    await part('1440x900 rules and agents', () => rulesAndAgents(b, srv.url, 1440, 900));
    await part('390x664 rules and agents', () => rulesAndAgents(b, srv.url, 390, 664));
    await part('accessibility scan', () => access(b, srv.url));
    await part('word count', () => wordCount(b, srv.url));
  } finally {
    await b.close();
  }
  if (engine === 'chromium') await part('list without WebGL', () => noWebGL(srv.url));
  else console.log(`NOTE ${engine} has no flag to turn WebGL off, so the list check runs in Chrome only`);
} finally {
  await srv.stop();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
