import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test as plainTest } from 'node:test';
import { toolList } from '../../service/src/mcp.ts';
import { plan, type Agent, type Paths } from '../src/install.ts';
import { BANNED, MAIN, ROOT, one, place, preload, run, server, type Ran } from './kit.ts';

type Form = 'curl' | 'npx';
type System = Paths['platform'];
interface Row { owner: string; files: string[]; cell: string }

const TMP = mkdtempSync(join(tmpdir(), 'agent-ctx-setup-'));
const NAMES: Record<Agent, string> = { 'claude-code': 'Claude Code', cursor: 'Cursor', codex: 'Codex', gemini: 'Gemini CLI', antigravity: 'Antigravity', grok: 'Grok Build', muse: 'Muse Code', 'claude-desktop': 'the Claude desktop app' };
const FORMS: Record<Form, string> = { curl: 'agent-ctx', npx: 'agent-ctx.mjs' };
const SYSTEMS: Record<System, string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };
const MEMORY = '~/.agent-ctx';
const SOURCES = ['local/install.sh', 'local/src/cli.ts', 'local/src/install.ts', 'local/src/sync.ts', 'local/src/page.ts', 'local/src/db.ts', 'service/src/mcp.ts', 'core/src/recall.ts'];
const OTHER_PROGRAMS = ['gh'];

after(() => rmSync(TMP, { recursive: true, force: true }));

function test(name: string, fn: () => void | Promise<void>): void {
  void plainTest(name, { timeout: 120000 }, fn);
}

const read = (path: string): string => readFileSync(join(ROOT, ...path.split('/')), 'utf8');
const guide = (): string => read('docs/setup.md');
const isBlock = (line: string): boolean => /^ {4,}\S/.test(line);
const spans = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
const blocks = (text: string): string[] => text.split('\n').filter(isBlock).map((line) => line.trim());
const prose = (text: string): string[] => text.split('\n').filter((line) => line.trim() && !isBlock(line));
const code = (text: string): string[] => [...blocks(text), ...spans(prose(text).join('\n'))];
const unique = (words: string[]): string[] => [...new Set(words)].sort();
const lead = (text: string): string => text.slice(0, 1).toUpperCase() + text.slice(1);

