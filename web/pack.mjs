import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const BLOCK = 512;
const GZIP = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255]);

export const DIR = join(HERE, 'dist-local');
export const NAME = 'agent-ctx-page.tgz';

function split(name) {
  if (Buffer.byteLength(name) <= 100) return ['', name];
  for (let at = name.indexOf('/'); at >= 0; at = name.indexOf('/', at + 1)) {
    if (Buffer.byteLength(name.slice(0, at)) <= 155 && Buffer.byteLength(name.slice(at + 1)) <= 100) return [name.slice(0, at), name.slice(at + 1)];
  }
  throw new Error(`The file name ${name} is too long for the packed folder.`);
}

function entry(name, data) {
  const [prefix, short] = split(name);
  const head = Buffer.alloc(BLOCK);
  head.write(short, 0, 100, 'utf8');
  head.write('0000644\0', 100);
  head.write('0000000\0', 108);
  head.write('0000000\0', 116);
  head.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  head.write('00000000000\0', 136);
  head.write('        ', 148);
  head.write('0', 156);
  head.write('ustar\u000000', 257);
  head.write(prefix, 345, 155, 'utf8');
  head.write(`${head.reduce((sum, b) => sum + b, 0).toString(8).padStart(6, '0')}\0 `, 148);
  return [head, data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK)];
}

function gzip(data) {
  const tail = Buffer.alloc(8);
  tail.writeUInt32LE(crc32(data), 0);
  tail.writeUInt32LE(data.length % 2 ** 32, 4);
  return Buffer.concat([GZIP, deflateRawSync(data, { level: 9 }), tail]);
}

export function pack(dir = DIR, out = join(dir, NAME)) {
  if (!existsSync(join(dir, 'index.html'))) throw new Error(`No built page was found in ${dir}. Run the local build first.`);
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .filter((name) => name !== NAME && name !== 'SHA256SUMS' && !name.split('/').some((part) => part.startsWith('.')))
    .sort((a, b) => (a < b ? -1 : 1));
  const bytes = gzip(Buffer.concat([...files.flatMap((name) => entry(name, readFileSync(join(dir, ...name.split('/'))))), Buffer.alloc(BLOCK * 2)]));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  return { path: out, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const made = pack(process.argv[2] ? resolve(process.argv[2]) : DIR, process.argv[3] ? resolve(process.argv[3]) : undefined);
    process.stdout.write(`Page files written to ${made.path}\nSize ${made.size} bytes\nSHA-256 ${made.sha256}\n`);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
