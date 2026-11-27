import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));

const ENTRY: Record<string, { html: string; out: string }> = {
  site: { html: 'site.html', out: path.join(here, 'dist-site') },
  page: { html: 'local.html', out: path.join(here, 'dist-local') },
};

const entryIndex = ({ html, out }: { html: string; out: string }): Plugin => ({
  name: 'entry-index',
  apply: 'build',
  writeBundle(options) {
    const dir = options.dir ?? out;
    fs.renameSync(path.join(dir, html), path.join(dir, 'index.html'));
  },
});

export default defineConfig(({ mode }) => {
  const site = mode === 'site';
  const entry = Object.hasOwn(ENTRY, mode) ? ENTRY[mode] : null;
  return {
    root: here,
    base: site ? '/agent-ctx/' : mode === 'page' ? './' : '/',
    publicDir: site ? false : 'public',
    plugins: [react(), tailwindcss(), ...(entry ? [entryIndex(entry)] : [])],
    resolve: { alias: { '@core': path.join(here, '..', 'core', 'src'), '@': path.join(here, 'src') } },
    build: {
      outDir: entry ? entry.out : path.join(here, '..', 'service', 'public'),
      emptyOutDir: true,
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 1200,
      ...(entry ? { rolldownOptions: { input: path.join(here, entry.html) } } : {}),
    },
    server: { port: 5199, strictPort: true },
    preview: { port: 5198, strictPort: true },
  };
});
