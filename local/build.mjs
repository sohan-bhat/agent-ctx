import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LICENCE = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'];
const RULE = '-'.repeat(72);

export const OUT = join(ROOT, 'plugins', 'claude-code', 'scripts');
export const FILES = ['agent-ctx.mjs', 'hook.mjs', 'LICENSES.txt'];

function library(input) {
  const at = input.lastIndexOf('node_modules/');
  if (at < 0) return null;
  const parts = input.slice(at + 13).split('/');
  return input.slice(0, at + 13) + parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/');
}

function notices(inputs) {
  const folders = [...new Set(inputs.map(library).filter(Boolean))];
  const rows = folders.map((folder) => {
    const { name, version, license } = JSON.parse(readFileSync(join(ROOT, folder, 'package.json'), 'utf8'));
    const file = LICENCE.map((f) => join(ROOT, folder, f)).find((f) => existsSync(f));
    return { name, head: `${name} ${version}, ${license}`, text: file ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim() : '' };
  });
  rows.sort((a, b) => (a.name < b.name ? -1 : 1));
  const head = `${FILES[0]} contains the ${rows.length} libraries named below, each under the licence printed after the name. ${FILES[1]} contains no library.`;
  return `${[head, ...rows.map((r) => (r.text ? `${r.head}\n\n${r.text}` : r.head))].join(`\n\n${RULE}\n\n`)}\n`;
}

export async function bundle(out = OUT) {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  mkdirSync(out, { recursive: true });
  const inputs = [];
  for (const [entry, name] of [['main.ts', FILES[0]], ['event.ts', FILES[1]]]) {
    const built = await build({
      absWorkingDir: ROOT,
      entryPoints: [join('local', 'src', entry)],
      outfile: join(out, name),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      banner: { js: '#!/usr/bin/env node' },
      define: { VERSION: JSON.stringify(version) },
      metafile: true,
      logLevel: 'warning',
    });
    chmodSync(join(out, name), 0o755);
    inputs.push(...Object.keys(built.metafile.inputs));
  }
  writeFileSync(join(out, FILES[2]), notices(inputs));
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await bundle(process.argv[2] ? resolve(process.argv[2]) : OUT);
