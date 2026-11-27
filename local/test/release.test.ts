import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test as plainTest } from 'node:test';
import { BANNED, ROOT, tree } from './kit.ts';

const TMP = mkdtempSync(join(tmpdir(), 'agent-ctx-release-'));
const SCRIPT = join(ROOT, 'local', 'install.sh');
const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'];
const MINE = `agent-ctx-${process.platform}-${process.arch}`;
const SHELLS = ['/bin/sh', '/bin/dash'].filter((shell) => existsSync(shell));
const stand = (label: string): string => `#!/bin/sh\necho "$0 $*" >> "$STUB_LOG"\necho The stand in ${label} ran.\n`;
const sum = (body: string): string => createHash('sha256').update(body).digest('hex');
const sums = (hash: string): string => TARGETS.map((target) => `${hash}  agent-ctx-${target}\n`).join('');
const PAGES: Record<string, Record<string, string>> = {
  good: { program: stand('one'), list: sums(sum(stand('one'))) },
  next: { program: stand('two'), list: sums(sum(stand('two'))) },
  wrong: { program: stand('two'), list: sums(sum(stand('one'))) },
  bare: { program: stand('one'), list: `${sum(stand('one'))}  agent-ctx-plan9-mips\n` },
  cut: { program: stand('one') },
  gone: {},
};
const NOTHING = 'so nothing was installed.';

interface Place { root: string; HOME: string; AGENT_CTX_HOME: string; TMPDIR: string; log: string }
interface Ran { code: number | null; out: string; err: string }

const asked: string[] = [];
const web = createServer((req, res) => {
  asked.push(req.url ?? '');
  const [, page, name] = (req.url ?? '').split('/');
  const body = PAGES[page]?.[name === 'SHA256SUMS' ? 'list' : TARGETS.some((target) => name === `agent-ctx-${target}`) ? 'program' : ''];
  res.writeHead(body === undefined ? 404 : 200).end(body ?? '');
});
let base = '';
let places = 0;

