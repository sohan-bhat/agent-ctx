import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { browser, engine, overflow, waitFor, web } from './lib.mjs';

const ROOT = path.join(web, '..');
const MAIN = path.join(ROOT, 'plugins', 'claude-code', 'scripts', 'agent-ctx.mjs');
const HOOK = path.join(ROOT, 'plugins', 'claude-code', 'scripts', 'hook.mjs');
const FILES = path.join(web, 'dist-local');
const SHOTS = process.env.SHOTS ?? '';
const OPEN = /^The memory page is open at (http:\/\/127\.0\.0\.1:(\d+)\/([\w-]+)\/) and stays open until 30 seconds after you close the page\.$/m;
const REFUSED = 'Type agent-ctx page in a terminal to open the memory page.';
const COMMAND = 'claude plugin install agent-ctx --marketplace sohan-bhat/agent-ctx';
const PRONOUN = /\b(it|its|itself|it's)\b/i;
const MARKS = /[—–;()]| - /;
const HOSTED = /\b(account|sign in|sign out|signed|hosted|service|privacy|terms)\b/i;
const OTHER = { mcpServers: { files: { command: 'npx', args: ['-y', 'files-server'] } } };
const HARBOR = '/work/harbor';
const LANTERN = '/work/lantern';
const GOALS = { search: 'Add berth search by arrival week', taps: 'Guard berth holds against a double submit', refund: 'Finish partial berth refunds', tiles: 'Split the tile export across workers', glyphs: 'Keep shaped labels between zoom levels', live: 'Email a berth confirmation' };
const LINT = 'run the linter before each push';
const DATES = 'write every date in ISO form';
const sizes = (process.env.SIZES ?? '1440x900,390x664').split(',').filter(Boolean).map((s) => s.split('x').map(Number));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function place() {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-ctx-page-local-'));
  const where = { dir, HOME: path.join(dir, 'home'), AGENT_CTX_HOME: path.join(dir, 'memory'), bin: path.join(dir, 'bin'), log: path.join(dir, 'started.log') };
  for (const folder of [where.bin, path.join(where.HOME, '.cursor'), path.join(where.HOME, '.claude')]) mkdirSync(folder, { recursive: true });
  for (const name of ['open', 'xdg-open', 'claude']) {
    writeFileSync(path.join(where.bin, name), `#!/bin/sh\necho "${name} $*" >> "${where.log}"\n`);
    chmodSync(path.join(where.bin, name), 0o755);
  }
  writeFileSync(path.join(where.HOME, '.cursor', 'mcp.json'), `${JSON.stringify(OTHER, null, 2)}\n`);
  where.env = { PATH: `${where.bin}:/usr/bin:/bin`, HOME: where.HOME, AGENT_CTX_HOME: where.AGENT_CTX_HOME, AGENT_CTX_NO_OPEN: '1', AGENT_CTX_PAGE_DIR: FILES };
  return where;
}

async function agent(where, name, calls) {
  const child = spawn(process.execPath, [MAIN, 'mcp', '--agent', name], { env: where.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const answers = new Map();
  let buffer = '';
  const all = new Promise((done) => {
    child.stdout.on('data', (d) => {
      buffer += String(d);
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const m = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (typeof m.id === 'number') answers.set(m.id, (m.result?.content ?? []).map((c) => c.text ?? '').join(''));
        if (answers.size === calls.length + 1) done();
      }
    });
  });
  const send = (m) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  send({ id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'page-local', version: '1' } } });
  send({ method: 'notifications/initialized' });
  calls.forEach(([tool, args], k) => send({ id: k + 1, method: 'tools/call', params: { name: tool, arguments: args } }));
  await all;
  child.stdin.end();
  await new Promise((done) => child.on('exit', done));
  return calls.map((_, k) => answers.get(k + 1) ?? '');
}

function hook(where, name, event) {
  return spawnSync(process.execPath, [HOOK, '--agent', name], { env: where.env, input: JSON.stringify(event), encoding: 'utf8' });
}

