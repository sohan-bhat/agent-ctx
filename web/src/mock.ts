import { itemBytes } from '@core/model.ts';
import { ruleLine } from '@core/rules.ts';
import { ApiError } from '@/lib/api';
import type { Agent, CardBody, DroppedBody, HandoffBody, Item, Kind, Live, Me, NewRule, Origin, Project, Read, RuleBody, Space, Transport } from '@/lib/api';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const PROJECTS: Project[] = [
  { key: 'github.com/kelpworks/harbor', name: 'harbor', items: 0 },
  { key: 'github.com/kelpworks/lantern', name: 'lantern', items: 0 },
  { key: 'folder:field-notes', name: 'field-notes', items: 0 },
];

interface Card {
  goal: string;
  changed?: string[];
  decisions?: [string, string][];
  commands?: string[];
  dead?: string[];
  open?: string[];
  said?: string;
}

const CARDS: Record<string, Card[]> = {
  harbor: [
    { goal: 'Add slip search by date range', changed: ['src/search/range.ts', 'src/api/slips.ts'], decisions: [['store dates as UTC days', 'bookings were off by one day at local midnight']], commands: ['npm test', 'npm run lint'], open: ['the dock filter is ignored in search'] },
    { goal: 'Stop double bookings from two quick taps', changed: ['src/booking/reserve.ts'], decisions: [['lock the slip row inside the transaction', 'the free check was passed by two requests at once']], dead: ['retries from the app were not stopped by a debounce on the button'], commands: ['npm test -- reserve'] },
    { goal: 'Move the price table into the database', changed: ['db/migrations/0014_prices.sql', 'src/pricing/table.ts'], decisions: [['keep one price row per dock and season', 'the old JSON file had copies that drifted']], open: ['the JSON file is still read by the seed script'] },
    { goal: 'Write the refund flow for cancelled slips', changed: ['src/booking/refund.ts', 'src/api/refunds.ts', 'test/refund.test.ts'], decisions: [['refund to the original card only', 'store credit has no policy page yet']], commands: ['npm test -- refund'], open: ['partial refunds for late cancels'] },
    { goal: 'Speed up the dock map page', changed: ['src/map/DockMap.tsx'], decisions: [['draw slips on one canvas', 'four hundred SVG nodes were painted in 900 ms']], dead: ['memoizing each slip row was no faster'], said: 'The map is now painted in about 120 ms on the old laptop.' },
    { goal: 'Send receipts after a booking', changed: ['src/mail/receipt.ts', 'templates/receipt.mjml'], commands: ['npm run mail:preview'], open: ['receipt has no harbor phone number'] },
    { goal: 'Add a waitlist for full docks', changed: ['src/waitlist/queue.ts', 'src/api/waitlist.ts'], decisions: [['offer a freed slip to one person at a time', 'there was a rush when everyone got the offer']], open: ['expiry time for an offer'] },
    { goal: 'Clean up booking form errors', changed: ['src/booking/Form.tsx'], decisions: [['show errors under each field', 'the banner at the top was missed on phones']] },
    { goal: 'Page the admin booking list', changed: ['src/admin/Bookings.tsx', 'src/api/admin.ts'], commands: ['npm test -- admin'], decisions: [['cursor pages on created time', 'rows were skipped with offset pages during edits']] },
    { goal: 'Upgrade the date library', changed: ['package.json', 'src/search/range.ts'], dead: ['the range parser was broken by the codemod'], commands: ['npm install', 'npm test'] },
  ],
  lantern: [
    { goal: 'Render tiles in parallel', changed: ['src/render/mod.rs', 'src/export.rs'], decisions: [['one rayon pool sized to the cores', 'the cache was thrashed with a pool per region']], commands: ['cargo test', 'cargo bench -- tiles'] },
    { goal: 'Cache decoded glyphs between tiles', changed: ['src/text/glyphs.rs'], decisions: [['an LRU of 4096 glyphs', 'the same glyphs were decoded for every tile in the label pass']], commands: ['cargo test'], said: 'Export time for the test region fell from 41 s to 26 s.' },
    { goal: 'Fix seams between tiles at zoom 14', changed: ['src/render/clip.rs'], dead: ['the roads were blurred by a one pixel overlap'], decisions: [['clip with a two pixel buffer then crop', 'there is now no gap between roads']], commands: ['cargo test -- seams'] },
    { goal: 'Add a dry run flag to export', changed: ['src/cli.rs', 'src/export.rs'], commands: ['cargo run -- export --dry-run coast'] },
    { goal: 'Read styles from a TOML file', changed: ['src/style/load.rs', 'styles/coast.toml'], decisions: [['keep the old JSON styles readable for one release', 'two users still ship JSON']], open: ['the line in error messages is wrong'] },
    { goal: 'Cut memory use on whole region exports', changed: ['src/export.rs', 'src/store/tiles.rs'], decisions: [['stream finished tiles to disk', 'memory was at 6 GB with every tile held']], dead: ['the peak only moved with a smaller tile cache'], commands: ['cargo run --release -- export coast'] },
    { goal: 'Port the label placer to the new font crate', changed: ['src/text/place.rs', 'Cargo.toml'], open: ['kerning pairs are off for italic labels'] },
    { goal: 'Add a progress bar to long exports', changed: ['src/cli.rs'], commands: ['cargo test'] },
  ],
  'field-notes': [
    { goal: 'Write up the ferry schedule research', changed: ['notes/ferry-schedules.md'], open: ['check the winter timetable'] },
    { goal: 'Add tags to the notes index', changed: ['site/index.ts', 'site/tags.ts'], decisions: [['tags from front matter only', 'guessing tags from text was noisy']] },
    { goal: 'Fix broken links after the folder move', changed: ['notes/README.md', 'site/links.ts'], commands: ['npm run check-links'] },
  ],
};

