import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@core': path.join(here, '..', 'core', 'src'), '@': path.join(here, 'src') } },
  build: { outDir: path.join(here, '..', 'service', 'public'), emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
  server: { port: 5199, strictPort: true },
  preview: { port: 5198, strictPort: true },
});
