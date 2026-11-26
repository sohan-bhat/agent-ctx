import { randomBytes } from 'node:crypto';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { outbound } from './test/outbound.ts';

const github = { clientId: 'test-client-id', clientSecret: randomBytes(16).toString('hex') };

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          COOKIE_KEY: randomBytes(32).toString('hex'),
          GITHUB_CLIENT_ID: github.clientId,
          GITHUB_CLIENT_SECRET: github.clientSecret,
          DEV_LOGIN: '1',
        },
        outboundService: outbound(github),
      },
    }),
  ],
  test: { testTimeout: 120000, hookTimeout: 120000 },
});