const PROMPTS = [
  'full docks are still on the search page, can you look',
  'run the tests and tell me what fails',
  'keep going from the end of the last session',
  'make the export faster on the big region',
  'why does the map flicker on scroll',
  'clean up the branch before I open the pull request',
];

const HANDOFFS: Record<string, HandoffBody[]> = {
  harbor: [
    { goal: 'Finish the refund flow', done: 'Full refunds are done and tested', next: 'Partial refunds for cancels within 48 hours', blockers: ['policy for late cancels is not written'], files: ['src/booking/refund.ts', 'test/refund.test.ts'], check: 'npm test -- refund' },
    { goal: 'Waitlist offers', done: 'Queue and API are in', next: 'Expire an offer after two hours and move to the next person', files: ['src/waitlist/queue.ts'], check: 'npm test -- waitlist' },
    { goal: 'Dock filter in search', next: 'Pass the dock id from the form to the range query', files: ['src/search/range.ts', 'src/search/Form.tsx'], check: 'npm test -- search' },
  ],
  lantern: [
    { goal: 'Memory on whole region exports', done: 'Tiles are streamed to disk', next: 'Measure peak memory on the coast region and write the number in the README', check: 'cargo run --release -- export coast' },
    { goal: 'Label placer port', done: 'Regular labels are placed correctly', next: 'Fix kerning for italic labels', blockers: ['font crate has no italic kerning table yet'], files: ['src/text/place.rs'], check: 'cargo test -- labels' },
  ],
  'field-notes': [{ goal: 'Ferry notes', next: 'Add the winter timetable and the two missing piers', files: ['notes/ferry-schedules.md'] }],
};

const RULES: { project: string; agent: string; body: RuleBody; days: number }[] = [
  { project: 'github.com/kelpworks/harbor', agent: 'Claude Code', days: 18, body: { text: 'Never commit straight to main, open a branch first', words: 'never commit straight to main, open a branch first', scope: 'all', status: 'active', proof: 'elicit' } },
  { project: 'github.com/kelpworks/harbor', agent: 'Codex', days: 11, body: { text: 'Run the full test suite before calling a task done', words: 'run the full test suite before you call a task done', scope: 'project', status: 'active', proof: 'elicit' } },
  { project: 'github.com/kelpworks/lantern', agent: 'Claude Code', days: 9, body: { text: 'Keep clippy clean with no allow attributes', words: 'keep clippy clean, no allow attributes', scope: 'project', status: 'active', proof: 'page' } },
  { project: 'github.com/kelpworks/lantern', agent: 'Cursor', days: 2, body: { text: 'Skip the slow tests on every run', words: 'skip the slow tests on every run', scope: 'project', status: 'pending' } },
  { project: 'github.com/kelpworks/harbor', agent: 'Codex', days: 1, body: { text: 'Push to the release branch after each fix', words: 'push to the release branch after each fix', scope: 'project', status: 'pending' } },
  { project: 'github.com/kelpworks/harbor', agent: 'Claude Code', days: 15, body: { text: 'Write commit messages in the past tense', words: 'write commit messages in the past tense', scope: 'all', status: 'off', proof: 'page' } },
];

