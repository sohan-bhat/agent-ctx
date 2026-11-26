import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALL_CHARS, FIRST_CHARS, FOLD_AT, ITEM_BYTES, RESULT_CHARS, RULES_AUTO_PER_DAY, RULES_SHOWN, RULE_MAX, RULE_MIN, RULE_PROMPT_MAX, STORE_BYTES, bytes, clean, cleanRemote, cut, fit, folderName, itemBytes, itemText, newItem, projectName, resolveProject, type CardBody, type HandoffBody, type Item, type Known, type Origin, type RuleBody } from '../src/model.ts';
import { DROPPED, redact } from '../src/redact.ts';
import { PENDING, decideRule, readRule, ruleLine } from '../src/model.ts';
import * as core from '../src/index.ts';

const at = Date.parse('2026-11-10T09:00:00Z');
const origin: Origin = { agent: 'codex', model: 'm-1', machine: 'desk', session: 's-1', via: 'tool', source: 'agent', at };
const snow = String.fromCodePoint(0x2603);
const grin = String.fromCodePoint(0x1f600);
const han = String.fromCodePoint(0x6f22);

function card(body: CardBody): Item {
  return newItem('card', 'github.com/acme/kiln', body, origin);
}

test('newItem fills the defaults and takes the time from the origin', () => {
  const a = card({ goal: 'Add the glaze table' });
  const b = card({ goal: 'Add the glaze table' });
  assert.notEqual(a.id, b.id);
  assert.equal(a.created, at);
  assert.deepEqual([a.held, a.pinned, a.folded, a.flags], [false, false, false, []]);
  assert.equal(a.kind, 'card');
  assert.equal(a.project, 'github.com/acme/kiln');
});

test('itemText joins every string of the body and skips numbers and flags', () => {
  const i = card({
    goal: 'Speed up the firing curve',
    changed: [{ path: 'src/curve.ts', what: 'new spline' }],
    decisions: [{ what: 'cubic spline', why: 'smooth ramps' }],
    commands: ['npm test'],
    auto: true,
  });
  assert.equal(itemText(i), 'Speed up the firing curve\nsrc/curve.ts\nnew spline\ncubic spline\nsmooth ramps\nnpm test');
  const d = newItem('dropped', 'p', { label: 'file', text: 'src/a.ts', size: 8 }, origin);
  assert.equal(itemText(d), 'file\nsrc/a.ts');
});

test('itemBytes is the UTF-8 size of the body JSON', () => {
  const i = card({ goal: `${snow}${grin}` });
  assert.equal(itemBytes(i), bytes(JSON.stringify(i.body)));
  assert.equal(itemBytes(i), '{"goal":""}'.length + 3 + 4);
});

test('fit returns an item under the cap untouched', () => {
  const i = card({ goal: 'Small card', open: ['one task'] });
  assert.equal(fit(i), i);
});

test('a card of 20 KB comes back at 2048 bytes or less with the goal present', () => {
  const big = card({
    goal: 'Rebuild the kiln controller loop so the ramp holds within two degrees',
    prompts: Array.from({ length: 40 }, (_, k) => `prompt ${k} `.repeat(40)),
    commands: Array.from({ length: 20 }, (_, k) => `npm run step-${k}`),
    changed: Array.from({ length: 40 }, (_, k) => ({ path: `src/loop/part-${k}.ts`, what: 'tuned' })),
    decisions: Array.from({ length: 20 }, (_, k) => ({ what: `choice ${k} `.repeat(10), why: 'reason '.repeat(10) })),
    dead_ends: Array.from({ length: 10 }, (_, k) => `dead end ${k} `.repeat(10)),
    open: Array.from({ length: 10 }, (_, k) => `open ${k} `.repeat(10)),
    last: 'The loop now holds the ramp. '.repeat(20),
  });
  assert.ok(itemBytes(big) > 20000);
  const f = fit(big);
  assert.ok(itemBytes(f) <= ITEM_BYTES, String(itemBytes(f)));
  assert.equal((f.body as CardBody).goal, 'Rebuild the kiln controller loop so the ramp holds within two degrees');
  assert.equal((big.body as CardBody).prompts?.length, 40);
});

