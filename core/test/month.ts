export const MONTH_START = Date.UTC(2026, 9, 1, 8, 0, 0);
export const MONTH_DAYS = 30;
const HOUR = 3600000;
const DAY = 24 * HOUR;

export const PROJECTS = [
  { name: 'pantry', repo: 'https://github.com/acme/pantry', folder: '/work/pantry' },
  { name: 'kiln', repo: 'https://github.com/acme/kiln', folder: '/work/kiln' },
] as const;

export type Who = 0 | 1;
export type Project = 0 | 1;
export interface Checkpoint { goal: string; changed: string[]; decisions: string[]; dead_ends: string[]; open: string[]; commands: string[] }
export interface Piece { n: number; project: Project; feature: string; card: Checkpoint; facts: string[]; query: string; twin: number | null }
export type Label = { type: 'distinct' | 'exact' | 'reworded' | 'recalled'; piece: number } | { type: 'chat'; session: string };
export type Step =
  | { at: number; who: Who; project: Project; kind: 'checkpoint'; card: Checkpoint; label: Label }
  | { at: number; who: Who; project: Project; kind: 'recalled'; query: string; label: Label }
  | { at: number; who: Who; project: Project; kind: 'chat'; session: string; prompts: string[]; stop: string; label: Label };
export interface Month { seed: number; start: number; end: number; pieces: Piece[]; steps: Step[] }

const FEATURES = [
  ['expiry reminders', 'barcode scanner', 'shopping list', 'shelf labels', 'recipe import', 'price history', 'pantry search', 'household sharing', 'offline sync', 'login screen', 'push alerts', 'meal planner', 'stock counts', 'receipt reader', 'unit converter', 'allergy tags', 'bulk delete', 'csv export', 'dark theme', 'store map', 'coupon wallet', 'budget chart', 'freezer log', 'waste report', 'spice rack'],
  ['firing schedule', 'temperature log', 'glaze recipes', 'cone chart', 'kiln controller', 'over heat alarm', 'shelf layout', 'clay inventory', 'cost report', 'maintenance plan', 'photo upload', 'batch notes', 'cooling curve', 'user roles', 'nightly backup', 'element wear', 'vent timer', 'studio calendar', 'student accounts', 'pug mill log', 'glaze tests', 'wedging guide', 'bisque queue', 'slip casting', 'label printer'],
];
const AREAS = [
  ['alerts', 'scan', 'lists', 'print', 'recipes', 'prices', 'search', 'share', 'sync', 'auth', 'notify', 'plan', 'stock', 'ocr', 'units', 'tags', 'admin', 'export', 'theme', 'maps', 'coupons', 'budget', 'freezer', 'reports', 'spices'],
  ['schedule', 'sensors', 'glazes', 'cones', 'controller', 'alarms', 'layout', 'inventory', 'reports', 'upkeep', 'media', 'notes', 'curves', 'roles', 'backup', 'elements', 'vents', 'calendar', 'students', 'pugmill', 'tests', 'guides', 'queue', 'casting', 'printer'],
];
const VERBS: [string, string][] = [['Fix', 'Fixed'], ['Add', 'Added'], ['Build', 'Built'], ['Rework', 'Reworked'], ['Speed up', 'Sped up'], ['Clean up', 'Cleaned up'], ['Test', 'Tested'], ['Wire up', 'Wired up']];
const PARTS = ['flow', 'view', 'job', 'parser', 'endpoint', 'cache', 'form', 'worker'];
const CHOICES = ['a redis cache', 'a sqlite table', 'a cron job', 'a web worker', 'a debounce of 300 ms', 'retry with backoff', 'a feature flag', 'an append only log', 'optimistic updates', 'a bloom filter', 'server side paging', 'a write ahead queue', 'etag checks', 'a token bucket', 'lazy loading', 'a materialized view', 'idempotency keys', 'a ring buffer', 'utc timestamps everywhere', 'a json schema check', 'zod validation', 'a lru map', 'web sockets', 'long polling', 'a pub sub topic', 'a cursor api', 'soft deletes', 'row level locks', 'snapshot tests', 'a canary release', 'brotli compression', 'signed urls', 'a state machine', 'event sourcing', 'a circuit breaker', 'sharded counters', 'a dead letter queue', 'content hashing', 'a lookup table', 'two phase commit'];
const REASONS = ['the old path timed out on slow phones', 'support kept getting duplicate tickets', 'the free tier caps writes per day', 'tests flaked on the shared runner', 'users on trains lose signal', 'the vendor api rate limits us', 'memory spiked on large accounts', 'the report took nine seconds', 'clock skew broke ordering', 'the design review asked for it', 'translations broke the layout', 'we hit the bundle size budget', 'a customer lost data last spring', 'the old library is unmaintained', 'battery drain showed up in reviews', 'audit logs need every change', 'the night batch overlapped the day', 'search returned stale rows', 'a race showed up under load', 'screen readers skipped the button'];
const ALTS = ['a single global lock', 'polling every second', 'local storage only', 'a regex parser', 'the browser print dialog', 'a third party widget', 'nested transactions', 'a plain setInterval', 'client side sorting', 'one big json blob', 'image sprites', 'a shared mutable map', 'manual cache busting', 'synchronous xhr', 'a fixed thread pool'];
const FAILS = ['it deadlocked under two tabs', 'it drained the battery', 'safari dropped the data', 'it choked on nested quotes', 'margins broke on a4', 'it leaked tracking cookies', 'sqlite refused the nesting', 'timers drifted overnight', 'paging broke past ten thousand rows', 'the payload passed two megabytes', 'retina screens looked blurry', 'two writers clobbered each other', 'users saw stale pages for hours', 'the main thread froze', 'threads starved during import'];
const NEXTS = ['Measure', 'Document', 'Migrate', 'Localize', 'Load test', 'Review', 'Profile', 'Backfill'];
const OBJECTS = ['for older accounts', 'on the staging box', 'in the release notes', 'for the night batch', 'before the demo', 'with real data', 'on android', 'for admins'];
const DEVICES = ['an old ipad', 'a pixel phone', 'firefox', 'a slow laptop', 'the staging box'];
const CHAT = ['thanks', 'ok', 'continue', 'status', 'ok thanks', 'go on', 'looks good', 'yes', '/compact keep the last task', '# note for later today', 'thanks!', 'nice'];
const STOPS = ['You are welcome.', 'Done.', 'All set, nothing to change.', 'Status is unchanged.', 'Continuing.'];

