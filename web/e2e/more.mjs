import { browser, context, press, ready, server, space, waitFor } from './lib.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};

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

const srv = await server();
try {
  const b = await browser();
  try {
    await keyboard(b, srv.url);
    await theme(b, srv.url, 1440, 900);
    await theme(b, srv.url, 390, 664);
    await reduced(b, srv.url);
    await rulesAndAgents(b, srv.url, 1440, 900);
    await rulesAndAgents(b, srv.url, 390, 664);
  } finally {
    await b.close();
  }
  await noWebGL(srv.url);
} finally {
  await srv.stop();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
