import type { Agent, CardBody, DroppedBody, HandoffBody, Item, Kind, Origin, Project, RuleBody } from '@/lib/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const PROJECTS: Project[] = [
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
    { goal: 'Add slip search by date range', changed: ['src/search/range.ts', 'src/api/slips.ts'], decisions: [['store dates as UTC days', 'local midnight shifted bookings by one day']], commands: ['npm test', 'npm run lint'], open: ['search ignores the dock filter'] },
    { goal: 'Stop double bookings from two quick taps', changed: ['src/booking/reserve.ts'], decisions: [['lock the slip row inside the transaction', 'two requests raced past the free check']], dead: ['a debounce on the button did not stop retries from the app'], commands: ['npm test -- reserve'] },
    { goal: 'Move the price table into the database', changed: ['db/migrations/0014_prices.sql', 'src/pricing/table.ts'], decisions: [['keep one price row per dock and season', 'the old JSON file had copies that drifted']], open: ['seed script still reads the JSON file'] },
    { goal: 'Write the refund flow for cancelled slips', changed: ['src/booking/refund.ts', 'src/api/refunds.ts', 'test/refund.test.ts'], decisions: [['refund to the original card only', 'store credit needs a policy page first']], commands: ['npm test -- refund'], open: ['partial refunds for late cancels'] },
    { goal: 'Speed up the dock map page', changed: ['src/map/DockMap.tsx'], decisions: [['draw slips on one canvas', 'four hundred SVG nodes took 900 ms to paint']], dead: ['memoizing each slip row did not help'], said: 'The map now paints in about 120 ms on the old laptop.' },
    { goal: 'Send receipts after a booking', changed: ['src/mail/receipt.ts', 'templates/receipt.mjml'], commands: ['npm run mail:preview'], open: ['receipt has no harbor phone number'] },
    { goal: 'Add a waitlist for full docks', changed: ['src/waitlist/queue.ts', 'src/api/waitlist.ts'], decisions: [['offer a freed slip to one person at a time', 'offering to all caused a rush']], open: ['expiry time for an offer'] },
    { goal: 'Clean up booking form errors', changed: ['src/booking/Form.tsx'], decisions: [['show errors under each field', 'the banner at the top was missed on phones']] },
    { goal: 'Page the admin booking list', changed: ['src/admin/Bookings.tsx', 'src/api/admin.ts'], commands: ['npm test -- admin'], decisions: [['cursor pages on created time', 'offset pages skipped rows during edits']] },
    { goal: 'Upgrade the date library', changed: ['package.json', 'src/search/range.ts'], dead: ['the codemod broke the range parser'], commands: ['npm install', 'npm test'] },
  ],
  lantern: [
    { goal: 'Render tiles in parallel', changed: ['src/render/mod.rs', 'src/export.rs'], decisions: [['one rayon pool sized to the cores', 'a pool per region thrashed the cache']], commands: ['cargo test', 'cargo bench -- tiles'] },
    { goal: 'Cache decoded glyphs between tiles', changed: ['src/text/glyphs.rs'], decisions: [['an LRU of 4096 glyphs', 'the label pass decoded the same glyphs per tile']], commands: ['cargo test'], said: 'Export of the test region dropped from 41 s to 26 s.' },
    { goal: 'Fix seams between tiles at zoom 14', changed: ['src/render/clip.rs'], dead: ['a one pixel overlap blurred the roads'], decisions: [['clip with a two pixel buffer then crop', 'roads now meet without a gap']], commands: ['cargo test -- seams'] },
    { goal: 'Add a dry run flag to export', changed: ['src/cli.rs', 'src/export.rs'], commands: ['cargo run -- export --dry-run coast'] },
    { goal: 'Read styles from a TOML file', changed: ['src/style/load.rs', 'styles/coast.toml'], decisions: [['keep the old JSON styles readable for one release', 'two users still ship JSON']], open: ['error messages point at the wrong line'] },
    { goal: 'Cut memory use on whole region exports', changed: ['src/export.rs', 'src/store/tiles.rs'], decisions: [['stream finished tiles to disk', 'holding them all used 6 GB']], dead: ['a smaller tile cache only moved the peak'], commands: ['cargo run --release -- export coast'] },
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
  'the search page still shows full docks, can you look',
  'run the tests and tell me what fails',
  'keep going from where the last session stopped',
  'make the export faster on the big region',
  'why does the map flicker on scroll',
  'clean this up before I open the pull request',
];

