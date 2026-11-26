import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stamp } from '../../plugins/stamp.mjs';
import { jarFrom, open, ORIGIN, page } from './lib.mjs';
import { ITEMS, QUERIES_2B as QUERIES } from '../../core/test/corpus2.ts';
import { GALE, PANTRY } from '../../core/test/corpus.ts';

export const BIN = process.env.E2E_CLAUDE_BIN ?? join(homedir(), '.local', 'bin', 'claude');
export const MAX_RUNS = Number(process.env.E2E_MAX_RUNS ?? 25);
export const MAX_COST = Number(process.env.E2E_MAX_COST ?? 0.4);
const COST_BEFORE = Number(process.env.E2E_COST_BEFORE ?? 0);

export function paths(tmp, proofs) {
  return { tmp, proofs, secrets: join(tmp, 'secrets.json'), ledger: join(proofs, 'runs.jsonl') };
}

export function spentSoFar(ledger) {
  if (!existsSync(ledger)) return 0;
  return readFileSync(ledger, 'utf8').split('\n').filter(Boolean).reduce((n, l) => n + (JSON.parse(l).cost ?? 0), 0);
}

export function runsSoFar(ledger) {
  return existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).length : 0;
}

export function scrub(text, secrets, tmp) {
  let out = String(text);
  for (const v of secrets) if (v) out = out.split(v).join('REDACTED');
  out = out.replace(/Bearer [A-Za-z0-9._~+/:=-]+/g, 'Bearer REDACTED');
  out = out.split(tmp).join('/scratch');
  const me = userInfo().username;
  if (me.length > 2) out = out.split(me).join('owner');
  return out.replace(/\/private\/tmp\/claude-\d+\/[^\s"'\\]+?\/scratchpad/g, '/scratchpad').replace(/\/Users\/[^/\s"'\\]+/g, '/home');
}

export const SCOPED = 'plugin:agent-ctx:agent-ctx';

function setup(p, side, layout) {
  const settings = join(p.tmp, 'settings.json');
  writeFileSync(settings, JSON.stringify({ autoMemoryEnabled: false }));
  if (side === 'none') {
    const empty = join(p.tmp, 'mcp-empty.json');
    if (!existsSync(empty)) writeFileSync(empty, JSON.stringify({ mcpServers: {} }));
    return { mcp: empty, settings, plugin: null };
  }
  const s = JSON.parse(readFileSync(p.secrets, 'utf8'));
  const dir = join(p.tmp, 'plugin');
  if (!existsSync(join(dir, 'claude-code'))) stamp(ORIGIN, dir);
  const plugin = join(dir, 'claude-code');
  const server = (name) => ({ mcpServers: { [name]: { type: 'http', url: `${ORIGIN}/mcp`, headers: { Authorization: `Bearer ${s[side].access}` } } } });
  const mcp = join(p.tmp, `mcp-${side}-${layout}.json`);
  if (layout === 'settings') {
    writeFileSync(mcp, JSON.stringify(server('agent-ctx')));
    const hooks = readFileSync(join(plugin, 'hooks', 'hooks.json'), 'utf8').split(SCOPED).join('agent-ctx');
    const file = join(p.tmp, 'settings-hooks.json');
    writeFileSync(file, JSON.stringify({ autoMemoryEnabled: false, hooks: JSON.parse(hooks).hooks }));
    return { mcp, settings: file, plugin: null };
  }
  if (layout === 'tools') {
    writeFileSync(mcp, JSON.stringify(server('agent-ctx')));
    return { mcp, settings, plugin: null };
  }
  writeFileSync(mcp, JSON.stringify(server(SCOPED)));
  return { mcp, settings, plugin };
}

function userLine(text) {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;
}

export async function runClaude(p, o) {
  const used = runsSoFar(p.ledger);
  if (used >= MAX_RUNS) throw new Error(`The budget of ${MAX_RUNS} runs is spent.`);
  const spent = COST_BEFORE + spentSoFar(p.ledger);
  if (spent >= MAX_COST) throw new Error(`The cost cap of ${MAX_COST} dollars is reached, ${spent.toFixed(4)} spent.`);
  const model = o.model ?? 'haiku';
  const layout = o.layout ?? 'scoped';
  const c = setup(p, o.side, layout);
  const debug = join(p.tmp, `${o.name}.debug.log`);
  const multi = o.prompts.length > 1;
  const args = ['-p'];
  if (!multi) args.push(o.prompts[0]);
  args.push('--model', model, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--no-session-persistence');
  args.push('--strict-mcp-config', '--mcp-config', c.mcp, '--settings', c.settings, '--setting-sources', 'project', '--debug-file', debug);
  if (multi) args.push('--input-format', 'stream-json');
  if (c.plugin) args.push('--plugin-dir', c.plugin);
  if (o.tools?.length) args.push('--allowedTools', o.tools.join(','));
  const env = { ...process.env, DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
  const started = Date.now();
  const child = spawn(BIN, args, { cwd: o.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let err = '';
  let buf = '';
  let sent = 1;
  if (multi) child.stdin.write(userLine(o.prompts[0]));
  else child.stdin.end();
  const timer = setTimeout(() => child.kill('SIGTERM'), o.timeout ?? 240000);
  child.stderr.on('data', (d) => (err += d));
  child.stdout.on('data', (d) => {
    buf += d;
    let at;
    while ((at = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, at);
      buf = buf.slice(at + 1);
      if (!line.trim()) continue;
      lines.push(line);
      if (!multi) continue;
      try {
        if (JSON.parse(line).type === 'result') {
          if (sent < o.prompts.length) child.stdin.write(userLine(o.prompts[sent++]));
          else child.stdin.end();
        }
      } catch {
        continue;
      }
    }
  });
  const code = await new Promise((r) => child.on('close', r));
  clearTimeout(timer);
  if (buf.trim()) lines.push(buf);
  const events = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { type: 'raw', text: l };
    }
  });
  const results = events.filter((e) => e.type === 'result');
  const secrets = existsSync(p.secrets) ? Object.values(JSON.parse(readFileSync(p.secrets, 'utf8'))).flatMap((v) => (typeof v === 'object' ? [v.access, v.clientId] : [v])) : [];
  mkdirSync(p.proofs, { recursive: true });
  writeFileSync(join(p.proofs, `${o.name}.jsonl`), scrub(lines.join('\n') + '\n', secrets, p.tmp));
  if (existsSync(debug)) writeFileSync(join(p.proofs, `${o.name}.debug.log`), scrub(readFileSync(debug, 'utf8').split('\n').filter((l) => /hook|mcp|agent-ctx|plugin/i.test(l)).join('\n') + '\n', secrets, p.tmp));
  const cost = results.reduce((n, r) => n + (r.total_cost_usd ?? 0), 0);
  const row = {
    n: used + 1,
    name: o.name,
    side: o.side,
    label: o.side === 'A' ? 'Claude Code' : o.side === 'B' ? 'Codex' : 'none',
    layout: o.side === 'none' ? 'none' : layout,
    model,
    cwd: scrub(o.cwd, secrets, p.tmp),
    prompts: o.prompts,
    code,
    start: started,
    end: Date.now(),
    seconds: Math.round((Date.now() - started) / 100) / 10,
    cost,
    usage: results.map((r) => r.usage ?? null),
    turns: results.map((r) => r.num_turns ?? null),
    result: results.map((r) => String(r.result ?? '').slice(0, 400)),
    denied: results.flatMap((r) => r.permission_denials ?? []),
  };
  appendFileSync(p.ledger, scrub(JSON.stringify(row), secrets, p.tmp) + '\n');
  return { row, events, stderr: scrub(err, secrets, p.tmp) };
}

export function summary(events) {
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const hooks = events.filter((e) => e.type === 'system' && /hook/.test(String(e.subtype)));
  const tools = events.flatMap((e) => (e.type === 'assistant' ? (e.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => ({ name: c.name, input: c.input })) : []));
  return {
    mcp: init?.mcp_servers ?? null,
    plugins: init?.plugins ?? null,
    hooks: hooks.map((h) => ({ subtype: h.subtype, name: h.hook_name ?? h.hook_event ?? h.name, outcome: h.outcome ?? h.exit_code ?? null, output: String(h.output ?? h.stdout ?? '').slice(0, 200) })),
    tools,
  };
}

export const AGENTS_LINE = 'At the start of every task call the agent-ctx recall tool with the repo and folder. Before your final reply after any file change call the agent-ctx checkpoint tool.';
const STOP = " That's it for today. I'm stopping here and will carry on tomorrow in another agent.";

export const TASKS = [
  { name: 'tip-calc', files: { 'tip.py': 'def tip(total):\n    return total * 0.15\n' }, ask: 'Can you make tip() in tip.py take the percent as a second argument? Keep 15 as the default.' },
  { name: 'slug-maker', files: { 'slug.js': "function slugify(s) {\n  return s.trim().replace(/\\s+/g, '-');\n}\nmodule.exports = { slugify };\n" }, ask: 'slugify in slug.js keeps capital letters. It should lower case the result, can you fix that?' },
  { name: 'dice-roller', files: { 'main.py': 'import random\nprint(random.randint(1, 6))\n', 'README.md': '# dice-roller\n\nRolls a die.\n' }, ask: 'Add a short Usage section to the README that shows how to run main.py.' },
  { name: 'tiny-math', files: { 'mathx.py': 'def add(a, b):\n    return a + b\n' }, ask: 'Please add a unittest for add() in mathx.py, in a new file test_mathx.py.', stop: true },
  { name: 'fetch-tool', files: { 'config.json': '{\n  "url": "https://api.example.com",\n  "timeout": 30\n}\n' }, ask: 'Bump the timeout in config.json from 30 to 60 and add a retries field set to 3.' },
  { name: 'nightly-copy', files: { 'backup.sh': '#!/bin/sh\ncp -r ./data /tmp/backup\n' }, ask: 'backup.sh copies into /tmp/backup. Change it to use a BACKUP_DIR variable at the top instead.' },
  { name: 'score-stats', files: { 'stats.py': 'def average(xs):\n    return sum(xs) / len(xs)\n' }, ask: 'average() in stats.py crashes on an empty list. Make it return 0 for that case.' },
  { name: 'user-list', files: { 'api.js': 'async function getdata() {\n  return [];\n}\nmodule.exports = { getdata };\n', 'index.js': "const { getdata } = require('./api');\ngetdata().then(console.log);\n" }, ask: 'Rename getdata to fetchUsers in api.js and update the call in index.js.', stop: true },
  { name: 'button-kit', files: { 'style.css': 'button {\n  padding: 8px 12px;\n  border: 1px solid #333;\n}\n' }, ask: 'Give the buttons in style.css rounded corners, 6px.' },
  { name: 'hello-cli', files: { 'greet.py': 'print("Hello, world")\n' }, ask: 'Add a --name flag to greet.py so it prints Hello, NAME. It should default to world.' },
  { name: 'plant-log', files: { 'index.html': '<!doctype html>\n<html>\n<head>\n<title>Untitled</title>\n</head>\n<body>\n<h1>Plants</h1>\n</body>\n</html>\n' }, ask: 'Change the page title in index.html to Plant Log and add a meta description.' },
  { name: 'geo-points', files: { 'models.py': 'class Point:\n    def __init__(self, x, y):\n        self.x = x\n        self.y = y\n' }, ask: 'Turn the Point class in models.py into a dataclass.', stop: true },
  { name: 'parity-check', files: { 'even.js': 'function isEven(n) {\n  return n % 2 === 0;\n}\nmodule.exports = { isEven };\n' }, ask: "Write a tiny test for isEven in even.js using node's assert module, in even.test.js." },
  { name: 'web-shell', files: { '.gitignore': 'dist/\n', 'package.json': '{\n  "name": "web-shell",\n  "version": "0.1.0"\n}\n' }, ask: 'Add .env and node_modules to the .gitignore please.' },
  { name: 'unit-swap', files: { 'convert.py': 'def c_to_f(c):\n    return c * 9 / 5 + 32\n\n\ndef f_to_c(f):\n    return (f - 32) * 5 / 9\n' }, ask: 'Add type hints to the functions in convert.py.' },
  { name: 'csv-pal', files: { 'CHANGELOG.md': '# Changelog\n\n## 0.2.0\n\n- Added JSON export.\n' }, ask: 'Add an entry to CHANGELOG.md for version 0.3.0 that says we added CSV export.', stop: true },
  { name: 'kitchen-timer', files: { 'timer.js': 'function wait(seconds, done) {\n  setTimeout(done, seconds * 1000);\n}\nmodule.exports = { wait };\n' }, ask: 'In timer.js, pull the 1000 out into a named constant.' },
  { name: 'roster', files: { 'names.py': 'def sort_names(names):\n    return sorted(names)\n' }, ask: 'sort_names in names.py should ignore case when it sorts. Can you fix it?' },
  { name: 'ci-setup', files: { 'ci.yml': 'name: test\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node: [18, 20]\n    steps:\n      - uses: actions/checkout@v4\n' }, ask: 'Add Node 22 to the test matrix in ci.yml.' },
  { name: 'queue-worker', files: { 'worker.py': 'def run(jobs):\n    for job in jobs:\n        print("starting", job)\n        print("done", job)\n' }, ask: 'Replace the print calls in worker.py with the logging module.', stop: true },
];

export const RULES = [
  { name: 'rule-docstrings', files: { 'util.py': 'def square(x):\n    return x * x\n' }, ask: 'Add a function to util.py that doubles a number. Also, from now on I want every Python function to have a docstring.' },
  { name: 'rule-quotes', files: { 'messages.js': 'const greeting = "Please recieve our thanks";\nmodule.exports = { greeting };\n' }, ask: 'Fix the typo recieve in messages.js. And going forward, always use single quotes in JavaScript.' },
  { name: 'rule-dates', files: { 'notes.md': '# Notes\n\n- Kickoff was on the first of November.\n' }, ask: 'Add a note to notes.md that the demo moved to Friday the 4th of December. From now on, write dates as YYYY-MM-DD in my docs.' },
];

export const TOOLS = [
  'mcp__agent-ctx__recall',
  'mcp__agent-ctx__checkpoint',
  'mcp__agent-ctx__handoff',
  'mcp__agent-ctx__rule',
  'Read',
  'Write',
  'Edit',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(git status:*)',
  'Bash(git remote get-url:*)',
  'Bash(git diff:*)',
  'Bash(python3:*)',
  'Bash(node:*)',
];

function skipProject(root, t, agents) {
  const dir = join(root, t.name);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', `git@github.com:example-org/${t.name}.git`]);
  for (const [f, body] of Object.entries(t.files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  if (agents) writeFileSync(join(dir, 'AGENTS.md'), `${AGENTS_LINE}\n`);
  return dir;
}

const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SKIP_OWN = /^mcp__agent-ctx__(recall|checkpoint|handoff|rule)$/;

export function analyseSkip(file) {
  const calls = [];
  const errors = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'tool_use') calls.push({ id: c.id, name: c.name });
    if (e.type === 'user') for (const c of e.message?.content ?? []) if (c.type === 'tool_result' && c.is_error) errors.set(c.tool_use_id, true);
  }
  const at = (pred) => calls.findIndex(pred);
  const last = (pred) => calls.map((c, i) => (pred(c) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const isEdit = (c) => EDIT.has(c.name);
  const own = (n) => (c) => c.name === `mcp__agent-ctx__${n}`;
  const firstEdit = at(isEdit);
  const lastEdit = last(isEdit);
  const recallAt = at(own('recall'));
  const checkpointAt = last(own('checkpoint'));
  return {
    edits: calls.filter(isEdit).length,
    sequence: calls.filter((c) => SKIP_OWN.test(c.name) || isEdit(c)).map((c) => `${c.name.replace('mcp__agent-ctx__', '')}${errors.get(c.id) ? ' failed' : ''}`),
    recallBeforeEdit: recallAt >= 0 && (firstEdit < 0 || recallAt < firstEdit),
    checkpointAfterWork: checkpointAt >= 0 && checkpointAt > lastEdit,
    handoff: calls.some(own('handoff')),
    rule: calls.some(own('rule')),
  };
}

export function countSkip(proofs) {
  const runs = readFileSync(join(proofs, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const stops = new Set(TASKS.filter((t) => t.stop).map((t) => t.name));
  const rows = runs.map((r) => {
    const cond = /^([A-Z])-/.exec(r.name)?.[1] ?? '';
    const base = r.name.replace(/^(?:[A-Z]-)?(haiku|sonnet)-/, '');
    return { name: r.name, cond, model: r.model, group: RULES.some((t) => t.name === base) ? 'rule' : TASKS.some((t) => t.name === base) ? 'task' : 'other', stop: stops.has(base), cost: r.cost, ...analyseSkip(join(proofs, `${r.name}.jsonl`)) };
  });
  const tally = ([cond, model]) => {
    const mine = rows.filter((r) => r.cond === cond && r.model === model);
    const tasks = mine.filter((r) => r.group === 'task');
    const rules = mine.filter((r) => r.group === 'rule');
    const stopped = tasks.filter((r) => r.stop);
    return {
      cond,
      model,
      tasks: tasks.length,
      recallBeforeEdit: tasks.filter((r) => r.recallBeforeEdit).length,
      checkpointAfterWork: tasks.filter((r) => r.checkpointAfterWork).length,
      stopTasks: stopped.length,
      handoffOnStop: stopped.filter((r) => r.handoff).length,
      ruleRuns: rules.length,
      ruleCalled: rules.filter((r) => r.rule).length,
      cost: Math.round(mine.reduce((n, r) => n + r.cost, 0) * 1e5) / 1e5,
    };
  };
  const keys = [...new Set(rows.filter((r) => r.group !== 'other').map((r) => `${r.cond}|${r.model}`))].map((k) => k.split('|'));
  return { totals: keys.map(tally), rows };
}

async function runSet(p, set, model, only, cond) {
  const done = new Set(existsSync(p.ledger) ? readFileSync(p.ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).name) : []);
  const root = join(process.env.E2E_PROJECTS ?? join(p.tmp, 'projects'), cond || 'base', model);
  for (const t of set.slice(0, only ?? set.length)) {
    const name = `${cond ? `${cond}-` : ''}${model}-${t.name}`;
    if (done.has(name)) continue;
    const cwd = skipProject(root, t, cond === 'B');
    const prompt = t.ask + (t.stop ? STOP : '');
    const r = await runClaude(p, { name, side: 'A', cwd, prompts: [prompt], tools: TOOLS, layout: 'tools', model });
    const a = analyseSkip(join(p.proofs, `${name}.jsonl`));
    console.log(`${r.row.n} ${name} ${r.row.cost.toFixed(5)} ${a.sequence.join(' > ') || 'no tool calls'}`);
  }
}

export const SEEDED = [GALE, PANTRY];
export const RECALL = 'mcp__agent-ctx__recall';
const TOPIC_TOOLS = [RECALL, 'Read'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const nameOf = (key) => key.split('/').pop();
const remoteOf = (key) => `git@github.com:${key.split('/').slice(1).join('/')}.git`;

function args(item) {
  const b = item.body;
  const decisions = [...(b.decisions ?? []).map((d) => (d.why ? `${d.what}, because ${d.why}` : d.what)), ...(b.last ? [b.last] : [])];
  const out = { repo: `https://${item.project}`, goal: b.goal };
  if (b.changed?.length) out.changed = b.changed.map((c) => c.path);
  if (decisions.length) out.decisions = decisions;
  if (b.commands?.length) out.commands = b.commands;
  if (b.dead_ends?.length) out.dead_ends = b.dead_ends;
  if (b.open?.length) out.open = b.open;
  return out;
}

export function cards() {
  return ITEMS.filter((i) => i.kind === 'card' && SEEDED.includes(i.project)).sort((a, b) => a.created - b.created);
}

export function queries() {
  return QUERIES.filter((q) => q.kind === 'other' && SEEDED.includes(q.project)).slice(0, 10);
}

async function seed(secretsFile, out) {
  const s = JSON.parse(readFileSync(secretsFile, 'utf8'));
  const agent = await open(s.B.access);
  const list = cards();
  let ok = 0;
  for (const item of list) {
    const r = await agent.call('checkpoint', args(item));
    if (r.isError || r.error) throw new Error(`Card ${item.id} was not saved, ${r.text || JSON.stringify(r.error)}`);
    ok++;
    await sleep(1100);
  }
  const sp = await page(jarFrom(s.cookie), 'GET', '/space');
  const map = {};
  for (const item of list) {
    const found = sp.json.items.find((i) => i.kind === 'card' && i.project === item.project && i.body.goal === item.body.goal);
    if (found) map[item.id] = { id: found.id, goal: item.body.goal, body: item.body };
  }
  writeFileSync(out, JSON.stringify(map, null, 1) + '\n');
  return { saved: ok, mapped: Object.keys(map).length };
}

function topicProject(root, key, n) {
  const dir = join(root, String(n), nameOf(key));
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remoteOf(key)]);
  writeFileSync(join(dir, 'README.md'), `# ${nameOf(key)}\n`);
  return dir;
}

export function prompt(q) {
  return `check agent-ctx for what we decided about ${q.q} and tell me in one sentence`;
}

async function run(p, root) {
  const done = new Set(existsSync(p.ledger) ? readFileSync(p.ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).name) : []);
  let n = 0;
  for (const q of queries()) {
    n++;
    const name = `t${String(n).padStart(2, '0')}-${q.want[0]}`;
    if (done.has(name)) continue;
    const cwd = topicProject(root, q.project, n);
    const r = await runClaude(p, { name, side: 'A', cwd, prompts: [prompt(q)], tools: TOPIC_TOOLS, layout: 'tools', model: 'haiku' });
    console.log(`${r.row.n} ${name} ${r.row.cost.toFixed(5)}`);
  }
}

export function analyseTopics(file, q, map) {
  const calls = [];
  const results = new Map();
  let final = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'tool_use' && c.name === RECALL) calls.push({ id: c.id, input: c.input ?? {} });
    if (e.type === 'user') for (const c of e.message?.content ?? []) if (c.type === 'tool_result') results.set(c.tool_use_id, (Array.isArray(c.content) ? c.content.map((x) => x.text ?? '').join('') : String(c.content ?? '')));
    if (e.type === 'result') final = String(e.result ?? '');
  }
  const wanted = q.want.map((w) => map[w]).filter(Boolean);
  const shorts = wanted.map((w) => w.id.slice(0, 8));
  const withQuery = calls.filter((c) => typeof c.input.query === 'string' && c.input.query.trim());
  const first = withQuery[0];
  const firstText = first ? results.get(first.id) ?? '' : '';
  const topicList = /TOPICS/.test(firstText);
  const hits = !topicList && /EARLIER|HANDOFF/.test(firstText);
  const idCalls = calls.filter((c) => Array.isArray(c.input.ids) && c.input.ids.length);
  const askedRight = idCalls.some((c) => c.input.ids.some((id) => shorts.some((s) => String(id).startsWith(s.slice(0, 8)) || s.startsWith(String(id)))));
  const marker = (b) => b.decisions?.[0]?.what ?? b.changed?.[0]?.path ?? b.commands?.[0] ?? String(b.last ?? '').slice(0, 40);
  const fullBlock = (text) => wanted.some((w) => text.includes(marker(w.body)));
  const readRight = idCalls.some((c) => fullBlock(results.get(c.id) ?? '')) || (hits && fullBlock(firstText));
  const chars = calls.reduce((n, c) => n + JSON.stringify(c.input).length + (results.get(c.id) ?? '').length, 0);
  return {
    recallWithQuery: !!first,
    query: first?.input.query ?? null,
    topicList,
    hits,
    gotListOrHits: topicList || hits,
    wantedInList: shorts.some((s) => firstText.includes(s)),
    recallWithIds: idCalls.length > 0,
    idsAsked: idCalls.flatMap((c) => c.input.ids),
    askedRight,
    readRight,
    recallCalls: calls.length,
    recallChars: chars,
    recallTokensEstimate: Math.round(chars / 4),
    final,
  };
}

export function countTopics(proofs, mapFile) {
  const map = JSON.parse(readFileSync(mapFile, 'utf8'));
  const qs = queries();
  const rows = qs.map((q, i) => {
    const name = `t${String(i + 1).padStart(2, '0')}-${q.want[0]}`;
    const file = join(proofs, `${name}.jsonl`);
    if (!existsSync(file)) return null;
    return { name, query: q.q, want: q.want, facts: q.want.map((w) => map[w]?.body), ...analyseTopics(file, q, map) };
  }).filter(Boolean);
  return {
    runs: rows.length,
    recallWithQuery: rows.filter((r) => r.recallWithQuery).length,
    gotListOrHits: rows.filter((r) => r.gotListOrHits).length,
    recallWithIds: rows.filter((r) => r.recallWithIds).length,
    readRight: rows.filter((r) => r.readRight).length,
    rows,
  };
}

const LATENCY_OWN = /^mcp__plugin_agent-ctx_agent-ctx__/;

async function query(sql) {
  const r = await fetch(`${ORIGIN}/cdn-cgi/local/explorer/api/local/observability/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) });
  const j = await r.json();
  if (!j.success) throw new Error(`The trace query failed. ${JSON.stringify(j.errors)}`);
  const cols = j.result.columns;
  return j.result.rows.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const at = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, at)];
}

function transcript(proofs, name) {
  const file = join(proofs, `${name}.jsonl`);
  const out = { own: 0, hooks: 0, errors: [] };
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'tool_use' && LATENCY_OWN.test(c.name)) out.own++;
    if (e.type === 'system' && e.subtype === 'hook_response' && e.outcome !== 'success') out.errors.push(`${e.hook_name} ${String(e.stderr || e.output || '').slice(0, 120)}`);
  }
  const debug = join(proofs, `${name}.debug.log`);
  if (existsSync(debug)) out.hooks = readFileSync(debug, 'utf8').split('\n').filter((l) => l.includes('Hooks: mcp_tool calling')).length;
  return out;
}

export async function latency(proofs) {
  const runs = readFileSync(join(proofs, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.side !== 'none');
  const per = [];
  const clean = [];
  for (const r of runs) {
    const spans = await query(
      `SELECT s.trace_id AS trace, s.duration_ms AS ms, s.outcome AS outcome, json_extract(s.attributes, '$."http.response.status_code"') AS status, (SELECT COUNT(*) FROM spans c WHERE c.trace_id = s.trace_id AND c.name = 'durable_object_subrequest') AS dobj FROM spans s WHERE s.parent_id IS NULL AND s.name = 'POST' AND json_extract(s.attributes, '$."url.full"') = '${ORIGIN}/mcp' AND s.start_ms BETWEEN ${r.start} AND ${r.end + 2000} ORDER BY s.start_ms`,
    );
    const calls = spans.filter((s) => s.dobj > 0);
    const t = transcript(proofs, r.name);
    const bad = spans.filter((s) => s.outcome !== 'ok' || Number(s.status) >= 400).length;
    const row = { name: r.name, posts: spans.length, toolCalls: calls.length, modelCalls: t.own, hookCallsSeenByClient: t.hooks, serverErrors: bad, clientHookErrors: t.errors };
    per.push(row);
    if (t.own === 0 && calls.length === t.hooks) clean.push(...calls.map((s) => s.ms));
  }
  const sorted = [...clean].sort((a, b) => a - b);
  return {
    note: 'A hook call is a POST to /mcp whose trace reaches the person object. Latency uses only runs where the model called no agent-ctx tool and the count of such posts equals the hook calls in the client debug log.',
    hookCalls: sorted.length,
    medianMs: pct(sorted, 50),
    p95Ms: pct(sorted, 95),
    maxMs: sorted.at(-1) ?? null,
    serverErrors: per.reduce((n, r) => n + r.serverErrors, 0),
    clientHookErrors: per.reduce((n, r) => n + r.clientHookErrors.length, 0),
    runs: per,
  };
}

export async function space(secretsFile) {
  const s = JSON.parse(readFileSync(secretsFile, 'utf8'));
  const r = await page(jarFrom(s.cookie), 'GET', '/space');
  if (r.status !== 200) throw new Error(`The space gave ${r.status}.`);
  return r.json;
}

export function brief(item) {
  return {
    id: item.id,
    kind: item.kind,
    project: item.project,
    agent: item.origin?.agent,
    via: item.origin?.via,
    source: item.origin?.source,
    session: item.origin?.session ? String(item.origin.session).slice(0, 12) : undefined,
    flags: item.flags?.length ? item.flags : undefined,
    held: item.held || undefined,
    body: item.body,
  };
}

async function claudeCommand(argv) {
  const [name, side, cwd, ...rest] = argv;
  const tmp = process.env.E2E_TMP;
  const proofs = process.env.E2E_PROOFS;
  const flag = (f) => {
    const i = rest.indexOf(f);
    if (i < 0) return undefined;
    const v = rest[i + 1];
    rest.splice(i, 2);
    return v;
  };
  const tools = (flag('--tools') ?? '').split(',').filter(Boolean);
  const layout = flag('--layout') ?? 'scoped';
  const model = flag('--model') ?? 'haiku';
  const prompts = rest;
  if (!name || !['A', 'B', 'none'].includes(side) || !cwd || !prompts.length || !tmp || !proofs) {
    console.log('Set E2E_TMP and E2E_PROOFS, then give a name, a side of A, B or none, a project folder and one or more prompts, with --tools LIST to allow tools, --layout scoped, settings or tools, and --model NAME.');
    process.exit(name ? 1 : 0);
  }
  const p = paths(tmp, proofs);
  const r = await runClaude(p, { name, side, cwd, prompts, tools, layout, model });
  console.log(JSON.stringify(r.row, null, 1));
  console.log(JSON.stringify(summary(r.events), null, 1).slice(0, 6000));
  if (r.stderr.trim()) console.log('stderr', r.stderr.slice(0, 1500));
}

async function skipCommand(argv) {
  const [cmd, ...rest] = argv;
  const tmp = process.env.E2E_TMP;
  const proofs = process.env.E2E_PROOFS;
  if (!['tasks', 'rules', 'countSkip'].includes(cmd) || !proofs || (cmd !== 'countSkip' && !tmp)) {
    console.log('Set E2E_PROOFS, and E2E_TMP to run, with E2E_PROJECTS for a projects folder outside any session scratchpad, then give tasks or rules with an optional model, a countSkip and a condition letter, where B adds an AGENTS.md line, or countSkip to tally the transcripts.');
    process.exit(cmd ? 1 : 0);
  }
  if (cmd === 'countSkip') {
    const c = countSkip(proofs);
    writeFileSync(join(proofs, 'counts.json'), JSON.stringify(c, null, 1) + '\n');
    for (const t of c.totals) console.log(JSON.stringify(t));
  } else {
    const model = rest[0] ?? 'haiku';
    const only = rest[1] ? Number(rest[1]) : undefined;
    try {
      await runSet(paths(tmp, proofs), cmd === 'tasks' ? TASKS : RULES, model, only, rest[2] ?? '');
    } catch (e) {
      console.log(e instanceof Error ? e.message : String(e));
    }
    console.log(`Spent ${spentSoFar(join(proofs, 'runs.jsonl')).toFixed(5)} dollars in this folder.`);
  }
}

async function topicsCommand(argv) {
  const [cmd] = argv;
  const tmp = process.env.E2E_TMP;
  const proofs = process.env.E2E_PROOFS;
  const root = process.env.E2E_PROJECTS;
  if (!['seed', 'run', 'countTopics', 'list'].includes(cmd) || !proofs || (cmd !== 'list' && cmd !== 'countTopics' && !tmp) || (cmd === 'run' && !root)) {
    console.log('Set E2E_PROOFS, E2E_TMP and E2E_PROJECTS, then give list, seed, run or countTopics.');
    process.exit(cmd ? 1 : 0);
  }
  const mapFile = join(proofs, 'seeded-cards.json');
  if (cmd === 'list') for (const q of queries()) console.log(`${q.want.join(',')} | ${prompt(q)}`);
  if (cmd === 'seed') console.log(JSON.stringify(await seed(join(tmp, 'secrets.json'), mapFile)));
  if (cmd === 'run') {
    try {
      await run(paths(tmp, proofs), root);
    } catch (e) {
      console.log(e instanceof Error ? e.message : String(e));
    }
    console.log(`Spent ${spentSoFar(join(proofs, 'runs.jsonl')).toFixed(5)} dollars in this folder.`);
  }
  if (cmd === 'countTopics') {
    const c = countTopics(proofs, mapFile);
    writeFileSync(join(proofs, 'counts.json'), JSON.stringify(c, null, 1) + '\n');
    console.log(JSON.stringify({ ...c, rows: undefined }));
    for (const r of c.rows) console.log(JSON.stringify({ name: r.name, q: r.query, topicList: r.topicList, hits: r.hits, wantedInList: r.wantedInList, ids: r.idsAsked, askedRight: r.askedRight, readRight: r.readRight, calls: r.recallCalls, tokens: r.recallTokensEstimate, final: r.final.slice(0, 220) }));
  }
}

async function latencyCommand(argv) {
  const proofs = argv[0];
  if (!proofs) {
    console.log('Give the proofs folder that holds runs.jsonl, as in node service/e2e/agents.mjs latency proofs/continue-1');
    process.exit(0);
  }
  const out = await latency(proofs);
  writeFileSync(join(proofs, 'latency.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ ...out, runs: undefined }, null, 1));
  for (const r of out.runs) console.log(JSON.stringify(r));
}

async function spaceCommand(argv) {
  const file = argv[0];
  if (!file) {
    console.log('Give the secrets file, as in node service/e2e/agents.mjs space /tmp/run/secrets.json');
    process.exit(0);
  }
  const sp = await space(file);
  console.log(JSON.stringify({ projects: sp.projects, agents: sp.agents.map((a) => a.label), queue: sp.queue, reads: sp.reads, items: sp.items.map(brief) }, null, 1));
}

const COMMANDS = { claude: claudeCommand, skip: skipCommand, topics: topicsCommand, latency: latencyCommand, space: spaceCommand };

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (main) {
  const [sub, ...rest] = process.argv.slice(2);
  if (!Object.hasOwn(COMMANDS, sub)) {
    console.log('Give claude, skip, topics, latency or space, then the arguments of that command, as in node service/e2e/agents.mjs space /tmp/run/secrets.json');
    process.exit(sub ? 1 : 0);
  }
  await COMMANDS[sub](rest);
}
