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

const FIRST = /^assets\/(?:atkinson-hyperlegible-next|jetbrains-mono)-latin-wght-normal-[\w-]+\.woff2$/;

const early = (base: string): Plugin => ({
  name: 'early',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(_html, ctx) {
      const files = Object.values(ctx.bundle ?? {});
      const fonts = files.filter((f) => FIRST.test(f.fileName)).map((f) => ({ rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href: `${base}${f.fileName}` }));
      const scene = files.filter((f) => f.type === 'chunk' && f.isDynamicEntry && f.name === 'Scene').map((f) => ({ rel: 'modulepreload', crossorigin: true, fetchpriority: 'low', href: `${base}${f.fileName}` }));
      return [...fonts, ...scene].map((attrs) => ({ tag: 'link', attrs, injectTo: 'head' as const }));
    },
  },
});

export default defineConfig(({ mode }) => {
  const site = mode === 'site';
  const entry = Object.hasOwn(ENTRY, mode) ? ENTRY[mode] : null;
  const base = site ? '/agent-ctx/' : mode === 'page' ? './' : '/';
  return {
    root: here,
    base,
    publicDir: site ? false : 'public',
    plugins: [react(), tailwindcss(), ...(site ? [early(base)] : []), ...(entry ? [entryIndex(entry)] : [])],
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
