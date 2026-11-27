import { chmodSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const BUNDLE = join(ROOT, 'local', 'dist', 'agent-ctx.js');

export async function bundle(outfile = BUNDLE) {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  await build({
    absWorkingDir: ROOT,
    entryPoints: [join('local', 'src', 'main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
    define: { VERSION: JSON.stringify(version) },
    logLevel: 'warning',
  });
  chmodSync(outfile, 0o755);
  return outfile;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await bundle(process.argv[2] ? resolve(process.argv[2]) : BUNDLE);
