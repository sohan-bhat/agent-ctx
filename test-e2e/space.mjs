import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jarFrom, page } from './oauth.mjs';

export async function space(secretsFile) {
  const s = JSON.parse(readFileSync(secretsFile, 'utf8'));
  const r = await page(jarFrom(s.cookie), 'GET', '/space');
  if (r.status !== 200) throw new Error(`The space gave ${r.status}.`);
  return r.json;
}

export function brief(item) {
  return {
    id: item.id,
    kind: item.kind,
    project: item.project,
    agent: item.origin?.agent,
    via: item.origin?.via,
    source: item.origin?.source,
    session: item.origin?.session ? String(item.origin.session).slice(0, 12) : undefined,
    flags: item.flags?.length ? item.flags : undefined,
    held: item.held || undefined,
    body: item.body,
  };
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (main) {
  const file = process.argv[2];
  if (!file) {
    console.log('Give the secrets file, as in node test-e2e/space.mjs /tmp/run/secrets.json');
    process.exit(0);
  }
  const sp = await space(file);
  console.log(JSON.stringify({ projects: sp.projects, agents: sp.agents.map((a) => a.label), queue: sp.queue, reads: sp.reads, items: sp.items.map(brief) }, null, 1));
}