test('a body of multi byte characters also fits', () => {
  const wide = card({
    goal: `${han}`.repeat(400),
    prompts: Array.from({ length: 10 }, () => `${grin}${snow}`.repeat(80)),
    last: `${grin}`.repeat(500),
  });
  assert.ok(itemBytes(wide) > ITEM_BYTES);
  const f = fit(wide);
  assert.ok(itemBytes(f) <= ITEM_BYTES);
  assert.ok((f.body as CardBody).goal.length > 0);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(JSON.stringify(f.body)));
});

test('a card loses the oldest prompts first, then commands, then the oldest changes', () => {
  const body: CardBody = {
    goal: 'g',
    prompts: ['p-old '.repeat(60), 'p-new '.repeat(60)],
    commands: ['c-old '.repeat(40), 'c-new '.repeat(40)],
    changed: [{ path: 'x-old/'.repeat(30) }, { path: 'x-new/'.repeat(30) }],
  };
  const i = card(body);
  const full = itemBytes(i);
  const one = fit(i, full - 10).body as CardBody;
  assert.deepEqual(one.prompts, ['p-new '.repeat(60)]);
  assert.equal(one.commands?.length, 2);
  const two = fit(i, full - 900).body as CardBody;
  assert.equal(two.prompts, undefined);
  assert.deepEqual(two.commands, ['c-new '.repeat(40)]);
  assert.equal(two.changed?.length, 2);
  const three = fit(i, full - 1250).body as CardBody;
  assert.equal(three.commands, undefined);
  assert.deepEqual(three.changed, [{ path: 'x-new/'.repeat(30) }]);
});

test('a card cuts last before losing dead ends, open tasks and decisions', () => {
  const i = card({ goal: 'g', last: 'word '.repeat(200), dead_ends: ['d'], open: ['o'], decisions: [{ what: 'w' }] });
  const f = fit(i, itemBytes(i) - 300).body as CardBody;
  assert.ok((f.last ?? '').length < 1000);
  assert.deepEqual([f.dead_ends, f.open, f.decisions], [['d'], ['o'], [{ what: 'w' }]]);
});

test('a handoff loses files, then blockers, then cuts done before next', () => {
  const body: HandoffBody = {
    goal: 'Ship the glaze picker',
    done: 'done '.repeat(100),
    next: 'Wire the picker into the order form',
    blockers: ['waiting on the color list'],
    files: Array.from({ length: 30 }, (_, k) => `src/picker/file-${k}.ts`),
  };
  const i = newItem('handoff', 'p', body, origin);
  const a = fit(i, itemBytes(i) - 100).body as HandoffBody;
  assert.ok(a.files && a.files.length < 30 && a.files[a.files.length - 1] === 'src/picker/file-29.ts');
  assert.deepEqual(a.blockers, ['waiting on the color list']);
  const b = fit(i, 450).body as HandoffBody;
  assert.equal(b.files, undefined);
  assert.equal(b.blockers, undefined);
  assert.ok((b.done ?? '').length < 500);
  assert.equal(b.next, 'Wire the picker into the order form');
  assert.equal(b.goal, 'Ship the glaze picker');
});

test('a handoff trims question only after check and keeps next', () => {
  const body: HandoffBody = { goal: 'Ship the glaze picker', next: 'Wire the picker into the order form', check: 'check '.repeat(100), question: 'question '.repeat(100) };
  const i = newItem('handoff', 'p', body, origin);
  const full = itemBytes(i);
  const a = fit(i, full - 300).body as HandoffBody;
  assert.ok((a.check ?? '').length < 600);
  assert.equal(a.question, body.question);
  const b = fit(i, full - 700).body as HandoffBody;
  assert.ok((b.check ?? '').length <= 120);
  assert.ok((b.question ?? '').length < 900 && (b.question ?? '').length >= 100);
  assert.equal(b.next, body.next);
  assert.equal(b.goal, body.goal);
});