async function seed(where) {
  await agent(where, 'claude-code', [
    ['checkpoint', { folder: HARBOR, goal: GOALS.search, changed: ['src/search/range.ts'], decisions: ['index arrivals by ISO week because weekday sorting broke across years'], commands: ['npm test'] }],
    ['checkpoint', { folder: HARBOR, goal: GOALS.taps, changed: ['src/booking/reserve.ts'], decisions: ['lock the slip row inside the transaction'] }],
    ['handoff', { folder: HARBOR, goal: GOALS.refund, done: 'Full refunds work and have tests', next: 'Partial refunds for cancels within 48 hours', files: ['src/booking/refund.ts'], check: 'npm test' }],
  ]);
  await agent(where, 'cursor', [
    ['checkpoint', { folder: LANTERN, goal: GOALS.tiles, changed: ['src/render/mod.rs'], commands: ['cargo test'] }],
    ['checkpoint', { folder: LANTERN, goal: GOALS.glyphs, changed: ['src/text/glyphs.rs'] }],
    ['rule', { text: 'Run the linter before each push', words: LINT, scope: 'all' }],
    ['rule', { text: 'Write every date in ISO form', words: DATES, scope: 'all' }],
  ]);
  const session = { session_id: 'page-local-1', cwd: HARBOR };
  hook(where, 'claude-code', { ...session, hook_event_name: 'UserPromptSubmit', prompt: 'please make the waitlist offer one freed slip to one person at a time' });
  hook(where, 'claude-code', { ...session, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/waitlist/queue.ts' } });
  hook(where, 'claude-code', { ...session, hook_event_name: 'Stop', last_assistant_message: 'The waitlist now offers a freed slip to one person at a time. Tests pass.' });
}

function rows(where, query, ...args) {
  const emit = process.emitWarning;
  process.emitWarning = () => undefined;
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const db = new DatabaseSync(path.join(where.AGENT_CTX_HOME, 'memory.db'));
    try {
      return db.prepare(query).all(...args).map((r) => ({ ...r }));
    } finally {
      db.close();
    }
  } finally {
    process.emitWarning = emit;
  }
}

const stored = (where) => readdirSync(where.AGENT_CTX_HOME).filter((name) => name.startsWith('memory.db')).map((name) => readFileSync(path.join(where.AGENT_CTX_HOME, name)).toString('latin1')).join('');

const started = (where) => (existsSync(where.log) ? readFileSync(where.log, 'utf8') : '');

async function start(where, env = where.env) {
  const child = spawn(process.execPath, [MAIN, 'page'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += String(d)));
  child.stderr.on('data', (d) => (out += String(d)));
  const ended = new Promise((done) => child.on('exit', (code) => done(code)));
  for (let waited = 0; !OPEN.test(out) && child.exitCode === null && waited < 20000; waited += 50) await sleep(50);
  const hit = OPEN.exec(out);
  if (!hit) throw new Error(`The page command printed no address. ${out}`);
  return { child, ended, base: hit[1], port: Number(hit[2]), token: hit[3], out: () => out };
}

function ask(port, pathname, headers = {}) {
  return new Promise((done, fail) => {
    const r = request({ host: '127.0.0.1', port, path: pathname, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.on('data', (d) => (text += String(d)));
      res.on('end', () => done({ status: res.statusCode, text }));
    });
    r.on('error', fail);
    r.end();
  });
}

const space = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[aria-roledescription=space]');
    return el ? { blocks: Number(el.dataset.blocks), outlines: Number(el.dataset.outlines) } : null;
  });

async function ready(page) {
  await page.waitForSelector('[aria-roledescription=space][data-ready="1"]', { timeout: 30000 });
  await page.waitForTimeout(600);
  const all = page.locator('[aria-label=Projects] [role=radio]', { hasText: /^All$/ });
  if (await all.count()) {
    if ((await all.getAttribute('aria-checked')) !== 'true') await all.click();
    await page.waitForTimeout(400);
  }
}

async function menu(page, name) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name }).click();
}

async function shut(page) {
  await page.keyboard.press('Escape');
  await waitFor(() => page.evaluate(() => !document.querySelector('[role=dialog], [role=alertdialog], [data-panel]')), 3000);
  await page.waitForTimeout(300);
}

const texts = (page) =>
  page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      if (text && !n.parentElement?.closest('script, style')) out.push(text);
    }
    return out;
  });

