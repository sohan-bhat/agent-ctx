import type { Agent, CardBody, HandoffBody, Item, Kind, Origin, Project, Read, RuleBody } from '@/lib/api';

const MIN = 60_000;
const start = new Date(2026, 9, 14, 8, 0, 0, 0).getTime();

export const DEMO_START = start;
export const DEMO_END = start + 10 * 60 * MIN;

const HARBOR = 'github.com/kelpworks/harbor';
const LANTERN = 'github.com/kelpworks/lantern';

export const DEMO_PROJECTS: Project[] = [
  { key: HARBOR, name: 'harbor', items: 0 },
  { key: LANTERN, name: 'lantern', items: 0 },
];

export const DEMO_AGENTS: Agent[] = ['Claude Code', 'Codex', 'Cursor'].map((label, i) => ({ id: `demo-${i}`, label, first: start, last: DEMO_END }));

type Row = [minute: number, agent: string, project: string, kind: Kind, body: Item['body'], extra?: Partial<Item>];

const card = (goal: string, paths: string[], decision?: [string, string], more: Partial<CardBody> = {}): CardBody => ({
  goal,
  changed: paths.map((path) => ({ path })),
  ...(decision ? { decisions: [{ what: decision[0], why: decision[1] }] } : {}),
  ...more,
});

const handoff: HandoffBody = {
  goal: 'Finish the refund flow',
  done: 'Full refunds are done and tested',
  next: 'Partial refunds for cancels within 48 hours',
  blockers: ['the late cancel policy is not written'],
  files: ['src/booking/refund.ts', 'test/refund.test.ts'],
  check: 'npm test -- refund',
};

const rule: RuleBody = { text: 'Never commit straight to main, open a branch first', words: 'never commit straight to main, open a branch first', scope: 'all', status: 'active', proof: 'elicit' };
const pending: RuleBody = { text: 'Skip the slow tests on every run', words: 'skip the slow tests on every run', scope: 'project', status: 'pending' };