before(async () => {
  await new Promise<void>((done) => web.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
});

after(() => {
  web.close();
  rmSync(TMP, { recursive: true, force: true });
});

function test(name: string, fn: () => void | Promise<void>): void {
  void plainTest(name, { timeout: 120000 }, fn);
}

function place(): Place {
  const root = join(TMP, `place-${++places}`);
  const where = { root, HOME: join(root, 'home'), AGENT_CTX_HOME: join(root, 'memory'), TMPDIR: join(root, 'tmp'), log: join(root, 'program.log') };
  for (const dir of [where.HOME, where.TMPDIR]) mkdirSync(dir, { recursive: true });
  return where;
}

function install(page: string, where: Place, shell = '/bin/sh', more: Record<string, string> = {}): Promise<Ran> {
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: where.HOME, AGENT_CTX_HOME: where.AGENT_CTX_HOME, TMPDIR: where.TMPDIR, STUB_LOG: where.log, AGENT_CTX_RELEASES: `${base}/${page}`, ...more };
  return new Promise((done) => {
    const child = spawn(shell, [SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('close', (code) => done({ code, out, err }));
  });
}

const placed = (where: Place): string => join(where.AGENT_CTX_HOME, 'app', 'agent-ctx');
const mode = (file: string): number => statSync(file).mode & 0o777;
const runs = (where: Place): string[] => (existsSync(where.log) ? readFileSync(where.log, 'utf8').trim().split('\n') : []);

test('the install script places the program for this computer after a good hash and a second run changes nothing', async () => {
  for (const shell of SHELLS) {
    const where = place();
    asked.length = 0;
    const first = await install('good', where, shell);
    assert.deepEqual(first, { code: 0, out: 'The stand in one ran.\n', err: '' }, shell);
    assert.deepEqual(asked, [`/good/${MINE}`, '/good/SHA256SUMS']);
    assert.equal(readFileSync(placed(where), 'utf8'), stand('one'));
    assert.deepEqual([mode(placed(where)), mode(join(where.AGENT_CTX_HOME, 'app')), mode(where.AGENT_CTX_HOME)], [0o755, 0o700, 0o700]);
    assert.deepEqual(runs(where), [`${placed(where)} install --yes`]);
    assert.deepEqual([readdirSync(where.TMPDIR), readdirSync(join(where.AGENT_CTX_HOME, 'app'))], [[], ['agent-ctx']]);
    const once = [tree(where.HOME), tree(where.AGENT_CTX_HOME), statSync(placed(where)).ino, statSync(placed(where)).mtimeMs];
    const second = await install('good', where, shell);
    assert.deepEqual(second, first);
    assert.deepEqual([tree(where.HOME), tree(where.AGENT_CTX_HOME), statSync(placed(where)).ino, statSync(placed(where)).mtimeMs], once);
    assert.equal(runs(where).length, 2);
    assert.equal((await install('next', where, shell)).out, 'The stand in two ran.\n');
    assert.deepEqual([readFileSync(placed(where), 'utf8'), mode(placed(where)), readdirSync(join(where.AGENT_CTX_HOME, 'app')), readdirSync(where.TMPDIR)], [stand('two'), 0o755, ['agent-ctx'], []]);
  }
});

test('a wrong hash, an unknown system, a failed download and a missing curl each end with one plain line and nothing written', async () => {
  const fake = (root: string, system: string, processor: string): string => {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'uname'), `#!/bin/sh\nif [ "$1" = -m ]; then echo ${processor}; else echo ${system}; fi\n`);
    chmodSync(join(bin, 'uname'), 0o755);
    return `${bin}:/usr/bin:/bin`;
  };
  const rows: [string, string, (where: Place) => Record<string, string>, string][] = [
    ['wrong hash', 'wrong', () => ({}), `The SHA-256 of the download is not the published SHA-256, ${NOTHING}`],
    ['no line for the program', 'bare', () => ({}), `The SHA-256 of the download is not the published SHA-256, ${NOTHING}`],
    ['unknown system', 'good', (where) => ({ PATH: fake(where.root, 'Plan9', 'x86_64') }), `No agent-ctx program exists for Plan9, ${NOTHING}`],
    ['unknown processor', 'good', (where) => ({ PATH: fake(where.root, 'Linux', 'mips') }), `No agent-ctx program exists for the processor mips, ${NOTHING}`],
    ['no program', 'gone', () => ({}), `The download of ${base}/gone/${MINE} failed, ${NOTHING}`],
    ['no list', 'cut', () => ({}), `The download of ${base}/cut/SHA256SUMS failed, ${NOTHING}`],
    ['no curl', 'good', (where) => ({ PATH: where.TMPDIR }), `The program curl is missing on this computer, ${NOTHING}`],
  ];
  for (const shell of SHELLS) {
    for (const [name, page, more, line] of rows) {
      const where = place();
      const r = await install(page, where, shell, more(where));
      assert.deepEqual(r, { code: 1, out: '', err: `${line}\n` }, `${name} with ${shell}`);
      assert.deepEqual([existsSync(where.AGENT_CTX_HOME), readdirSync(where.TMPDIR), tree(where.HOME), runs(where)], [false, [], {}, []], name);
      assert.equal(BANNED.exec(line.replace(/http\S+/, 'ADDRESS')), null, line);
    }
    const where = place();
    assert.equal((await install('good', where, shell)).code, 0);
    const once = [tree(where.AGENT_CTX_HOME), statSync(placed(where)).ino];
    assert.equal((await install('wrong', where, shell)).code, 1);
    assert.deepEqual([tree(where.AGENT_CTX_HOME), statSync(placed(where)).ino, runs(where).length, readdirSync(where.TMPDIR)], [...once, 1, []]);
  }
});