async function run(b, w, h) {
  const tag = `${w}x${h}`;
  const touch = w < 600;
  const where = place();
  const seen = new Set();
  const errors = [];
  const urls = [];
  let server = null;
  let ctx = null;
  try {
    await seed(where);
    server = await start(where);
    const origin = `http://127.0.0.1:${server.port}`;
    check(`${tag} the page command prints the address in one line`, server.out().trim().split('\n').length === 1, server.out().trim().replace(server.token, 'TOKEN'));
    ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, ...(engine === 'firefox' ? {} : { isMobile: touch }), acceptDownloads: true, colorScheme: 'light' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin }).catch(() => {});
    await ctx.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => console.error(`csp-violation ${e.effectiveDirective} ${e.blockedURI} ${JSON.stringify(e.sample)}`));
    });
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('request', (r) => urls.push(r.url()));
    page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url().replace(server.token, 'TOKEN')}`));
    const note = async () => {
      for (const text of await texts(page)) seen.add(text);
    };
    const shot = async (view, scheme) => {
      await note();
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${view}-${tag}-${scheme}.png`) });
    };

    await page.goto(server.base);
    await ready(page);
    const kept = await page.evaluate(() => `${location.href} ${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)} ${document.cookie}`);
    check(`${tag} after the first load the token is in no address, store or cookie of the page`, kept.startsWith(`${origin}/ `) && !kept.includes(server.token), kept.split(' ')[0]);

    const all = rows(where, 'SELECT kind, held, json_extract(body, \'$.goal\') AS goal, json_extract(body, \'$.status\') AS status FROM items');
    const solid = all.filter((i) => (i.kind === 'card' || i.kind === 'handoff') && !i.held).length;
    const listed = await page.locator('[data-list] button').allTextContents();
    const shown = Object.values(GOALS).filter((goal) => goal !== GOALS.live).every((goal) => listed.some((text) => text.includes(goal)));
    let s = await space(page);
    check(`${tag} the cards and the handoff of the store are on the page`, shown && all.length >= 7 && s.blocks === solid && s.outlines === 2, `${s.blocks} blocks for ${solid} stored cards and handoffs, ${s.outlines} pending rules`);
    const names = await page.locator('[data-agent]').evaluateAll((list) => list.map((e) => e.getAttribute('data-agent')));
    check(`${tag} the agents of the memory show by product name`, names.join() === 'Claude Code,Cursor', names.join());

    const card = page.locator('[data-list] button', { hasText: GOALS.search }).first();
    await card.focus();
    await page.keyboard.press('Enter');
    const opened = await waitFor(() => page.evaluate((t) => document.querySelector('[data-panel]')?.textContent?.includes(t) ?? false, 'index arrivals by ISO week'), 3000);
    await note();
    check(`${tag} a card opens with the saved decision`, opened);
    await shut(page);

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(900);
      await shot('space', scheme);
      await menu(page, 'Rules');
      await page.getByRole('textbox', { name: 'New rule' }).waitFor();
      await page.waitForTimeout(400);
      await shot('rules', scheme);
      await shut(page);
      await page.getByRole('button', { name: 'Add agent' }).click();
      await page.locator('[data-found]').first().waitFor();
      await page.waitForTimeout(400);
      await shot('agents', scheme);
      await shut(page);
    }
    await page.emulateMedia({ colorScheme: 'light' });

    const before = s.blocks;
    const t0 = Date.now();
    await agent(where, 'cursor', [['checkpoint', { folder: HARBOR, goal: GOALS.live, changed: ['src/mail/receipt.ts'] }]]);
    const rose = await waitFor(async () => ((await space(page)).blocks > before ? Date.now() - t0 : null), 6000, 100);
    check(`${tag} a card saved by an agent shows on the open page within six seconds`, rose !== null, `${rose} ms`);

    await menu(page, 'Rules');
    await page.getByRole('textbox', { name: 'New rule' }).waitFor();
    const pending = (words) => page.locator('[data-pending]', { hasText: words });
    const lines = await page.locator('[data-pending] [data-line]').allTextContents();
    const lintId = await pending(LINT).getAttribute('data-pending');
    const datesId = await pending(DATES).getAttribute('data-pending');
    await pending(LINT).getByRole('button', { name: 'Accept' }).click();
    const accepted = await waitFor(async () => (await page.locator(`[data-rule="${lintId}"]`).count()) === 1, 3000);
    await pending(DATES).getByRole('button', { name: 'Reject' }).click();
    const rejected = await waitFor(async () => (await page.locator(`[data-rule="${datesId}"]`).count()) === 1, 3000);
    await note();
    const status = (id) => rows(where, 'SELECT json_extract(body, \'$.status\') AS status, json_extract(body, \'$.proof\') AS proof FROM items WHERE id = ?', id)[0];
    check(`${tag} a pending rule becomes active by a press and is active in the database`, lines.length === 2 && accepted && status(lintId).status === 'active' && status(lintId).proof === 'page', `${JSON.stringify(status(lintId))} after Accept on ${lines.find((l) => l.includes(LINT))}`);
    check(`${tag} a pending rule is turned off by a press on Reject`, rejected && status(datesId).status === 'off', JSON.stringify(status(datesId)));
    const next = hook(where, 'claude-code', { session_id: `page-local-${w}`, cwd: LANTERN, hook_event_name: 'UserPromptSubmit', prompt: 'continue' }).stdout;
    check(`${tag} the accepted rule reaches the next session under RULES and the rejected rule stays out`, (next.split('\nRULES\n')[1] ?? '').includes(LINT) && !next.includes(DATES));
    await shut(page);

    const mcp = path.join(where.HOME, '.cursor', 'mcp.json');
    const hooks = path.join(where.HOME, '.cursor', 'hooks.json');
    const original = readFileSync(mcp, 'utf8');
    const app = path.join(where.AGENT_CTX_HOME, 'app');
    await page.getByRole('button', { name: 'Add agent' }).click();
    const row = (id) => page.locator(`[data-found="${id}"]`);
    await row('cursor').waitFor();
    const found = await page.locator('[data-found]').evaluateAll((list) => list.map((e) => `${e.getAttribute('data-found')} ${e.getAttribute('data-connected')} ${e.querySelector('button')?.textContent}`));
    check(`${tag} the add agent view lists the agents found on this computer with one button each`, found.join() === 'claude-code 0 Connect,cursor 0 Connect', found.join());
    await row('cursor').getByRole('button', { name: 'Connect' }).click();
    await page.locator('[data-plan=cursor] [data-lines]').waitFor();
    const plan = await page.locator('[data-plan=cursor] [data-lines] li').allTextContents();
    const wanted = [`The program is copied to ${app}.`, `The server agent-ctx is added to ${mcp}.`, `${hooks} is created with the agent-ctx hooks for sessionStart, beforeSubmitPrompt, postToolUse, afterAgentResponse and stop.`];
    await note();
    const wide = await overflow(page);
    const past = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('[role=dialog], [role=dialog] li')].map((e) => e.scrollWidth - e.clientWidth)));
    check(`${tag} Connect for Cursor shows the plain lines and writes nothing yet`, JSON.stringify(plan) === JSON.stringify(wanted) && readFileSync(mcp, 'utf8') === original && !existsSync(hooks) && !existsSync(app), plan.join(' | '));
    check(`${tag} the lines with long paths stay inside the screen and inside the dialog`, wide.scroll <= 0 && !wide.wide.length && past <= 0, `${JSON.stringify(wide)}, ${past} px past the dialog`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `plan-${tag}-light.png`) });
    await page.locator('[data-plan=cursor]').getByRole('button', { name: 'Connect' }).click();
    const on = await waitFor(async () => (await row('cursor').getAttribute('data-connected').catch(() => null)) === '1', 4000);
    const told = (await page.locator('[data-said]').textContent())?.trim();
    await note();
    const doc = JSON.parse(readFileSync(mcp, 'utf8'));
    const wrote = Object.keys(doc.mcpServers).join() === 'files,agent-ctx' && doc.mcpServers['agent-ctx'].args[0] === path.join(app, 'agent-ctx.mjs') && existsSync(hooks) && readFileSync(hooks, 'utf8').includes(`${path.join(app, 'hook.mjs')} --agent cursor`) && existsSync(path.join(app, 'hook.mjs'));
    check(`${tag} the second press writes the two files and the row turns to Disconnect`, on && wrote && told === 'Open a new session in Cursor so the memory is loaded.' && (await row('cursor').locator('button').textContent()) === 'Disconnect', told);
    await row('cursor').getByRole('button', { name: 'Disconnect' }).click();
    await page.locator('[data-plan=cursor] [data-lines]').waitFor();
    const undo = await page.locator('[data-plan=cursor] [data-lines] li').allTextContents();
    await note();
    const still = existsSync(hooks) && readFileSync(mcp, 'utf8') !== original;
    await page.locator('[data-plan=cursor]').getByRole('button', { name: 'Disconnect' }).click();
    const off = await waitFor(async () => (await row('cursor').getAttribute('data-connected').catch(() => null)) === '0', 4000);
    check(`${tag} Disconnect shows the lines first and then restores the files`, undo.length === 3 && still && off && readFileSync(mcp, 'utf8') === original && !existsSync(hooks) && readdirSync(path.dirname(mcp)).join() === 'mcp.json', undo.join(' | '));
    await row('claude-code').getByRole('button', { name: 'Connect' }).click();
    const pane = page.locator('[data-plan=claude-code]');
    await pane.locator('code').waitFor();
    const typed = (await pane.locator('code').textContent())?.trim();
    const pills = await pane.getByRole('button', { name: 'Connect' }).count();
    await pane.getByRole('button', { name: 'Copy' }).click();
    const copied = await waitFor(() => pane.getByRole('button', { name: 'Copied' }).count(), 2000);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    await note();
    check(`${tag} Claude Code gets the line to type with a Copy button and no command is run`, typed === COMMAND && pills === 0 && !!copied && (clip === null || clip === COMMAND) && !/^claude /m.test(started(where)), `${typed}, clipboard ${clip === null ? 'not readable in this browser' : 'holds the line'}`);
    await shut(page);

    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), menu(page, 'Export')]);
    const zip = path.join(where.dir, 'export.zip');
    await download.saveAs(zip);
    const names2 = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
    const items = execFileSync('unzip', ['-p', zip, 'agent-ctx/projects/*/items.jsonl'], { encoding: 'utf8' });
    check(`${tag} Export gives a zip with the items`, /handoff\.md/.test(names2) && /rules\.jsonl/.test(names2) && [GOALS.search, GOALS.tiles, GOALS.refund, GOALS.live].every((goal) => items.includes(goal)), `${items.split('\n').filter(Boolean).length} item lines`);

    const bare = await ask(server.port, '/api/space');
    const wrong = await ask(server.port, `/${server.token.slice(0, -1)}${server.token.endsWith('A') ? 'B' : 'A'}/api/space`);
    const foreign = await ask(server.port, `/${server.token}/api/space`, { host: `evil.example:${server.port}` });
    const cross = await ask(server.port, `/${server.token}/api/space`, { origin: 'https://evil.example' });
    const fine = await ask(server.port, `/${server.token}/api/space`);
    check(`${tag} a call without the token is refused`, bare.status === 403 && wrong.status === 403 && bare.text.trim() === REFUSED && fine.status === 200, `${bare.status} and ${wrong.status}`);
    check(`${tag} a call with a foreign Host or a foreign Origin is refused`, foreign.status === 403 && cross.status === 403 && !foreign.text.includes(GOALS.search), `${foreign.status} and ${cross.status}`);

    s = await space(page);
    const o = await overflow(page);
    check(`${tag} nothing is wider than the screen`, o.scroll <= 0 && !o.wide.length, JSON.stringify(o));

    const had = stored(where).includes(GOALS.search);
    await menu(page, 'Delete memory');
    await page.locator('#confirm-delete').waitFor();
    await note();
    await page.locator('#confirm-delete').fill('delete');
    await page.getByRole('button', { name: 'Delete memory' }).click();
    const empty = await waitFor(() => page.getByText('Press Add agent to begin.').count(), 8000);
    await note();
    const left = ['items', 'events', 'sessions', 'projects', 'agents'].map((table) => rows(where, `SELECT COUNT(*) AS n FROM ${table}`)[0].n);
    check(`${tag} Delete memory empties the memory and no saved text stays in the files`, had && !!empty && left.join() === '0,0,0,0,0' && !stored(where).includes(GOALS.search) && !stored(where).includes(LINT), `rows ${left.join(' ')}`);

    const words = [...seen];
    const bad = words.filter((text) => PRONOUN.test(text) || MARKS.test(text));
    check(`${tag} no text node has the word it, a dash as punctuation, a semicolon or a parenthesis`, words.length > 40 && !bad.length, bad.length ? bad.join(' | ') : `${words.length} text nodes read`);
    const told2 = words.filter((text) => HOSTED.test(text));
    check(`${tag} no text node names an account, a sign in or a hosted service`, !told2.length, told2.join(' | '));

    const outside = urls.filter((u) => !u.startsWith(`${origin}/`) && !u.startsWith('data:') && !u.startsWith('blob:'));
    check(`${tag} no request leaves the loopback address`, urls.length > 10 && !outside.length, outside.length ? outside.join(' | ') : `${urls.length} requests, all to ${origin}`);
    check(`${tag} no console error on the page`, !errors.length, errors.join(' | '));

    check(`${tag} no browser was opened by the page command`, !/^(open|xdg-open) /m.test(started(where)), started(where).trim().replace(server.token, 'TOKEN'));
    const again = await page.goto(`${origin}/`);
    check(`${tag} a load of the address without the token gets the one plain line`, again.status() === 403 && (await page.locator('body').textContent()).trim() === REFUSED);
    await ctx.close();
    ctx = null;
    const closed = Date.now();
    await sleep(20000);
    const alive = server.child.exitCode === null;
    const code = await Promise.race([server.ended, sleep(20000).then(() => 'not ended')]);
    check(`${tag} the server process is gone 40 seconds after the page closed`, alive && code === 0, `alive at 20 s, exit ${code} after ${Math.round((Date.now() - closed) / 1000)} s`);
  } finally {
    if (ctx) await ctx.close();
    if (server && server.child.exitCode === null) server.child.kill('SIGTERM');
    rmSync(where.dir, { recursive: true, force: true });
  }
}