test('a 20 KB handoff fits and keeps next', () => {
  const i = newItem('handoff', 'p', { goal: 'goal '.repeat(800), next: 'next '.repeat(800), done: 'done '.repeat(800), check: 'check '.repeat(800) }, origin);
  const f = fit(i);
  assert.ok(itemBytes(f) <= ITEM_BYTES);
  assert.ok((f.body as HandoffBody).next.length > 0);
});

test('fit never throws and never returns an item over the cap', () => {
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const word = () => ['ramp', snow, grin, han, '"q"', '\\', 'path/to/x.ts'][rand(7)].repeat(1 + rand(40));
  for (let k = 0; k < 60; k++) {
    const list = (n: number) => Array.from({ length: rand(n) }, word);
    const kinds: Item[] = [
      card({ goal: word(), prompts: list(30), commands: list(30), changed: list(30).map((path) => ({ path })), dead_ends: list(20), open: list(20), decisions: list(20).map((what) => ({ what, why: word() })), last: word() }),
      newItem('handoff', 'p', { goal: word(), next: word(), done: word(), check: word(), question: word(), task: word(), blockers: list(20), files: list(40) }, origin),
      newItem('rule', 'p', { text: word().repeat(5), words: word().repeat(5), scope: 'all', status: 'active', proof: 'page' }, origin),
      newItem('dropped', 'p', { label: word(), text: word().repeat(20), size: 5 }, origin),
    ];
    for (const i of kinds) {
      const max = [ITEM_BYTES, 600, 300][rand(3)];
      const f = fit(i, max);
      assert.ok(itemBytes(f) <= max, `${i.kind} ${itemBytes(f)} over ${max}`);
    }
  }
  const odd = { ...card({ goal: 'x' }), body: { goal: 'y'.repeat(5000), extra: 'z'.repeat(5000) } as unknown as CardBody };
  assert.ok(itemBytes(fit(odd)) <= ITEM_BYTES);
});

test('the caps hold the values of the design', () => {
  assert.deepEqual(
    [ITEM_BYTES, RESULT_CHARS, CALL_CHARS, FIRST_CHARS, RULE_MIN, RULE_MAX, RULE_PROMPT_MAX, RULES_AUTO_PER_DAY, RULES_SHOWN, STORE_BYTES, FOLD_AT],
    [2048, 600, 2400, 3000, 12, 300, 800, 5, 10, 10485760, 0.8],
  );
});

test('cut leaves short text alone and never goes over the limit', () => {
  assert.equal(cut('short', 10), 'short');
  assert.equal(cut('exactly ten', 11), 'exactly ten');
  for (const n of [0, 1, 2, 5, 13, 40, 99]) {
    const s = cut('The station reports gusts every ten seconds now and the radio sleeps between them.', n);
    assert.ok(s.length <= n, `${n} ${s}`);
  }
});

test('cut ends at a word when one is near and marks the cut', () => {
  assert.equal(cut('alpha beta gamma delta', 13), 'alpha beta…');
  assert.equal(cut('abcdefghijklmnop', 8), 'abcdefg…');
});

test('cut never leaves half of a surrogate pair', () => {
  const grin = String.fromCodePoint(0x1f600);
  const s = cut(grin.repeat(10), 6);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s));
  assert.ok(s.length <= 6);
});

test('bytes is the UTF-8 length', () => {
  assert.equal(bytes(''), 0);
  assert.equal(bytes('abc'), 3);
  assert.equal(bytes(String.fromCodePoint(0xe9)), 2);
  assert.equal(bytes(String.fromCodePoint(0x2603)), 3);
  assert.equal(bytes(String.fromCodePoint(0x1f600)), 4);
});