function section(text: string, title: string): string {
  const part = text.split(/^## /m).find((piece) => piece.startsWith(`${title}\n`));
  assert.ok(part, `no section named ${title}`);
  return part;
}

function table(text: string): Row[] {
  const lines = text.split('\n').filter((line) => line.startsWith('|'));
  assert.equal(lines.filter((line) => /^\|(-+\|)+$/.test(line)).length, 1, 'the document has one table');
  return lines.slice(2).map((line) => {
    const [, owner, files, cell] = line.split('|').map((part) => part.trim());
    return { owner, files: spans(files), cell };
  });
}

function fits(owner: string, name: string, form: Form, system: System): boolean {
  if (!owner.startsWith(lead(name))) return false;
  const rest = owner.slice(name.length);
  return rest === '' || rest === ` after the ${form} line` || rest === ` on ${SYSTEMS[system]}`;
}

function wanted(after: string): { keys: string[]; events: string[] } {
  if (after.startsWith('[')) return { keys: [after.split('\n')[0]], events: [] };
  const body = JSON.parse(after) as Record<string, Record<string, unknown> | number>;
  const hooks = body.hooks ?? body['agent-ctx'] ?? {};
  return { keys: Object.keys(body).filter((key) => key !== 'hooks'), events: Object.keys(hooks) };
}

test('the setup document has the install lines of the README, the version of package.json and the Node of the engines field', () => {
  const text = guide();
  const readme = read('README.md');
  const curl = /\n {4}(curl -fsSL \S+ \| sh)\n/.exec(readme)?.[1] ?? '';
  const npx = /\n {4}(npx -y github:\S+)\n/.exec(readme)?.[1] ?? '';
  assert.ok(curl && npx, 'the README has both install lines');
  assert.deepEqual(blocks(text).filter((line) => line.startsWith('curl ')), [curl]);
  assert.deepEqual(blocks(text).filter((line) => line.startsWith('npx ')), [npx]);
  for (const line of code(text).filter((line) => line.includes('npx '))) assert.ok(line.startsWith(npx), line);
  assert.ok(read('local/src/db.ts').includes(`'${npx}'`), npx);
  const pack = JSON.parse(read('package.json')) as { version: string; engines: { node: string } };
  const versions = [...text.matchAll(/agent-ctx (\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  const nodes = [...text.matchAll(/Node (\d+\.\d+)/g)].map((m) => m[1]);
  assert.ok(versions.length > 0 && nodes.length > 0, 'the document names a version and a Node');
  for (const version of versions) assert.equal(version, pack.version);
  for (const node of nodes) assert.equal(`>=${node}`, pack.engines.node);
});

test('the setup document names every tool that the server serves, no other tool and only real fields', () => {
  const text = guide();
  const tools = toolList() as { name: string; inputSchema: { properties?: Record<string, { enum?: string[] }> } }[];
  const served = tools.map((tool) => tool.name);
  const fields = tools.flatMap((tool) => Object.entries(tool.inputSchema.properties ?? {}).flatMap(([name, field]) => [name, ...(field.enum ?? [])]));
  const words = spans(section(text, 'After the setup')).filter((word) => /^[a-z_]+$/.test(word));
  assert.deepEqual(unique(words.filter((word) => served.includes(word))), unique(served));
  for (const word of words) assert.ok(served.includes(word) || fields.includes(word), `${word} is no tool and no field`);
  for (const [, word] of text.matchAll(/\bcall `([^`]+)`/gi)) assert.ok(served.includes(word), `${word} is no tool`);
});

test('the setup document names every agent that the program prints and every file, key, hook and command that the installer plans', () => {
  const text = guide();
  const where = place(TMP);
  const printed = /^Supported agents are (.+)\.$/m.exec(run(MAIN, ['install'], where).out)?.[1].split(/, | and /) ?? [];
  assert.deepEqual(printed, Object.values(NAMES));
  for (const name of printed) assert.ok(text.includes(name) || text.includes(lead(name)), name);
  const rows = table(text);
  const roaming = join(where.HOME, 'roaming');
  const shown = (path: string): string => (path.startsWith(roaming) ? `%APPDATA%${path.slice(roaming.length).replaceAll('/', '\\')}` : path.split(where.HOME).join('~'));
  const kept = process.env.APPDATA;
  process.env.APPDATA = roaming;
  try {
    for (const [agent, name] of Object.entries(NAMES) as [Agent, string][]) {
      for (const form of Object.keys(FORMS) as Form[]) {
        for (const platform of Object.keys(SYSTEMS) as System[]) {
          const label = `${name} after the ${form} line on ${SYSTEMS[platform]}`;
          const mine = rows.filter((row) => fits(row.owner, name, form, platform));
          const changes = plan(agent, { home: where.HOME, app: join(where.HOME, '.agent-ctx', 'app', FORMS[form]), node: form === 'npx' ? '/opt/node/bin/node' : '', platform });
          assert.deepEqual(mine.flatMap((row) => row.files), changes.filter((change) => change.file).map((change) => shown(change.file)), label);
          assert.deepEqual(mine.flatMap((row) => spans(row.cell).filter((span) => span.startsWith('claude '))), changes.flatMap((change) => (change.run ? [shown(change.run.join(' '))] : [])), label);
          for (const change of changes.filter((change) => change.file)) {
            const cell = mine.find((row) => row.files.includes(shown(change.file)))?.cell ?? '';
            const { keys, events } = wanted(change.after ?? '');
            for (const key of keys) assert.ok(spans(cell).some((span) => span.includes(key)), `${label} lacks ${key}`);
            assert.deepEqual(spans(/hooks for ((?:`\w+`(?:, | and )?)+)/.exec(cell)?.[1] ?? ''), events, label);
          }
        }
      }
    }
  } finally {
    if (kept === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = kept;
  }
  for (const row of rows.filter((row) => !/^The (program|memory)\b/.test(row.owner))) assert.ok(Object.values(NAMES).some((name) => row.owner.startsWith(lead(name))), row.owner);
});

test('the setup document names the program files, the status command, the mirror forms and the leftovers of a real run in both forms', async () => {
  const text = guide();
  const rows = table(text);
  const files = (owner: string): string[] => rows.filter((row) => row.owner === owner).flatMap((row) => row.files).sort();
  for (const form of Object.keys(FORMS) as Form[]) {
    const where = place(TMP);
    mkdirSync(join(where.HOME, '.cursor'));
    const go = (args: string[]): Ran => (form === 'npx' ? run(MAIN, args, where) : one(args, where));
    const shown = (line: string): string => line.split(where.AGENT_CTX_HOME).join(MEMORY).split(where.HOME).join('~');
    const said = (args: string[]): string[] => shown(go(args).out).trimEnd().split('\n');
    const status = /^Type (.+ status) to see what is connected\.$/.exec(said(['install', '--yes']).at(-1) ?? '')?.[1] ?? '';
    assert.ok(status && blocks(text).includes(status), `${form} ${status}`);
    assert.deepEqual(files(`The program after the ${form} line`), readdirSync(join(where.AGENT_CTX_HOME, 'app')).map((name) => `${MEMORY}/app/${name}`).sort());
    await server(where, 'cursor', [['recall', { folder: '/work/kiln' }]], form === 'npx' ? [] : preload(where));
    assert.deepEqual(files('The memory'), readdirSync(where.AGENT_CTX_HOME).filter((name) => name.endsWith('.db')).map((name) => `${MEMORY}/${name}`));
    const forms = [...(said(['mirror', 'on'])[0] ?? '').matchAll(/mirror (?:on [A-Za-z]+|off)/g)].map((m) => m[0]);
    assert.equal(forms.length, 4, forms.join());
    assert.deepEqual(unique(spans(text).filter((span) => /^mirror o/.test(span))), unique(forms));
    const gone = said(['uninstall', '--yes']);
    assert.ok(spans(text).includes(gone.at(-1)?.replace('To delete the memory, type ', '') ?? ''), gone.at(-1));
    assert.deepEqual([existsSync(join(where.AGENT_CTX_HOME, 'app')), existsSync(join(where.AGENT_CTX_HOME, 'memory.db'))], [false, true]);
  }
  assert.ok(read('local/src/db.ts').includes("process.env.AGENT_CTX_HOME || join(homedir(), '.agent-ctx')"));
  assert.ok(read('local/install.sh').includes('root="${AGENT_CTX_HOME:-$HOME/.agent-ctx}"'));
  const commands = unique([...read('local/src/cli.ts').matchAll(/command === '([a-z]+)'/g)].map((m) => m[1]));
  const inner = [...read('local/src/main.ts').matchAll(/args\[0\] === '([a-z]+)'/g)].map((m) => m[1]);
  const after = code(text).flatMap((line) => [...line.matchAll(/agent-ctx(?:\.mjs)? ([a-z]+)\b/g)].map((m) => m[1]));
  const bare = spans(section(text, 'Other commands')).filter((span) => /^[a-z]+( [A-Za-z]+)*$/.test(span) && !OTHER_PROGRAMS.includes(span)).map((span) => span.split(' ')[0]);
  assert.equal(commands.length, 8, commands.join());
  for (const word of [...after, ...bare]) assert.ok(commands.includes(word) || inner.includes(word), `${word} is no command`);
  for (const word of commands) assert.ok(after.includes(word) || bare.includes(word), `${word} is missing`);
  const sources = SOURCES.map(read).join('\n');
  for (const span of spans(text).filter((span) => /^[A-Za-z][A-Za-z-]*( [A-Za-z,-]+)+\.?$/.test(span))) assert.ok(sources.includes(span), `${span} is in no source file`);
});

test('every line of the setup document outside code passes the wording check and the Markdown stays plain', () => {
  const text = guide();
  for (const line of prose(text)) assert.equal(BANNED.exec(line.replace(/`[^`\n]+`/g, 'CODE')), null, line);
  assert.equal(/```|~~~|!\[|<[a-z]|\*\*|__|^\s*[-*+] /m.exec(text), null);
  assert.equal(/[^\n\x20-\x7e]/.exec(text), null);
  assert.equal(text.split('\n').filter((line) => /^\d+\. /.test(line)).length >= 3, true);
  assert.equal(text.endsWith('\n') && !text.endsWith('\n\n'), true);
});

test('the pages workflow publishes the setup document and starts on a change to that document, and the README has the prompt with the published address', () => {
  const pages = read('.github/workflows/pages.yml');
  assert.match(pages, /paths:\n(\s+- \S+\n)*\s+- docs\/setup\.md\n/);
  assert.match(pages, /\n\s+- run: cp local\/install\.sh web\/dist-site\/install\.sh\n\s+- run: cp docs\/setup\.md web\/dist-site\/setup\.md\n\s+- uses: actions\/upload-pages-artifact/);
  assert.equal(pages.match(/setup\.md/g)?.length, 3);
  const readme = read('README.md');
  const site = /\n {4}curl -fsSL (\S+)\/install\.sh \| sh\n/.exec(readme)?.[1] ?? '';
  assert.ok(site, 'the README has the curl line');
  assert.ok(readme.includes(`\n    Set up agent-ctx on this computer. Read ${site}/setup.md and follow the steps.\n`), `${site}/setup.md`);
});