async function fetched(b) {
  const { NAME, pack } = await import(pathToFileURL(path.join(web, 'pack.mjs')).href);
  const where = place();
  const made = pack(FILES, path.join(where.dir, 'release', NAME));
  const bytes = readFileSync(made.path);
  const sum = (data) => `${createHash('sha256').update(data).digest('hex')}  ${NAME}\n`;
  let sums = sum(Buffer.from('other bytes'));
  const site = createServer((req, res) => {
    const name = (req.url ?? '').slice(1);
    if (name === NAME) return void res.writeHead(200).end(bytes);
    if (name === 'SHA256SUMS') return void res.writeHead(200).end(sums);
    res.writeHead(404).end();
  });
  await new Promise((done) => site.listen(0, '127.0.0.1', done));
  const { AGENT_CTX_PAGE_DIR: _unused, ...rest } = where.env;
  const env = { ...rest, AGENT_CTX_RELEASES: `http://127.0.0.1:${site.address().port}` };
  const kept = path.join(where.AGENT_CTX_HOME, 'app', 'page');
  let server = null;
  let ctx = null;
  try {
    await seed(where);
    const bad = spawn(process.execPath, [MAIN, 'page'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let said = '';
    bad.stdout.on('data', (d) => (said += String(d)));
    const code = await Promise.race([new Promise((done) => bad.on('exit', done)), sleep(15000).then(() => 'not ended')]);
    if (bad.exitCode === null) bad.kill('SIGTERM');
    check('a wrong hash ends in one plain line and keeps no page files', code === 1 && said.trim() === 'The fetched page files do not match the hash in SHA256SUMS, so nothing was kept.' && !existsSync(path.join(where.AGENT_CTX_HOME, 'app')), `exit ${code}, ${said.trim().split('\n')[0]}`);
    sums = sum(bytes);
    server = await start(where, env);
    ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
    await page.goto(server.base);
    await ready(page);
    const s = await space(page);
    const lines = server.out().trim().split('\n');
    const whole = made.files.every((name) => existsSync(path.join(kept, ...name.split('/'))));
    check('the page files fetched from a release address with a good hash draw the memory', lines.length === 2 && lines[0] === `The page files were fetched once and are kept in ${kept}.` && whole && s.blocks >= 5 && !errors.length, `${made.files.length} files in ${made.size} bytes, ${s.blocks} blocks${errors.length ? `, ${errors.join(' | ')}` : ''}`);
  } finally {
    if (ctx) await ctx.close();
    if (server && server.child.exitCode === null) server.child.kill('SIGTERM');
    await new Promise((done) => site.close(done));
    rmSync(where.dir, { recursive: true, force: true });
  }
}

if (!existsSync(path.join(FILES, 'index.html'))) {
  console.log(`No built page was found in ${FILES}. Run npm --prefix web run build:local first.`);
  process.exit(1);
}
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await browser();
try {
  try {
    await fetched(b);
  } catch (e) {
    check('the fetch path runs to the end', false, String(e?.message ?? e).split('\n')[0]);
  }
  for (const [w, h] of sizes) {
    try {
      await run(b, w, h);
    } catch (e) {
      check(`${w}x${h} runs to the end`, false, String(e?.message ?? e).split('\n')[0]);
    }
  }
} finally {
  await b.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