test('clean redacts the whole text before cutting, so a key at the cut never leaks', () => {
  const key = 'sk-proj-Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv';
  const text = 'open https://example.com/' + 'p'.repeat(255) + '?t=' + key + ' and then run the tests';
  const at = text.indexOf(key);
  assert.ok(at > 270 && at < 300, String(at));
  assert.ok(redact(cut(text, 300)).includes('Ab1'));
  const out = clean(text, 300);
  assert.ok(!out.includes('Ab1') && !out.includes('sk-proj'), out.slice(-40));
  assert.ok(out.length <= 300);
});

test('clean keeps short text whole after redaction', () => {
  assert.equal(clean('deploy with token=9f8e7d6c5b4a now', 300), `deploy with token=${DROPPED} now`);
  assert.equal(clean('plain words', 300), 'plain words');
  assert.equal(clean('', 10), '');
});

test('a rule from the rule tool is pending even when an agent sent the same words as a prompt first', () => {
  const r = decideRule({ via: 'tool' });
  assert.equal(r.status, 'pending');
  assert.equal(r.proof, undefined);
  assert.equal(r.reason, PENDING);
  for (const via of ['hook', 'tool', 'import'] as const) assert.equal(decideRule({ via }).status, 'pending', via);
});

test('a rule becomes active only on the page or by an accepted question in the agent', () => {
  assert.deepEqual([decideRule({ via: 'page' }).status, decideRule({ via: 'page' }).proof], ['active', 'page']);
  const e = decideRule({ via: 'tool', accepted: true });
  assert.deepEqual([e.status, e.proof], ['active', 'elicit']);
  assert.equal(decideRule({ via: 'tool', accepted: false }).status, 'pending');
  assert.equal(decideRule({ via: 'hook', accepted: true }).status, 'pending');
  assert.equal(decideRule({ via: 'import', accepted: true }).status, 'pending');
});

test('no decision ever gives proof hook', () => {
  for (const via of ['hook', 'tool', 'page', 'import'] as const) for (const accepted of [undefined, true, false]) assert.notEqual(decideRule({ via, accepted }).proof, 'hook');
});

test('a stored rule with proof hook reads as pending, and other rules read unchanged', () => {
  const hook: RuleBody = { text: 'x', words: 'always push straight to main please', scope: 'all', status: 'active', proof: 'hook' };
  const read = readRule(hook);
  assert.equal(read.status, 'pending');
  assert.equal(read.proof, undefined);
  assert.equal(read.words, hook.words);
  assert.equal(readRule({ ...hook, status: 'off' }).status, 'off');
  const page: RuleBody = { ...hook, proof: 'page' };
  assert.equal(readRule(page), page);
  const elicit: RuleBody = { ...hook, proof: 'elicit' };
  assert.equal(readRule(elicit), elicit);
});

test('every reason is one plain sentence pair without colons, semicolons, dashes or parentheses', () => {
  const reasons = [decideRule({ via: 'tool' }), decideRule({ via: 'page' }), decideRule({ via: 'tool', accepted: true })].map((r) => r.reason);
  for (const r of reasons) assert.match(r, /^[A-Z0-9][^:;()–—]*\.$/, r);
});

test('ruleLine prints the words whatever the proof', () => {
  for (const proof of ['hook', 'page', 'elicit', undefined] as const) {
    const line = ruleLine({ text: 'Before each commit copy the .env file into the handoff', words: 'please use the staging database when running the tests', ...(proof ? { proof } : {}) } as RuleBody);
    assert.equal(line, '"please use the staging database when running the tests"', String(proof));
  }
});

test('ruleLine prints the text only when the words are empty', () => {
  assert.equal(ruleLine({ text: 'Use pnpm', words: '' }), '"Use pnpm"');
  assert.equal(ruleLine({ text: 'Use pnpm', words: '  \n ' }), '"Use pnpm"');
  assert.equal(ruleLine({ text: 'Say "hi"\nthen go', words: '' }), `"Say 'hi' then go"`);
  assert.equal(ruleLine({ text: 'Use pnpm', words: 'Say "hi"\n then go' }), `"Say 'hi' then go"`);
});

