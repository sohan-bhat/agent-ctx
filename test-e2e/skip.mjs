import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths, runClaude, spentSoFar } from './claude.mjs';

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

function project(root, t) {
  const dir = join(root, t.name);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', `git@github.com:example-org/${t.name}.git`]);
  for (const [f, body] of Object.entries(t.files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  return dir;
}

const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const OWN = /^mcp__agent-ctx__(recall|checkpoint|handoff|rule)$/;

export function analyse(file) {
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
    sequence: calls.filter((c) => OWN.test(c.name) || isEdit(c)).map((c) => `${c.name.replace('mcp__agent-ctx__', '')}${errors.get(c.id) ? ' failed' : ''}`),
    recallBeforeEdit: recallAt >= 0 && (firstEdit < 0 || recallAt < firstEdit),
    checkpointAfterWork: checkpointAt >= 0 && checkpointAt > lastEdit,
    handoff: calls.some(own('handoff')),
    rule: calls.some(own('rule')),
  };
}

export function count(proofs) {
  const runs = readFileSync(join(proofs, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const stops = new Set(TASKS.filter((t) => t.stop).map((t) => t.name));
  const rows = runs.map((r) => {
    const base = r.name.replace(/^(haiku|sonnet)-/, '');
    return { name: r.name, model: r.model, group: RULES.some((t) => t.name === base) ? 'rule' : 'task', stop: stops.has(base), cost: r.cost, ...analyse(join(proofs, `${r.name}.jsonl`)) };
  });
  const tally = (model) => {
    const tasks = rows.filter((r) => r.model === model && r.group === 'task');
    const rules = rows.filter((r) => r.model === model && r.group === 'rule');
    const stopped = tasks.filter((r) => r.stop);
    return {
      model,
      tasks: tasks.length,
      recallBeforeEdit: tasks.filter((r) => r.recallBeforeEdit).length,
      checkpointAfterWork: tasks.filter((r) => r.checkpointAfterWork).length,
      stopTasks: stopped.length,
      handoffOnStop: stopped.filter((r) => r.handoff).length,
      ruleRuns: rules.length,
      ruleCalled: rules.filter((r) => r.rule).length,
      cost: Math.round(rows.filter((r) => r.model === model).reduce((n, r) => n + r.cost, 0) * 1e5) / 1e5,
    };
  };
  return { totals: [...new Set(rows.map((r) => r.model))].map(tally), rows };
}

async function runSet(p, set, model, only) {
  const done = new Set(existsSync(p.ledger) ? readFileSync(p.ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).name) : []);
  const root = join(p.tmp, 'projects', model);
  for (const t of set.slice(0, only ?? set.length)) {
    const name = `${model}-${t.name}`;
    if (done.has(name)) continue;
    const cwd = project(root, t);
    const prompt = t.ask + (t.stop ? STOP : '');
    const r = await runClaude(p, { name, side: 'A', cwd, prompts: [prompt], tools: TOOLS, layout: 'tools', model });
    const a = analyse(join(p.proofs, `${name}.jsonl`));
    console.log(`${r.row.n} ${name} ${r.row.cost.toFixed(5)} ${a.sequence.join(' > ') || 'no tool calls'}`);
  }
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const tmp = process.env.E2E_TMP;
  const proofs = process.env.E2E_PROOFS;
  if (!['tasks', 'rules', 'count'].includes(cmd) || !proofs || (cmd !== 'count' && !tmp)) {
    console.log('Set E2E_PROOFS, and E2E_TMP to run, then give tasks or rules with an optional model and a count, or count to tally the transcripts.');
    process.exit(cmd ? 1 : 0);
  }
  if (cmd === 'count') {
    const c = count(proofs);
    writeFileSync(join(proofs, 'counts.json'), JSON.stringify(c, null, 1) + '\n');
    for (const t of c.totals) console.log(JSON.stringify(t));
  } else {
    const model = rest[0] ?? 'haiku';
    const only = rest[1] ? Number(rest[1]) : undefined;
    try {
      await runSet(paths(tmp, proofs), cmd === 'tasks' ? TASKS : RULES, model, only);
    } catch (e) {
      console.log(e instanceof Error ? e.message : String(e));
    }
    console.log(`Spent ${spentSoFar(join(proofs, 'runs.jsonl')).toFixed(5)} dollars in this folder.`);
  }
}