const AGENT_SEED: { label: string; days: number; via: Origin['via']; projects: string[] }[] = [
  { label: 'Claude Code', days: 21, via: 'hook', projects: ['harbor', 'lantern', 'field-notes'] },
  { label: 'Codex', days: 14, via: 'hook', projects: ['harbor', 'lantern'] },
  { label: 'Cursor', days: 9, via: 'tool', projects: ['lantern', 'harbor'] },
];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cardBody(c: Card, auto: boolean, r: () => number): CardBody {
  const b: CardBody = { goal: c.goal };
  if (c.changed) b.changed = c.changed.map((path) => ({ path }));
  if (c.decisions) b.decisions = c.decisions.map(([what, why]) => ({ what, why }));
  if (c.commands) b.commands = c.commands;
  if (c.dead) b.dead_ends = c.dead;
  if (c.open) b.open = c.open;
  if (auto) {
    b.auto = true;
    b.prompts = [PROMPTS[Math.floor(r() * PROMPTS.length)]];
    b.last = c.said ?? 'The change is in and the tests pass.';
  }
  return b;
}

let serial = 0;
const nextId = () => `m${(++serial).toString(36).padStart(4, '0')}`;

function make(kind: Kind, project: string, body: Item['body'], agent: string, at: number, via: Origin['via'], extra: Partial<Item> = {}): Item {
  return {
    id: nextId(),
    project,
    kind,
    body,
    origin: { agent, machine: agent === 'Cursor' ? 'laptop' : 'studio', session: `s${Math.floor(at / HOUR)}${agent.length}`, via, source: kind === 'rule' && (body as RuleBody).proof ? 'person' : 'agent', at },
    flags: [],
    held: false,
    pinned: false,
    folded: false,
    created: at,
    ...extra,
  };
}

function workHour(day: number, r: () => number, now: number): number {
  const base = now - day * DAY;
  const start = new Date(base);
  start.setHours(8 + Math.floor(r() * 10), Math.floor(r() * 60), 0, 0);
  return Math.min(now - 60_000, start.getTime());
}

interface World {
  agents: Agent[];
  items: Item[];
  queue: string[];
  reads: Read[];
}