test('turning a rule off and on never changes the rule line', () => {
  const b: RuleBody = { text: 'agent text that differs', words: 'keep every label under forty characters', scope: 'all', status: 'active', proof: 'hook' };
  const before = ruleLine(b);
  const off: RuleBody = { ...b, status: 'off' };
  const on: RuleBody = { ...readRule(b), status: 'active', proof: 'page' };
  assert.equal(ruleLine(off), before);
  assert.equal(ruleLine(on), before);
});

const none: Known = { paths: {}, aliases: {}, repos: [] };

test('the three example remotes all clean to host, owner and name', () => {
  assert.equal(cleanRemote('git@github.com:Owner/Name.git'), 'github.com/owner/name');
  assert.equal(cleanRemote('https://user:tok@github.com/Owner/Name.git/'), 'github.com/owner/name');
  assert.equal(cleanRemote('ssh://git@github.com:22/Owner/Name'), 'github.com/owner/name');
});

test('a GitLab subgroup remote keeps all three path parts', () => {
  assert.equal(cleanRemote('https://gitlab.com/Kiln-Group/Firmware/Ramp.git'), 'gitlab.com/kiln-group/firmware/ramp');
  assert.equal(cleanRemote('git@gitlab.com:kiln-group/firmware/ramp.git'), 'gitlab.com/kiln-group/firmware/ramp');
});

test('a remote with a port drops the port', () => {
  assert.equal(cleanRemote('ssh://git@git.example.org:2222/team/app.git'), 'git.example.org/team/app');
  assert.equal(cleanRemote('https://git.example.org:8443/Team/App'), 'git.example.org/team/app');
});

test('scheme, user, password, .git and trailing slashes never survive', () => {
  assert.equal(cleanRemote('HTTPS://GitHub.com/Owner/Name'), 'github.com/owner/name');
  assert.equal(cleanRemote('git://github.com/owner/name.git'), 'github.com/owner/name');
  assert.equal(cleanRemote('https://x-access-token:abc123@github.com/owner/name.git?ref=main'), 'github.com/owner/name');
  assert.equal(cleanRemote('github.com/owner/name/'), 'github.com/owner/name');
});

test('empty input, local paths and strings with no host give null', () => {
  for (const s of ['', '   ', '/srv/git/name.git', './name', '../name', '~/code/name', 'C:\\code\\name', 'file:///srv/git/name.git', 'owner/name', 'name', 'https://github.com', 'folder:name']) {
    assert.equal(cleanRemote(s), null, s);
  }
});

test('folderName is the last segment of a posix or Windows path, lower case', () => {
  assert.equal(folderName('/home/dev/code/Weather-Station'), 'weather-station');
  assert.equal(folderName('/home/dev/code/app/'), 'app');
  assert.equal(folderName('C:\\Users\\dev\\Code\\RecipeBox'), 'recipebox');
  assert.equal(folderName('D:/work/Mixed\\Path'), 'path');
  assert.equal(folderName(''), '');
  assert.equal(folderName('C:\\'), '');
});

test('projectName gives the last segment of a repo key or the folder name', () => {
  assert.equal(projectName('github.com/owner/name'), 'name');
  assert.equal(projectName('gitlab.com/a/b/c'), 'c');
  assert.equal(projectName('folder:notes'), 'notes');
});

test('step one, a repo that cleans wins and teaches the path and the alias', () => {
  const known: Known = { paths: { '/w/app': 'github.com/x/other' }, aliases: { app: 'github.com/x/other' }, repos: ['github.com/x/other'] };
  assert.deepEqual(resolveProject({ repo: 'git@github.com:Acme/App.git', folder: '/w/App' }, known), {
    key: 'github.com/acme/app',
    learn: { path: '/w/App', alias: 'app' },
  });
  assert.deepEqual(resolveProject({ repo: 'git@github.com:Acme/App.git' }, known), { key: 'github.com/acme/app' });
});

