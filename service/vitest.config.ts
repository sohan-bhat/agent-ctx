import { randomBytes } from 'node:crypto';
import { freemem, loadavg } from 'node:os';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { outbound, vendorOutbound } from './test/outbound.ts';

const github = { clientId: 'test-client-id', clientSecret: randomBytes(16).toString('hex') };
const load = process.env.LOAD === '1';
const monthRun = process.env.MONTH === '1';
const fake = outbound(github);
const vendors = vendorOutbound();

async function service(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (load && url.host === 'load.invalid' && url.pathname === '/loadavg') return Response.json({ load: loadavg(), freeMb: Math.round(freemem() / 1048576) });
  return (await vendors(request)) ?? fake(request);
}

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
          ...(monthRun ? { MONTH_SEED: process.env.MONTH_SEED ?? '1' } : {}),
          ...(load ? { LOAD_PEOPLE: process.env.LOAD_PEOPLE ?? '1000', LOAD_PLANT: process.env.LOAD_PLANT ?? '', REGISTRATIONS_PER_DAY: '1000000' } : {}),
        },
        outboundService: service,
      },
    }),
  ],
  test: monthRun
    ? { include: ['load/month.test.ts'], testTimeout: 1800000, hookTimeout: 1800000 }
    : load
    ? { include: ['load/load.test.ts'], testTimeout: 3600000, hookTimeout: 3600000 }
    : { include: ['test/**/*.test.ts'], testTimeout: 120000, hookTimeout: 120000 },
});