function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/g, '-');
}

function shuffled<T>(list: T[], r: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function workHour(day: number, r: () => number): number {
  return MONTH_START + day * DAY + Math.floor(r() * 10 * HOUR) + Math.floor(r() * 60) * 1000;
}

function piecesFor(r: () => number): Piece[] {
  const choices = shuffled(CHOICES.map((_, k) => k), r);
  const pieces: Piece[] = [];
  let used = 0;
  const pick = () => CHOICES[choices[used++ % choices.length]];
  for (const project of [0, 1] as Project[]) {
    const order = shuffled(FEATURES[project].map((_, k) => k), r);
    const singles = order.slice(0, 20);
    const twins = order.slice(20, 25);
    const make = (k: number, twin: number | null, shared?: { verb: number; part: number }) => {
      const feature = FEATURES[project][k];
      const area = AREAS[project][k];
      const verb = shared?.verb ?? Math.floor(r() * VERBS.length);
      const part = shared?.part ?? Math.floor(r() * PARTS.length);
      const c1 = pick();
      const c2 = pick();
      const decisions = [`use ${c1} for the ${feature} because ${REASONS[Math.floor(r() * REASONS.length)]}`, `keep ${c2} in the ${area} module since ${REASONS[Math.floor(r() * REASONS.length)]}`];
      const dead_ends = [`tried ${ALTS[Math.floor(r() * ALTS.length)]} for the ${feature} but ${FAILS[Math.floor(r() * FAILS.length)]}`];
      const open = [`${NEXTS[Math.floor(r() * NEXTS.length)]} the ${feature} ${OBJECTS[Math.floor(r() * OBJECTS.length)]}`];
      const card: Checkpoint = {
        goal: `${VERBS[verb][0]} the ${feature} ${PARTS[part]}`,
        changed: [`src/${area}/${slug(feature)}.ts`, `test/${area}/${slug(feature)}.test.ts`],
        decisions,
        dead_ends,
        open,
        commands: [`npm test -- ${slug(feature)}`],
      };
      const n = pieces.length;
      pieces.push({ n, project, feature, card, facts: [...decisions, ...dead_ends, ...open], query: `${feature} ${c1.replace(/^an? /, '')}`, twin });
      return { verb, part, n };
    };
    for (const k of singles) make(k, null);
    for (const k of twins) {
      const first = make(k, null);
      const second = make(k, first.n, first);
      pieces[first.n].twin = second.n;
    }
  }
  return pieces;
}

function reworded(card: Checkpoint, feature: string, r: () => number): Checkpoint {
  const goalVerb = VERBS.find(([base]) => card.goal.startsWith(`${base} `));
  const goal = goalVerb ? `${goalVerb[1]}${card.goal.slice(goalVerb[0].length)}` : `Again ${card.goal}`;
  const out: Checkpoint = { goal, changed: [...card.changed].reverse(), decisions: [...card.decisions].reverse(), dead_ends: [...card.dead_ends], open: [...card.open], commands: [...card.commands] };
  const change = Math.floor(r() * 3);
  if (change === 0) out.open = [];
  if (change === 1) out.dead_ends = [...out.dead_ends, `checked the ${feature} again on ${DEVICES[Math.floor(r() * DEVICES.length)]}`];
  return out;
}

export function month(seed: number): Month {
  const r = rng(seed);
  const pieces = piecesFor(r);
  const steps: Step[] = [];
  const firstAt = new Map<number, number>();
  for (const p of pieces) {
    const at = workHour(Math.floor(r() * 18), r);
    firstAt.set(p.n, at);
    steps.push({ at, who: (r() < 0.5 ? 0 : 1) as Who, project: p.project, kind: 'checkpoint', card: p.card, label: { type: 'distinct', piece: p.n } });
  }
  const exactTwice = new Set(shuffled(pieces.map((p) => p.n), r).slice(0, 30));
  for (const p of pieces) {
    const kinds: ('exact' | 'reworded')[] = exactTwice.has(p.n) ? ['exact', 'exact', 'reworded'] : ['exact', 'reworded', 'reworded'];
    for (const type of kinds) {
      const at = Math.min(firstAt.get(p.n)! + 2 * HOUR + Math.floor(r() * 10 * DAY), MONTH_START + (MONTH_DAYS - 1) * DAY);
      const card = type === 'exact' ? p.card : reworded(p.card, p.feature, r);
      steps.push({ at, who: (r() < 0.5 ? 0 : 1) as Who, project: p.project, kind: 'checkpoint', card, label: { type, piece: p.n } });
    }
  }
  for (let k = 0; k < 30; k++) {
    const p = pieces[Math.floor(r() * pieces.length)];
    const at = Math.min(firstAt.get(p.n)! + HOUR + Math.floor(r() * 8 * DAY), MONTH_START + (MONTH_DAYS - 1) * DAY);
    steps.push({ at, who: (r() < 0.5 ? 0 : 1) as Who, project: p.project, kind: 'recalled', query: p.query, label: { type: 'recalled', piece: p.n } });
  }
  for (let k = 0; k < 60; k++) {
    const session = `chat-${seed}-${k}`;
    const prompts = Array.from({ length: 1 + Math.floor(r() * 4) }, () => CHAT[Math.floor(r() * CHAT.length)]);
    steps.push({ at: workHour(Math.floor(r() * MONTH_DAYS), r), who: (r() < 0.5 ? 0 : 1) as Who, project: (r() < 0.5 ? 0 : 1) as Project, kind: 'chat', session, prompts, stop: STOPS[Math.floor(r() * STOPS.length)], label: { type: 'chat', session } });
  }
  const order = steps.map((s, k) => ({ s, k })).sort((a, b) => a.s.at - b.s.at || a.k - b.k);
  return { seed, start: MONTH_START, end: MONTH_START + MONTH_DAYS * DAY, pieces, steps: order.map((x) => x.s) };
}
