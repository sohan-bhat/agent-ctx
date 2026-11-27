import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ENTRY = join(ROOT, 'plugins', 'claude-code', 'scripts', 'agent-ctx.mjs');
export const OUT = join(ROOT, 'local', 'out', 'agent-ctx.mcpb');
export const ICON = join(ROOT, 'plugins', 'claude-code', '.claude-plugin', 'icon.png');

const SERVER = 'server/index.mjs';
const NODE = '>=22.16.0';
const ICON_MIN = 256;
const DOS_TIME = 0;
const DOS_DATE = 0x21;
const MODE = 0o100644;

export const TOOLS = [
  { name: 'recall', description: 'Read the handoff, the rules and the dead ends saved for a project.' },
  { name: 'checkpoint', description: 'Save the goal, the changes, the decisions and the open tasks after a piece of work.' },
  { name: 'handoff', description: 'Save the state of a task for the next agent.' },
  { name: 'rule', description: 'Save a standing rule in your exact words.' },
  { name: 'event', description: 'Reserved for plugin hooks and never called by an agent.' },
];

export const README = [
  '# agent-ctx',
  '',
  'agent-ctx is one memory on this computer, shared by Claude and every other agent you use.',
  '',
  'The agents save checkpoints, handoffs and the rules you state in your own words, and events from the hooks of coding agents are stored as well. Every entry is kept in one SQLite file at `.agent-ctx/memory.db` in your home folder.',
  '',
  'Everything stays on this computer, so no account is needed and nothing is sent to a server.',
  '',
].join('\n');

export function manifest(version) {
  return {
    manifest_version: '0.3',
    name: 'agent-ctx',
    display_name: 'agent-ctx',
    version,
    description: 'One memory on this computer, shared by Claude and every other agent you use.',
    author: { name: 'agent-ctx' },
    repository: { type: 'git', url: 'https://github.com/sohan-bhat/agent-ctx' },
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: SERVER,
      mcp_config: { command: 'node', args: [`\${__dirname}/${SERVER}`, 'mcp', '--agent', 'claude-desktop'] },
    },
    tools: TOOLS,
    license: 'MIT',
    compatibility: { runtimes: { node: NODE } },
  };
}

function icon(path) {
  const data = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  const png = data.length > 24 && data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(4) === 0x0d0a1a0a && data.toString('latin1', 12, 16) === 'IHDR';
  if (!png || data.readUInt32BE(16) < ICON_MIN || data.readUInt32BE(20) < ICON_MIN) {
    throw new Error(`The icon at ${path} must be a PNG of at least ${ICON_MIN} by ${ICON_MIN} pixels.`);
  }
  return data;
}

export function zip(files) {
  const bodies = [];
  const rows = [];
  let offset = 0;
  for (const [name, data] of files) {
    const label = Buffer.from(name);
    const packed = deflateRawSync(data, { level: 9 });
    const stored = packed.length >= data.length;
    const body = stored ? data : packed;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(label.length, 26);
    const row = Buffer.alloc(46);
    row.writeUInt32LE(0x02014b50, 0);
    row.writeUInt16LE((3 << 8) | 20, 4);
    head.copy(row, 6, 4, 30);
    row.writeUInt32LE((MODE << 16) >>> 0, 38);
    row.writeUInt32LE(offset, 42);
    bodies.push(head, label, body);
    rows.push(row, label);
    offset += head.length + label.length + body.length;
  }
  const index = Buffer.concat(rows);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...bodies, index, end]);
}

export function pack(entry = ENTRY, out = OUT) {
  if (!existsSync(entry)) throw new Error(`No built program was found at ${entry}. Run npm run build first.`);
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const bytes = zip([
    ['manifest.json', Buffer.from(`${JSON.stringify(manifest(version), null, 2)}\n`)],
    ['README.md', Buffer.from(README)],
    ['icon.png', icon(ICON)],
    [SERVER, readFileSync(entry)],
  ]);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  return { path: out, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const made = pack(process.argv[2] ? resolve(process.argv[2]) : ENTRY, process.argv[3] ? resolve(process.argv[3]) : OUT);
    process.stdout.write(`Bundle written to ${made.path}\nSize ${made.size} bytes\nSHA-256 ${made.sha256}\n`);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
