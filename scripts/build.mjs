import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);

if (want('node')) {
  fs.mkdirSync(dist, { recursive: true });
  for (const name of ['cli', 'hook', 'worker']) {
    await build({
      entryPoints: [path.join(root, 'src', `${name}.ts`)],
      outfile: path.join(dist, `${name}.js`),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      minify: name !== 'cli',
      legalComments: 'none',
      banner: name === 'cli' ? { js: '#!/usr/bin/env node' } : undefined,
      logLevel: 'warning',
    });
  }
  const cli = path.join(dist, 'cli.js');
  const src = fs.readFileSync(cli, 'utf8').replace(/^#!\/usr\/bin\/env node\n#!\/usr\/bin\/env node\n/, '#!/usr/bin/env node\n');
  fs.writeFileSync(cli, src);
  fs.chmodSync(cli, 0o755);
}

if (want('web') && fs.existsSync(path.join(root, 'web', 'index.html'))) {
  if (!fs.existsSync(path.join(root, 'web', 'node_modules', 'vite'))) {
    const npm = process.env.npm_execpath;
    execFileSync(npm ? process.execPath : 'npm', [...(npm ? [npm] : []), 'install', '--no-audit', '--no-fund'], { stdio: 'inherit', cwd: path.join(root, 'web') });
  }
  execFileSync(process.execPath, [path.join(root, 'web', 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'web', 'vite.config.ts')], { stdio: 'inherit', cwd: path.join(root, 'web') });
}

if (want('plugin')) {
  const pdir = path.join(root, 'plugin', 'scripts');
  if (fs.existsSync(path.join(root, 'plugin'))) {
    fs.mkdirSync(pdir, { recursive: true });
    for (const name of ['hook', 'worker', 'cli']) fs.copyFileSync(path.join(dist, `${name}.js`), path.join(pdir, `${name}.js`));
  }
}