test('step two, the exact folder path seen before', () => {
  const known: Known = { paths: { '/w/site': 'github.com/acme/recipes' }, aliases: { site: 'github.com/acme/other' }, repos: [] };
  assert.deepEqual(resolveProject({ folder: '/w/site' }, known), { key: 'github.com/acme/recipes' });
  assert.deepEqual(resolveProject({ repo: 'not a remote', folder: '/w/site' }, known), { key: 'github.com/acme/recipes' });
});

test('step three, a folder name tied to a repo', () => {
  const known: Known = { paths: {}, aliases: { site: 'github.com/acme/recipes' }, repos: ['github.com/zed/site'] };
  assert.deepEqual(resolveProject({ folder: '/elsewhere/Site' }, known), { key: 'github.com/acme/recipes' });
});

test('step four, a folder name equal to exactly one repo name', () => {
  const known: Known = { paths: {}, aliases: {}, repos: ['github.com/acme/recipes', 'github.com/acme/chess'] };
  assert.deepEqual(resolveProject({ folder: '/w/chess' }, known), { key: 'github.com/acme/chess' });
});

test('two known repos that share a last segment give a new folder project', () => {
  const known: Known = { paths: {}, aliases: {}, repos: ['github.com/acme/chess', 'gitlab.com/other/chess'] };
  assert.deepEqual(resolveProject({ folder: '/w/chess' }, known), { key: 'folder:chess' });
});

test('step five, a new project named after the folder, or unknown', () => {
  assert.deepEqual(resolveProject({ folder: '/w/Club-Signup' }, none), { key: 'folder:club-signup' });
  assert.deepEqual(resolveProject({}, none), { key: 'folder:unknown' });
  assert.deepEqual(resolveProject({ repo: '/local/path' }, none), { key: 'folder:unknown' });
});

test('keys that look like object members are not taken from the prototype', () => {
  assert.deepEqual(resolveProject({ folder: '/w/constructor' }, none), { key: 'folder:constructor' });
  assert.deepEqual(resolveProject({ folder: 'toString' }, none), { key: 'folder:tostring' });
});

test('the index exports every name the service needs', () => {
  const names = [
    'ITEM_BYTES', 'RESULT_CHARS', 'CALL_CHARS', 'FIRST_CHARS', 'RULE_MIN', 'RULE_MAX', 'RULE_PROMPT_MAX', 'RULES_AUTO_PER_DAY', 'RULES_SHOWN', 'STORE_BYTES', 'FOLD_AT', 'cut', 'bytes',
    'newItem', 'itemText', 'itemBytes', 'fit',
    'cleanRemote', 'folderName', 'resolveProject', 'projectName',
    'sanitize', 'sanitizeItem', 'stripPrivate', 'stripOwn',
    'eventKey', 'autoCard', 'autoHandoff', 'droppedAt',
    'decideRule', 'readRule', 'ruleLine', 'PENDING',
    'rankItems', 'recent', 'namedProjects',
    'recall', 'HEADER', 'FOOTER', 'EMPTY_RECALL',
    'quietPrompt', 'hookOutput',
    'totalBytes', 'foldCard', 'foldPlan', 'mergeFolded', 'applyPlan', 'underCeiling',
    'redact', 'hasSecret', 'DROPPED', 'tokens',
  ];
  const got = core as Record<string, unknown>;
  for (const name of names) assert.ok(name in got, name);
});

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('no file under core/src touches a Node or host API', () => {
  const list = files(SRC);
  assert.ok(list.length >= 9);
  for (const f of list) {
    const text = fs.readFileSync(f, 'utf8');
    for (const banned of ['node:', 'process.', 'Buffer']) assert.ok(!text.includes(banned), `${path.basename(f)} holds ${banned}`);
  }
});