function seed(now: number): World {
  serial = 0;
  const r = rng(20261125);
  const agents: Agent[] = AGENT_SEED.map((a) => ({ id: a.label, label: a.label, first: now - a.days * DAY, last: now }));
  const items: Item[] = [];
  const keyOf = (name: string) => PROJECTS.find((p) => p.name === name)!.key;
  for (const a of AGENT_SEED) {
    for (let day = a.days; day >= 0; day--) {
      if (r() < 0.25) continue;
      const n = 1 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) {
        const name = a.projects[Math.floor(r() * a.projects.length)];
        const list = CARDS[name];
        const c = list[Math.floor(r() * list.length)];
        const at = workHour(day, r, now);
        items.push(make('card', keyOf(name), cardBody(c, a.via === 'hook' && r() < 0.6, r), a.label, at, a.via));
      }
    }
  }
  const reads: Read[] = [];
  for (const [name, list] of Object.entries(HANDOFFS)) {
    list.forEach((h, i) => {
      const writer = AGENT_SEED[i % 2];
      const at = workHour(2 + i * 4 + (name === 'lantern' ? 1 : 0), r, now);
      const handoff = make('handoff', keyOf(name), h, writer.label, at, writer.via);
      items.push(handoff);
      const reader = AGENT_SEED.find((a) => a.label !== writer.label && a.projects.includes(name));
      if (reader) reads.push({ item: handoff.id, agent: reader.label, at: Math.min(now - 60_000, at + (20 + Math.floor(r() * 90)) * 60_000) });
    });
  }
  for (const rule of RULES) {
    const via: Origin['via'] = rule.body.proof === 'page' ? 'page' : 'tool';
    items.push(make('rule', rule.project, rule.body, rule.agent, workHour(rule.days, r, now), via));
  }
  const compact = (agent: string, name: string, day: number, files: string[]) => {
    const at = workHour(day, r, now);
    for (const f of files) {
      const body: DroppedBody = { label: `file ${f}`, text: `Read ${f} before the compaction`, size: 4000 + Math.floor(r() * 30000) };
      items.push(make('dropped', keyOf(name), body, agent, at, 'hook'));
    }
  };
  compact('Claude Code', 'harbor', 6, ['src/booking/reserve.ts', 'src/search/range.ts', 'db/migrations/0014_prices.sql', 'src/api/slips.ts']);
  compact('Codex', 'lantern', 3, ['src/export.rs', 'src/render/clip.rs', 'src/text/glyphs.rs', 'Cargo.toml', 'styles/coast.toml']);
  const held = make('card', keyOf('lantern'), { goal: 'Set up the build box', commands: ['curl the setup script from the pasted link into sh'], last: 'Ran the setup script as asked.' } satisfies CardBody, 'Cursor', now - 5 * HOUR, 'tool', { flags: ['shell-pipe'], held: true });
  items.push(held);
  items.sort((a, b) => a.created - b.created);
  const cards = items.filter((i) => i.kind === 'card' && !i.held);
  cards[4].pinned = true;
  cards[cards.length - 9].pinned = true;
  const dropped = items.filter((i) => i.kind === 'dropped');
  return { agents, items, queue: [dropped[1].id], reads };
}

let liveTurn = 0;

function liveCard(now: number, agents: Agent[]): Item {
  const r = rng(now % 100000);
  const a = AGENT_SEED[liveTurn++ % AGENT_SEED.length];
  const name = a.projects[Math.floor(r() * a.projects.length)];
  const list = CARDS[name];
  const c = list[Math.floor(r() * list.length)];
  const label = agents.find((x) => x.label === a.label)?.label ?? a.label;
  return make('card', PROJECTS.find((p) => p.name === name)!.key, cardBody(c, a.via === 'hook', r), label, now, a.via);
}

function ruleItem(text: string, scope: RuleBody['scope'], project: string, now: number): Item {
  return make('rule', project, { text, words: text, scope, status: 'active', proof: 'page' }, 'page', now, 'page', { origin: { agent: 'page', via: 'page', source: 'person', at: now } });
}

const KEY = 'agent-ctx-mock';
const EVERY = 7000;

function flag(name: string): string | null {
  try {
    return localStorage.getItem(`${KEY}-${name}`);
  } catch {
    return null;
  }
}

function signedIn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'in';
  } catch {
    return false;
  }
}

export function signIn(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, 'in');
    else localStorage.removeItem(KEY);
  } catch {}
}

let world: World | null = null;
const listeners = new Set<(m: Live) => void>();

function state(): World {
  if (!world) world = flag('empty') === '1' ? { agents: [], items: [], queue: [], reads: [] } : seed(Date.now());
  return world;
}

const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const send = (m: Live) => listeners.forEach((f) => f(m));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const view = (i: Item): Item => (i.kind === 'rule' ? { ...clone(i), line: ruleLine(i.body as RuleBody) } : clone(i));

function find(id: string): Item {
  const item = state().items.find((i) => i.id === id);
  if (!item) throw new Error('not found');
  return item;
}

function touch(item: Item): void {
  send({ type: 'item', item: view(item) });
}

let pulse: ReturnType<typeof setInterval> | null = null;