const ROWS: Row[] = [
  [10, 'Claude Code', HARBOR, 'card', card('Add slip search by date range', ['src/search/range.ts', 'src/api/slips.ts'], ['store dates as UTC days', 'bookings were off by a day at local midnight'], { commands: ['npm test'] })],
  [30, 'Codex', LANTERN, 'card', card('Render tiles in parallel', ['src/render/mod.rs', 'src/export.rs'], ['one rayon pool sized to the cores', 'the cache was thrashed with a pool per region'])],
  [55, 'Claude Code', HARBOR, 'card', card('Stop double bookings from two quick taps', ['src/booking/reserve.ts'], ['lock the slip row in the transaction', 'the check was passed by two requests at once'], { dead_ends: ['app retries were not stopped by a debounce on the button'] })],
  [60, 'Cursor', LANTERN, 'card', card('Add a progress bar to long exports', ['src/cli.rs'])],
  [75, 'Codex', LANTERN, 'card', card('Cache decoded glyphs between tiles', ['src/text/glyphs.rs'], ['an LRU of 4096 glyphs', 'the same glyphs were decoded for every tile'], { commands: ['cargo test'] })],
  [100, 'Claude Code', HARBOR, 'card', card('Move the price table into the database', ['db/migrations/0014_prices.sql', 'src/pricing/table.ts'], ['one price row per dock and season', 'the JSON copies drifted'], { open: ['the JSON file is still read by the seed script'] })],
  [125, 'Codex', LANTERN, 'card', card('Fix seams between tiles at zoom 14', ['src/render/clip.rs'], ['clip with a two pixel buffer then crop', 'there is now no gap between roads'])],
  [140, 'Claude Code', HARBOR, 'rule', rule],
  [150, 'Cursor', LANTERN, 'card', card('Port the label placer to the new font crate', ['src/text/place.rs', 'Cargo.toml'], undefined, { open: ['kerning is off for italic labels'] })],
  [165, 'Claude Code', HARBOR, 'card', card('Write the refund flow for cancelled slips', ['src/booking/refund.ts', 'src/api/refunds.ts', 'test/refund.test.ts'], ['refund to the original card only', 'store credit has no policy page yet'], { commands: ['npm test -- refund'] })],
  [180, 'Codex', LANTERN, 'card', card('Add a dry run flag to export', ['src/cli.rs', 'src/export.rs'], undefined, { commands: ['cargo run -- export --dry-run coast'] })],
  [210, 'Claude Code', HARBOR, 'card', card('Send receipts after a booking', ['src/mail/receipt.ts', 'templates/receipt.mjml'])],
  [230, 'Codex', LANTERN, 'card', card('Read styles from a TOML file', ['src/style/load.rs', 'styles/coast.toml'], ['keep JSON styles readable for one release', 'two users still ship JSON'])],
  [255, 'Cursor', LANTERN, 'card', card('Show tile counts in the export summary', ['src/export.rs'])],
  [260, 'Claude Code', HARBOR, 'card', card('Add a waitlist for full docks', ['src/waitlist/queue.ts', 'src/api/waitlist.ts'], ['offer a freed slip to one person at a time', 'there was a rush when everyone got the offer'])],
  [270, 'Codex', LANTERN, 'dropped', { label: 'file src/export.rs', text: 'Read src/export.rs before the compaction', size: 21400 }],
  [270, 'Codex', LANTERN, 'dropped', { label: 'file src/render/clip.rs', text: 'Read src/render/clip.rs before the compaction', size: 9800 }],
  [270, 'Codex', LANTERN, 'dropped', { label: 'file styles/coast.toml', text: 'Read styles/coast.toml before the compaction', size: 6100 }],
  [270, 'Codex', LANTERN, 'dropped', { label: 'command cargo test', text: 'Output of cargo test before the compaction', size: 14200 }],
  [305, 'Claude Code', HARBOR, 'handoff', handoff],
  [312, 'Codex', HARBOR, 'card', card('Partial refunds for late cancels', ['src/booking/refund.ts', 'test/refund.test.ts'], ['refund half inside 48 hours', 'the policy gap was named in the handoff'], { commands: ['npm test -- refund'] })],
  [330, 'Cursor', LANTERN, 'card', card('Cut memory use on whole region exports', ['src/export.rs', 'src/store/tiles.rs'], ['stream finished tiles to disk', 'memory was at 6 GB with every tile held'])],
  [360, 'Codex', HARBOR, 'card', card('Page the admin booking list', ['src/admin/Bookings.tsx', 'src/api/admin.ts'], ['cursor pages on created time', 'rows were skipped with offset pages'])],
  [400, 'Cursor', LANTERN, 'card', card('Fix the label overlap at coast edges', ['src/text/place.rs'])],
  [430, 'Codex', HARBOR, 'card', card('Clean up booking form errors', ['src/booking/Form.tsx'], ['errors under each field', 'the top banner was missed on phones'])],
  [470, 'Cursor', LANTERN, 'rule', pending],
  [490, 'Codex', HARBOR, 'card', card('Speed up the dock map page', ['src/map/DockMap.tsx'], ['draw slips on one canvas', 'four hundred SVG nodes were slow to paint'])],
  [520, 'Cursor', LANTERN, 'card', card('Write the export guide', ['docs/export.md'])],
  [560, 'Codex', HARBOR, 'card', card('Add the dock filter to search', ['src/search/range.ts', 'src/search/Form.tsx'], undefined, { commands: ['npm test -- search'] })],
  [585, 'Cursor', LANTERN, 'card', card('Bump the font crate', ['Cargo.toml'])],
];

const via = (agent: string): Origin['via'] => (agent === 'Cursor' ? 'tool' : 'hook');

export const DEMO_ITEMS: Item[] = ROWS.map(([m, agent, project, kind, body, extra], i) => {
  const at = start + m * MIN;
  return {
    id: `d${i}`,
    project,
    kind,
    body,
    origin: { agent, session: `${agent}-${project}-${m < 300 ? 'am' : 'pm'}`, via: via(agent), source: kind === 'rule' && agent !== 'Cursor' ? 'person' : 'agent', at },
    flags: [],
    held: false,
    pinned: false,
    folded: false,
    created: at,
    ...extra,
  };
});

export const DEMO_READS: Read[] = DEMO_ITEMS.filter((i) => i.kind === 'handoff').map((i) => ({ item: i.id, agent: 'Codex', at: i.created + 7 * MIN }));
