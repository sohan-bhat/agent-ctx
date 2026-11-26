import { readFileSync } from 'node:fs';
import path from 'node:path';
import { browser, web } from './lib.mjs';

const SIZE = 512;
const svg = readFileSync(path.join(web, 'public', 'favicon.svg'), 'utf8').replace('<svg ', `<svg width="${SIZE}" height="${SIZE}" `);
const out = process.env.OUT ?? path.join(web, '..', 'plugins', 'src', 'claude-code', '.claude-plugin', 'icon.png');

const b = await browser();
try {
  const ctx = await b.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
  await ctx.close();
  console.log(`Wrote a ${SIZE} px icon to ${path.relative(path.join(web, '..'), out)}.`);
} finally {
  await b.close();
}