test('the release workflow builds four programs on native runners with one pinned Bun and names every release file', () => {
  const text = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  const pairs = [...text.matchAll(/- runner: (\S+)\n\s+target: (\S+)/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(pairs, ['macos-15 darwin-arm64', 'macos-15-intel darwin-x64', 'ubuntu-24.04 linux-x64', 'ubuntu-24.04-arm linux-arm64']);
  assert.deepEqual(pairs.map((pair) => pair.split(' ')[1]), TARGETS);
  assert.deepEqual(text.match(/bun-version: .*/g), ['bun-version: 1.4.5']);
  assert.deepEqual(text.match(/bun build .*/g), ['bun build --compile --bytecode --format=esm --no-compile-autoload-dotenv --no-compile-autoload-bunfig agent-ctx.mjs --outfile "$PROGRAM"']);
  assert.match(text, /tags:\n\s+- 'v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'\n\s+workflow_dispatch:/);
  assert.match(text, /echo "PROGRAM=\$RUNNER_TEMP\/out\/agent-ctx-\$TARGET" >> "\$GITHUB_ENV"/);
  assert.match(text, /working-directory: \$\{\{ runner\.temp \}\}\/compile\n\s+run: bun build /);
  for (const part of ['npm run build', 'git status --porcelain -- plugins/claude-code/scripts', 'codesign --force --sign - "$PROGRAM"', '"$PROGRAM" --version', '"$PROGRAM" status', '"$PROGRAM" hook --agent claude-code', '"$PROGRAM" mcp --agent release', 'out/agent-ctx.mcpb', 'npm run pack', 'cp web/dist-local/agent-ctx-page.tgz out/agent-ctx-page.tgz', 'out/install.sh', 'sha256sum -- agent-ctx* install.sh', 'SHA256SUMS', '--verify-tag']) {
    assert.equal(text.includes(part), true, part);
  }
  assert.equal(/windows|macos-latest|ubuntu-latest|larger|self-hosted/i.test(text), false);
  assert.deepEqual(text.match(/contents: \w+/g), ['contents: read', 'contents: write']);
  const said = [...text.matchAll(/(?:echo "|console\.log\(')([A-Z][^"\n]*?\.)["']/g)].map((m) => m[1]);
  assert.match(text, /working-directory: \$\{\{ runner\.temp \}\}\/planted\n\s+run: \|\n\s+export HOME="\$RUNNER_TEMP\/smoke\/home"\n.*hook --agent claude-code\n\s+if \[ -e ran\.txt \] \|\| \[ -e memory \] /);
  assert.equal(said.length, 7, said.join('\n'));
  for (const line of said) assert.equal(BANNED.exec(line.replace(/' \+ [\w.]+ \+ '/g, 'N')), null, line);
});

test('the pages workflow publishes the install script and the README names the curl line before the npx line', () => {
  const pages = readFileSync(join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(pages, /paths:\n(\s+- \S+\n)*\s+- local\/install\.sh\n/);
  assert.match(pages, /npm run build:site\n\s+working-directory: web\n\s+env:\n\s+VITE_RELEASED: "1"\n\s+- run: cp local\/install\.sh web\/dist-site\/install\.sh\n\s+- uses: actions\/upload-pages-artifact/);
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const curl = readme.search(/\n {4}curl -fsSL https:\/\/\S+\/agent-ctx\/install\.sh \| sh\n/);
  const npx = readme.search(/\n {4}npx -y github:\S+\/agent-ctx\n/);
  assert.ok(curl > 0 && npx > curl, `${curl} ${npx}`);
  assert.equal(readme.includes('coordinator'), false);
  assert.equal(/(^|\n) {4}agent-ctx /.test(readme), false);
  const script = readFileSync(SCRIPT, 'utf8');
  assert.equal(script.startsWith('#!/bin/sh\nset -eu\n'), true);
  assert.equal(mode(SCRIPT), 0o755);
});
