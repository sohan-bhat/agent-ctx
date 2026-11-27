import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));

const siteIndex: Plugin = {
  name: 'site-index',
  apply: 'build',
  writeBundle(options) {
    const dir = options.dir ?? path.join(here, 'dist-site');
    fs.renameSync(path.join(dir, 'site.html'), path.join(dir, 'index.html'));
  },
};

export default defineConfig(({ mode }) => {
  const site = mode === 'site';
  return {
    root: here,
    base: site ? '/agent-ctx/' : '/',
    publicDir: site ? false : 'public',
    plugins: [react(), tailwindcss(), ...(site ? [siteIndex] : [])],
    resolve: { alias: { '@core': path.join(here, '..', 'core', 'src'), '@': path.join(here, 'src') } },
    define: site ? { 'import.meta.env.VITE_RELEASED': JSON.stringify(process.env.VITE_RELEASED === '1' ? '1' : '') } : {},
    build: {
      outDir: site ? path.join(here, 'dist-site') : path.join(here, '..', 'service', 'public'),
      emptyOutDir: true,
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 1200,
      ...(site ? { rolldownOptions: { input: path.join(here, 'site.html') } } : {}),
    },
    server: { port: 5199, strictPort: true },
    preview: { port: 5198, strictPort: true },
  };
});
