import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { Client } from '@modelcontextprotocol/client';
import type { Item } from '../../core/src/index.ts';
import { Jar, ORIGIN, call, connect, devSignIn, mcp, send } from './flow.ts';

interface Who { n: number; jar: Jar; client: Client; mark: string; repo: string; folder: string; session: string }

async function person(n: number, tag: string): Promise<Who> {
  const jar = await devSignIn(`${tag}-${n}`);
  const client = await mcp((await connect(jar, 'dcr', ['read', 'write'], `Agent ${n % 4}`)).access);
  return { n, jar, client, mark: `zq${n}x`, repo: `https://github.com/acme/proj${n}`, folder: `/work/proj${n}`, session: `sess-${tag}-${n}` };
}

async function space(w: Who): Promise<{ items: Item[]; projects: { key: string }[] }> {
  return (await send('/api/space', { headers: { Cookie: w.jar.header() } })).json();
}

async function dump(w: Who): Promise<string> {
  const s = JSON.stringify(await space(w));
  const zip = unzipSync(new Uint8Array(await (await send('/api/export', { headers: { Cookie: w.jar.header() } })).arrayBuffer()));
  return s + Object.values(zip).map(strFromU8).join('\n');
}

const TREES = ['alder', 'birch', 'cedar', 'dogwood', 'elm'];
const phrase = (n: number) => `keep the ${TREES[n % TREES.length]} lantern lit`;

function marks(text: string): Set<string> {
  return new Set(text.match(/zq\d+x/g) ?? []);
}

const api = (w: Who, path: string, method = 'POST', body?: unknown) =>
  send(path, { method, headers: { Cookie: w.jar.header(), Origin: ORIGIN, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

async function writeAll(w: Who): Promise<void> {
  const where = { repo: w.repo, folder: w.folder };
  await call(w.client, 'checkpoint', { ...where, goal: `Card ${w.mark} goal`, open: [`open ${w.mark}`] });
  await call(w.client, 'handoff', { ...where, goal: `Handoff ${w.mark}`, next: `Next ${w.mark}` });
  await call(w.client, 'event', { host: 'claude-code', event: 'UserPromptSubmit', session: w.session, cwd: w.folder, prompt: `please always mention ${w.mark} and ${phrase(w.n)}` });
  await call(w.client, 'rule', { ...where, text: `Rule ${w.mark}`, words: `please always mention ${w.mark}`, scope: 'all' });
  await api(w, '/api/rules', 'POST', { text: `Page rule ${w.mark}`, scope: 'all' });
}

describe('isolation', () => {
  it('a second person using the first person ids and keys sees and changes nothing of theirs', async () => {
    const a = await person(1, 'iso');
    const b = await person(2, 'iso');
    await writeAll(a);
    await writeAll(b);
    const before = await space(a);
    const ids = before.items.map((i) => i.id);
    const keys = before.projects.map((p) => p.key);
    const where = { repo: a.repo, folder: a.folder };
    const outs: string[] = [];
    outs.push((await call(b.client, 'recall', where)).text);
    outs.push((await call(b.client, 'recall', { ...where, query: `card ${a.mark} goal`, dropped: true })).text);
    outs.push((await call(b.client, 'checkpoint', { ...where, goal: `b writes into ${b.mark}` })).text);
    outs.push((await call(b.client, 'handoff', { ...where, goal: `b handoff ${b.mark}`, next: 'n' })).text);
    outs.push((await call(b.client, 'rule', { ...where, text: 't', words: phrase(a.n), scope: 'all' })).text);
    outs.push((await call(b.client, 'event', { host: 'claude-code', event: 'UserPromptSubmit', session: a.session, cwd: a.folder, prompt: 'continue the card goal work from before' })).text);
    outs.push((await call(b.client, 'event', { host: 'claude-code', event: 'SessionStart', session: a.session, cwd: a.folder, source: 'clear' })).text);
    for (const out of outs) expect(marks(out).has(a.mark)).toBe(false);
    expect(outs[4]).toContain('pending');
    for (const id of ids) {
      for (const [path, method, body] of [
        [`/api/items/${id}/pin`, 'POST', { on: true }],
        [`/api/items/${id}/keep`, 'POST', undefined],
        [`/api/items/${id}/putback`, 'POST', undefined],
        [`/api/items/${id}`, 'DELETE', undefined],
        [`/api/rules/${id}`, 'POST', { status: 'off' }],
      ] as [string, string, unknown][]) {
        expect((await api(b, path, method, body)).status).toBe(404);
      }
    }
    for (const from of keys) for (const into of keys) if (from !== into) expect((await api(b, '/api/projects/merge', 'POST', { from, into })).status).toBe(400);
    const after = await space(a);
    expect(after.items).toEqual(before.items);
    expect(after.projects).toEqual(before.projects);
    expect(marks(await dump(b))).toEqual(new Set([b.mark]));
  });

  it('50 people with 20 random operations each find only their own marks', async () => {
    let seed = 20261126;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const people: Who[] = [];
    for (let n = 100; n < 150; n++) people.push(await person(n, 'mass'));
    const known: string[] = [];
    for (let round = 0; round < 20; round++) {
      for (const w of people) {
        const other = people[rand(people.length)];
        const where = rand(2) ? { repo: other.repo, folder: other.folder } : { repo: w.repo, folder: w.folder };
        const op = rand(9);
        if (op === 0) await call(w.client, 'checkpoint', { ...where, goal: `Round ${round} ${w.mark}`, decisions: [`because ${w.mark}`] });
        else if (op === 1) await call(w.client, 'handoff', { ...where, goal: `Handoff ${round} ${w.mark}`, next: `next ${w.mark}` });
        else if (op === 2) await call(w.client, 'rule', { ...where, text: `Rule ${w.mark}`, words: `always write ${w.mark} first`, scope: 'all' });
        else if (op === 3) await call(w.client, 'recall', { ...where, query: `round ${other.mark}` });
        else if (op === 4) await call(w.client, 'event', { host: 'codex', event: 'UserPromptSubmit', session: rand(2) ? other.session : w.session, cwd: other.folder, prompt: `work on ${w.mark} round ${round} now` });
        else if (op === 5) await call(w.client, 'event', { host: 'codex', event: 'Stop', session: rand(2) ? other.session : w.session, cwd: other.folder, message: `done ${w.mark}` });
        else if (op === 6 && known.length) await api(w, `/api/items/${known[rand(known.length)]}/pin`, 'POST', { on: true });
        else if (op === 7 && known.length) await api(w, `/api/items/${known[rand(known.length)]}`, 'DELETE');
        else {
          const s = await space(w);
          for (const i of s.items.slice(0, 3)) known.push(i.id);
        }
      }
    }
    for (const w of people) {
      const found = marks(await dump(w));
      for (const m of found) expect(m).toBe(w.mark);
    }
  });
});
