import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGINS = dirname(fileURLToPath(import.meta.url));
export const NAMES = ['claude-code', 'codex'];

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

export function currentOrigin(from = PLUGINS) {
  const codex = JSON.parse(readFileSync(join(from, 'codex', 'mcp.json'), 'utf8')).mcpServers?.['agent-ctx']?.url;
  const claude = JSON.parse(readFileSync(join(from, 'claude-code', '.claude-plugin', 'plugin.json'), 'utf8')).mcpServers?.['agent-ctx']?.url;
  const origins = [...new Set([codex, claude].map((u) => new URL(String(u)).origin))];
  if (origins.length !== 1) throw new Error(`The plugin files contain ${origins.length} origins. Fix the plugin files by hand first.`);
  return origins[0];
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

export function stamp(origin, outDir, bearer, from = PLUGINS) {
  const o = cleanOrigin(origin);
  const src = resolve(from);
  const out = outDir === undefined ? src : resolve(outDir);
  if (bearer !== undefined && (typeof bearer !== 'string' || !/^[\x21-\x7e]+$/.test(bearer))) throw new Error('The bearer token must be one word of plain characters.');
  if (bearer !== undefined && out === src) throw new Error('A bearer header goes only into a copy in another folder.');
  for (const name of NAMES) if (out !== src && (out + sep).startsWith(join(src, name) + sep)) throw new Error('The output folder must sit outside the plugin folders.');
  const old = currentOrigin(src);
  const written = [];
  for (const name of NAMES) {
    for (const file of walk(join(src, name))) {
      const rel = relative(src, file);
      const dest = join(out, rel);
      mkdirSync(dirname(dest), { recursive: true });
      if (!file.endsWith('.json') && !file.endsWith('.md')) {
        if (dest !== file) writeFileSync(dest, readFileSync(file));
        written.push(rel);
        continue;
      }
      let text = readFileSync(file, 'utf8').split(old).join(o);
      if (bearer !== undefined && file.endsWith('.json')) text = withBearer(text, bearer);
      writeFileSync(dest, text);
      written.push(rel);
    }
  }
  return { origin: o, from: old, out, plugins: NAMES, files: written };
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (main) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--bearer');
  const bearer = at >= 0 ? args[at + 1] : undefined;
  const rest = at >= 0 ? args.filter((_, i) => i !== at && i !== at + 1) : args;
  if (rest.length < 1 || rest.length > 2 || (at >= 0 && !bearer)) {
    console.log('Give an origin, as in node plugins/stamp.mjs https://agent-ctx.example, to write that origin into the plugin files in place.');
    console.log('Add a folder after the origin to write a copy there, and --bearer TOKEN to put a bearer header on that copy for local tests only.');
    process.exit(rest.length === 0 ? 0 : 1);
  }
  try {
    const r = stamp(rest[0], rest[1], bearer);
    console.log(`Stamped ${r.plugins.join(' and ')} for ${r.origin} in place of ${r.from} into ${r.out}${bearer ? ' with a bearer header' : ''}.`);
  } catch (e) {
    console.log(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