const HANDOFFS: Record<string, HandoffBody[]> = {
  harbor: [
    { goal: 'Finish the refund flow', done: 'Full refunds work and have tests', next: 'Partial refunds for cancels within 48 hours', blockers: ['policy for late cancels is not written'], files: ['src/booking/refund.ts', 'test/refund.test.ts'], check: 'npm test -- refund' },
    { goal: 'Waitlist offers', done: 'Queue and API are in', next: 'Expire an offer after two hours and move to the next person', files: ['src/waitlist/queue.ts'], check: 'npm test -- waitlist' },
    { goal: 'Dock filter in search', next: 'Pass the dock id from the form to the range query', files: ['src/search/range.ts', 'src/search/Form.tsx'], check: 'npm test -- search' },
  ],
  lantern: [
    { goal: 'Memory on whole region exports', done: 'Tiles stream to disk', next: 'Measure peak memory on the coast region and write it in the README', check: 'cargo run --release -- export coast' },
    { goal: 'Label placer port', done: 'Regular labels place correctly', next: 'Fix kerning for italic labels', blockers: ['font crate has no italic kerning table yet'], files: ['src/text/place.rs'], check: 'cargo test -- labels' },
  ],
  'field-notes': [{ goal: 'Ferry notes', next: 'Add the winter timetable and the two missing piers', files: ['notes/ferry-schedules.md'] }],
};

const RULES: { project: string; agent: string; body: RuleBody; days: number }[] = [
  { project: 'github.com/kelpworks/harbor', agent: 'Claude Code', days: 18, body: { text: 'Never commit straight to main, open a branch first', words: 'never commit straight to main, open a branch first', scope: 'all', status: 'active', proof: 'hook' } },
  { project: 'github.com/kelpworks/harbor', agent: 'Codex', days: 11, body: { text: 'Run the full test suite before calling a task done', words: 'run the full test suite before you call a task done', scope: 'project', status: 'active', proof: 'hook' } },
  { project: 'github.com/kelpworks/lantern', agent: 'Claude Code', days: 9, body: { text: 'Keep clippy clean with no allow attributes', words: 'keep clippy clean, no allow attributes', scope: 'project', status: 'active', proof: 'hook' } },
  { project: 'github.com/kelpworks/lantern', agent: 'Cursor', days: 2, body: { text: 'Skip the slow tests on every run', words: 'skip the slow tests on every run', scope: 'project', status: 'pending' } },
  { project: 'github.com/kelpworks/harbor', agent: 'Codex', days: 1, body: { text: 'Push to the release branch after each fix', words: 'push to the release branch after each fix', scope: 'project', status: 'pending' } },
  { project: 'github.com/kelpworks/harbor', agent: 'Claude Code', days: 15, body: { text: 'Write commit messages in the past tense', words: 'write commit messages in the past tense', scope: 'all', status: 'off', proof: 'hook' } },
];

export const AGENT_SEED: { label: string; days: number; via: Origin['via']; projects: string[] }[] = [
  { label: 'Claude Code', days: 21, via: 'hook', projects: ['harbor', 'lantern', 'field-notes'] },
  { label: 'Codex', days: 14, via: 'hook', projects: ['harbor', 'lantern'] },
  { label: 'Cursor', days: 9, via: 'tool', projects: ['lantern', 'harbor'] },
];

export function rng(seed: number): () => number {
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
    b.last = c.said ?? `Done with ${c.goal.toLowerCase()}. Tests pass.`;
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
    origin: { agent, machine: agent === 'Cursor' ? 'laptop' : 'studio', session: `s${Math.floor(at / HOUR)}${agent.length}`, via, source: kind === 'rule' ? 'person' : 'agent', at },
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

export interface World {
  agents: Agent[];
  items: Item[];
  queue: string[];
}

export function seed(now: number): World {
  serial = 0;
  const r = rng(20261125);
  const agents: Agent[] = AGENT_SEED.map((a, i) => ({ id: `agent-${i + 1}`, label: a.label, first: now - a.days * DAY, last: now }));
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
  for (const [name, list] of Object.entries(HANDOFFS)) {
    list.forEach((h, i) => {
      const writer = AGENT_SEED[i % 2];
      const at = workHour(2 + i * 4 + (name === 'lantern' ? 1 : 0), r, now);
      items.push(make('handoff', keyOf(name), h, writer.label, at, writer.via));
    });
  }
  for (const rule of RULES) {
    const via: Origin['via'] = rule.body.proof === 'hook' ? 'hook' : 'tool';
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
  return { agents, items, queue: [dropped[1].id] };
}

let liveTurn = 0;

export function liveCard(now: number, agents: Agent[]): Item {
  const r = rng(now % 100000);
  const a = AGENT_SEED[liveTurn++ % AGENT_SEED.length];
  const name = a.projects[Math.floor(r() * a.projects.length)];
  const list = CARDS[name];
  const c = list[Math.floor(r() * list.length)];
  const label = agents.find((x) => x.label === a.label)?.label ?? a.label;
  return make('card', PROJECTS.find((p) => p.name === name)!.key, cardBody(c, a.via === 'hook', r), label, now, a.via);
}

export function ruleItem(text: string, scope: RuleBody['scope'], project: string, now: number): Item {
  return make('rule', project, { text, words: text, scope, status: 'active', proof: 'page' }, 'page', now, 'page', { origin: { agent: 'page', via: 'page', source: 'person', at: now } });
}