function startPulse(): void {
  if (pulse || flag('quiet') === '1') return;
  pulse = setInterval(() => {
    const w = state();
    if (!w.agents.length) return;
    const card = liveCard(Date.now(), w.agents);
    w.items.push(card);
    send({ type: 'item', item: clone(card) });
    const a = w.agents.find((x) => x.label === card.origin.agent);
    if (a) {
      a.last = card.created;
      send({ type: 'agent', agent: { ...a } });
    }
  }, Number(flag('every') ?? EVERY));
}

if (typeof window !== 'undefined')
  (window as unknown as { __mockEdit?: (id: string, words: string) => void }).__mockEdit = (id, words) => {
    const rule = find(id);
    rule.body = { ...(rule.body as RuleBody), words };
  };

export const transport: Transport = {
  async me(): Promise<Me | null> {
    await wait();
    if (!signedIn()) return null;
    const bytes = state().items.reduce((a, i) => a + itemBytes(i), 0);
    return { person: { id: 'gh:4127703', login: 'kelp-dev' }, limits: { bytes, max: 10 * 1024 * 1024, callsToday: 212, storedToday: 37 }, toolChars: 2148 };
  },
  async space(): Promise<Space> {
    await wait(120);
    if (flag('fail') === 'space') throw new Error('offline');
    const w = state();
    const projects = PROJECTS.map((p) => ({ ...p, items: w.items.filter((i) => i.project === p.key).length })).filter((p) => p.items > 0);
    return clone({ projects, agents: w.agents, items: w.items.map(view), queue: w.queue, reads: w.reads, now: Date.now() });
  },
  async pin(id, on) {
    await wait();
    const item = find(id);
    item.pinned = on;
    touch(item);
  },
  async keep(id) {
    await wait();
    const item = find(id);
    item.held = false;
    touch(item);
  },
  async putBack(id) {
    await wait();
    find(id);
    if (!state().queue.includes(id)) state().queue.push(id);
  },
  async remove(id) {
    await wait();
    const w = state();
    w.items = w.items.filter((i) => i.id !== id);
    w.queue = w.queue.filter((q) => q !== id);
    w.reads = w.reads.filter((x) => x.item !== id);
    send({ type: 'remove', id });
  },
  async addRule(rule: NewRule) {
    await wait();
    const project = rule.project ?? PROJECTS[0].key;
    const item = ruleItem(rule.text, rule.scope, project, Date.now());
    state().items.push(item);
    touch(item);
    return view(item);
  },
  async setRule(id, status, line) {
    await wait();
    const item = find(id);
    const b = item.body as RuleBody;
    if (line !== undefined && ruleLine(b) !== line) throw new ApiError(409);
    item.body = { ...b, status, ...(status === 'active' && b.status !== 'active' ? { proof: 'page' as const } : {}) };
    item.held = status === 'active' ? false : item.held;
    touch(item);
  },
  async removeAgent(id) {
    await wait();
    const w = state();
    if (!w.agents.some((a) => a.id === id)) throw new ApiError(404);
    w.agents = w.agents.filter((a) => a.id !== id);
    send({ type: 'agent-removed', id });
  },
  async signOut() {
    await wait();
    signIn(false);
  },
  async merge(from, into) {
    await wait();
    for (const item of state().items) if (item.project === from) item.project = into;
    send({ type: 'reset' });
  },
  async exportAll() {
    const lines = state()
      .items.map((i) => JSON.stringify(i))
      .join('\n');
    const url = URL.createObjectURL(new Blob([lines], { type: 'application/x-ndjson' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agent-ctx.jsonl';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async deleteAccount() {
    await wait();
    world = { agents: [], items: [], queue: [], reads: [] };
    signIn(false);
  },
  live(on, open) {
    listeners.add(on);
    setTimeout(() => open(true), 30);
    startPulse();
    return () => {
      listeners.delete(on);
      if (!listeners.size && pulse) {
        clearInterval(pulse);
        pulse = null;
      }
    };
  },
  hint(product) {
    const w = state();
    if (w.agents.some((a) => a.label === product)) return;
    setTimeout(() => {
      if (w.agents.some((a) => a.label === product)) return;
      const now = Date.now();
      const agent: Agent = { id: product, label: product, first: now, last: now };
      w.agents.push(agent);
      send({ type: 'agent', agent: { ...agent } });
    }, Number(flag('connect') ?? 2500));
  },
};
