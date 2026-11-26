import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = join(ROOT, 'plugins', 'src');
const MARK = '__ORIGIN__';

export function cleanOrigin(raw) {
  let u;
  try {
    u = new URL(String(raw ?? ''));
  } catch {
    throw new Error(`${raw} is not an address. Give one such as https://agent-ctx.example`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The address must start with https or http.');
  if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) throw new Error('Give the origin alone, with no path, query or sign in.');
  return u.origin;
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}

function withBearer(text, token) {
  const j = JSON.parse(text);
  if (!j || typeof j.mcpServers !== 'object' || j.mcpServers === null) return text;
  for (const server of Object.values(j.mcpServers)) server.headers = { ...(server.headers ?? {}), Authorization: `Bearer ${token}` };
  return `${JSON.stringify(j, null, 2)}\n`;
}

export function stamp(origin, outDir, bearer) {
  const o = cleanOrigin(origin);
  const out = resolve(outDir);
  if (out === SRC || out.startsWith(SRC + sep)) throw new Error('The output folder must sit outside plugins/src.');
  if (bearer !== undefined && (typeof bearer !== 'string' || !/^[\x21-\x7e]+$/.test(bearer))) throw new Error('The bearer token must be one word of plain characters.');
  const plugins = readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const name of plugins) rmSync(join(out, name), { recursive: true, force: true });
  const written = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    let text = readFileSync(file, 'utf8').split(MARK).join(o);
    if (bearer !== undefined && file.endsWith('.json')) text = withBearer(text, bearer);
    const dest = join(out, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    written.push(rel);
  }
  return { origin: o, out, plugins, files: written };
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (main) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--bearer');
  const bearer = at >= 0 ? args[at + 1] : undefined;
  const rest = at >= 0 ? args.filter((_, i) => i !== at && i !== at + 1) : args;
  if (rest.length !== 2 || (at >= 0 && !bearer)) {
    console.log('Give an origin and a folder, as in node scripts/stamp.mjs https://agent-ctx.example out');
    console.log('Add --bearer TOKEN to put a bearer header on the server entry, for local tests only.');
    process.exit(rest.length === 0 ? 0 : 1);
  }
  try {
    const r = stamp(rest[0], rest[1], bearer);
    console.log(`Stamped ${r.plugins.join(' and ')} for ${r.origin} into ${r.out}${bearer ? ' with a bearer header' : ''}.`);
  } catch (e) {
    console.log(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
