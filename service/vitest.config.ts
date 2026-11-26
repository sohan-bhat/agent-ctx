import { randomBytes } from 'node:crypto';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          COOKIE_KEY: randomBytes(32).toString('hex'),
          GITHUB_CLIENT_ID: 'test-client-id',
          GITHUB_CLIENT_SECRET: randomBytes(16).toString('hex'),
          DEV_LOGIN: '1',
        },
      },
    }),
  ],
  test: { testTimeout: 120000, hookTimeout: 120000 },
});
