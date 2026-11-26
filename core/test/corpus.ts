import type { CardBody, HandoffBody, Item, RuleBody } from '../src/model.ts';

export const NOW = Date.parse('2026-11-20T18:00:00Z');
const DAY = 86400000;

export const GALE = 'github.com/fernwood/gale-station';
export const PANTRY = 'github.com/fernwood/pantry-notes';
export const KNIGHT = 'github.com/fernwood/knightmare';
export const ROLL = 'folder:rollcall';

export const PROJECTS = [
  { key: GALE, names: ['weather station'] },
  { key: PANTRY, names: ['recipe site'] },
  { key: KNIGHT, names: ['chess engine'] },
  { key: ROLL, names: ['club app', 'sign up app'] },
];

let hour = 0;
function at(daysAgo: number): number {
  hour = (hour + 7) % 20;
  return NOW - daysAgo * DAY - hour * 3600000;
}

function base(id: string, project: string, daysAgo: number, agent: string, session?: string) {
  const t = at(daysAgo);
  return {
    id,
    project,
    origin: { agent, via: 'tool' as const, source: 'agent' as const, at: t, session: session ?? `${id}-s` },
    flags: [],
    held: false,
    pinned: false,
    folded: false,
    created: t,
  };
}

function card(id: string, project: string, daysAgo: number, agent: string, body: CardBody, session?: string): Item {
  return { ...base(id, project, daysAgo, agent, session), kind: 'card', body };
}

function handoff(id: string, project: string, daysAgo: number, agent: string, body: HandoffBody, session?: string): Item {
  return { ...base(id, project, daysAgo, agent, session), kind: 'handoff', body };
}

function rule(id: string, project: string, daysAgo: number, agent: string, words: string, scope: 'project' | 'all'): Item {
  const body: RuleBody = { text: words, words, scope, status: 'active', proof: 'hook' };
  return { ...base(id, project, daysAgo, agent), kind: 'rule', body };
}

const gale: Item[] = [
  card('gale-01', GALE, 58, 'codex', {
    goal: 'Bring up the BME280 sensor over I2C on the station board',
    changed: [{ path: 'firmware/src/sensors/bme280.c' }, { path: 'firmware/src/i2c_bus.c' }],
    decisions: [{ what: 'use the Bosch reference driver', why: 'the vendor compensation math is easy to get wrong' }],
    commands: ['pio run -e station', 'pio test -e native'],
    dead_ends: ['reading the sensor at 400 kHz caused bus errors on the long cable'],
    open: ['check humidity drift above 90 percent'],
  }),
  card('gale-02', GALE, 52, 'claude-code', {
    goal: 'Count anemometer pulses with the pulse counter peripheral',
    changed: [{ path: 'firmware/src/sensors/anemometer.c' }],
    decisions: [{ what: 'use the PCNT unit instead of a GPIO interrupt', why: 'interrupts dropped pulses above 30 m/s' }],
    open: ['calibrate the cups against the reference mast'],
  }),
  card('gale-03', GALE, 47, 'codex', {
    goal: 'Compute wind gusts as the highest 3 second average over 10 minutes',
    changed: [{ path: 'firmware/src/wind/gust.c' }, { path: 'firmware/test/test_gust/test_gust.c' }],
    decisions: [{ what: 'ring buffer of 200 samples', why: 'it fits in RTC slow memory' }],
    commands: ['pio test -e native -f test_gust'],
  }),
  card('gale-04', GALE, 44, 'cursor', {
    goal: 'Map wind vane resistance to a compass direction',
    changed: [{ path: 'firmware/src/sensors/vane.c' }],
    decisions: [{ what: 'lookup table of the 16 resistor values with the nearest match', why: 'the divider readings drift with temperature' }],
    dead_ends: ['linear interpolation between steps gave wrong headings near north'],
  }),
  card('gale-05', GALE, 40, 'codex', {
    goal: 'Deep sleep between readings to stretch the battery',
    changed: [{ path: 'firmware/src/power/sleep.c' }],
    decisions: [{ what: 'wake every 60 seconds from the ULP timer', why: 'the radio stays off most of the time' }],
    dead_ends: ['light sleep kept the radio warm and drew 20 mA'],
    open: ['measure current draw with the bench meter'],
  }),
  card('gale-06', GALE, 35, 'claude-code', {
    goal: 'Cache the last good reading in RTC memory so a brownout does not lose it',
    changed: [{ path: 'firmware/src/storage/rtc_cache.c' }],
    decisions: [{ what: 'write a CRC next to the cached reading', why: 'a torn write after a brownout looked valid' }],
  }),
  card('gale-07', GALE, 30, 'gemini', {
    goal: 'Send readings over LoRa to the base station',
    changed: [{ path: 'firmware/src/radio/lora.c' }],
    decisions: [{ what: 'spreading factor 9', why: 'SF12 airtime broke the duty cycle limit' }],
    commands: ['pio run -t upload'],
    open: ['add retries with backoff when no ack arrives'],
  }),
  card('gale-08', GALE, 25, 'codex', {
    goal: 'Tipping bucket rain gauge with debounce',
    changed: [{ path: 'firmware/src/sensors/rain.c' }],
    decisions: [{ what: 'debounce the reed switch for 50 ms', why: 'one tip registered as three' }],
  }),
  card('gale-09', GALE, 19, 'claude-code', {
    goal: 'Build the firmware in CI with PlatformIO',
    changed: [{ path: '.github/workflows/firmware.yml' }],
    decisions: [{ what: 'cache the platformio packages folder in CI', why: 'the toolchain download took four minutes' }],
    commands: ['pio run -e station', 'pio test -e native'],
  }),
  card('gale-10', GALE, 12, 'cursor', {
    goal: 'Over the air updates from the base station',
    changed: [{ path: 'firmware/src/ota/update.c' }, { path: 'firmware/partitions.csv' }],
    decisions: [{ what: 'two app partitions with rollback', why: 'a bad image must not brick a station on the roof' }],
    open: ['sign images before the first field install'],
  }),
  card('gale-11', GALE, 6, 'codex', {
    goal: 'Fix the clock drift that shifted timestamps by minutes a day',
    changed: [{ path: 'firmware/src/time/rtc_sync.c' }],
    decisions: [{ what: 'sync the RTC from GPS time once a day', why: 'the crystal drifts on cold nights' }],
    dead_ends: ['NTP over LoRa was too chatty'],
  }),
  card(
    'gale-12',
    GALE,
    2,
    'claude-code',
    {
      goal: 'Add a solar panel voltage reading to the status packet',
      prompts: ['Add a solar panel voltage reading to the status packet', 'Also report it in millivolts'],
      changed: [{ path: 'firmware/src/power/solar.c' }, { path: 'firmware/src/radio/packet.c' }],
      commands: ['pio test -e native'],
      last: 'Solar voltage now goes out in the status packet as millivolts.',
      auto: true,
    },
    'gale-live',
  ),
  handoff(
    'gale-h1',
    GALE,
    1,
    'claude-code',
    {
      goal: 'Add solar panel voltage to the status packet',
      done: 'Reading and packet field added',
      next: 'Calibrate the divider against the bench supply',
      files: ['firmware/src/power/solar.c', 'firmware/src/radio/packet.c'],
      check: 'pio test -e native',
    },
    'gale-live',
  ),
  rule('gale-r1', GALE, 33, 'codex', 'always run pio test -e native before you flash', 'project'),
  rule('gale-r2', GALE, 16, 'claude-code', 'never commit the wifi credentials file', 'all'),
];

const pantry: Item[] = [
  card('pantry-01', PANTRY, 59, 'cursor', {
    goal: 'Set up the recipe pages with static generation',
    changed: [{ path: 'app/recipes/[slug]/page.tsx' }],
    decisions: [{ what: 'generate pages at build time from markdown files', why: 'recipes change rarely and pages load instantly' }],
  }),
  card('pantry-02', PANTRY, 54, 'codex', {
    goal: 'Scale ingredient amounts when the reader changes servings',
    changed: [{ path: 'lib/scale.ts' }, { path: 'components/Servings.tsx' }],
    decisions: [{ what: 'store amounts as fractions', why: 'a third of a cup times three must give one cup and not 0.999' }],
    dead_ends: ['floating point amounts printed 0.333 cups'],
  }),
  card('pantry-03', PANTRY, 49, 'claude-code', {
    goal: 'Unit conversion between metric and US cups',
    changed: [{ path: 'lib/units.ts' }],
    decisions: [{ what: 'convert flour and sugar through an ingredient density table', why: 'a cup of flour and a cup of water weigh different amounts' }],
    open: ['add butter in sticks'],
  }),
  card('pantry-04', PANTRY, 45, 'codex', {
    goal: 'Full text search over recipes',
    changed: [{ path: 'lib/search/index.ts' }, { path: 'scripts/build-search.ts' }],
    decisions: [{ what: 'build a MiniSearch index during the build and ship it as JSON', why: 'the free host runs no search server' }],
    commands: ['npm run build'],
  }),
  card('pantry-05', PANTRY, 41, 'cursor', {
    goal: 'Login with magic links for saving favorites',
    changed: [{ path: 'app/api/auth/route.ts' }, { path: 'lib/session.ts' }],
    decisions: [{ what: 'magic links over passwords', why: 'fewer support requests about resets' }],
    dead_ends: ['OAuth with Google needed a verified domain we do not have yet'],
  }),
  card('pantry-06', PANTRY, 36, 'gemini', {
    goal: 'Cache recipe images through the image CDN',
    changed: [{ path: 'next.config.js' }],
    decisions: [{ what: 'set a one year cache header on hashed image URLs', why: 'the origin bucket is slow and costs egress' }],
    open: ['purge the old image when a photo is replaced'],
  }),
  card('pantry-07', PANTRY, 31, 'claude-code', {
    goal: 'Shopping list built from selected recipes',
    changed: [{ path: 'app/list/page.tsx' }, { path: 'lib/list.ts' }],
    decisions: [{ what: 'merge the same ingredient across recipes by unit', why: 'two recipes that both need onions should give one line' }],
  }),
  card('pantry-08', PANTRY, 26, 'codex', {
    goal: 'Print friendly recipe layout',
    changed: [{ path: 'app/recipes/[slug]/print.css' }],
    decisions: [{ what: 'hide comments and photos in print', why: 'a recipe should fit on one sheet' }],
  }),
  card('pantry-09', PANTRY, 20, 'cursor', {
    goal: 'Nutrition facts per serving',
    changed: [{ path: 'lib/nutrition.ts' }],
    decisions: [{ what: 'use the USDA FoodData table offline', why: 'the API rate limit is low' }],
    dead_ends: ['scraping labels from product sites broke every week'],
    open: ['handle missing entries for spices'],
  }),
  card('pantry-10', PANTRY, 14, 'codex', {
    goal: 'Fix the build and test failures after the Next upgrade',
    changed: [{ path: 'package.json' }, { path: 'app/layout.tsx' }],
    decisions: [{ what: 'pin the next version', why: 'the canary changed the metadata API' }],
    commands: ['npm test', 'npm run build'],
    dead_ends: ['the codemod did not cover the custom document'],
  }),
  card('pantry-11', PANTRY, 7, 'claude-code', {
    goal: 'Comments on recipes with spam filtering',
    changed: [{ path: 'app/api/comments/route.ts' }],
    decisions: [{ what: 'hold comments with links for review', why: 'spam bots post links' }],
    open: ['email the author on a new comment'],
  }),
  card(
    'pantry-12',
    PANTRY,
    3,
    'gemini',
    {
      goal: 'Add a dark mode toggle to the header',
      prompts: ['Add a dark mode toggle to the header', 'Remember the choice across visits'],
      changed: [{ path: 'components/ThemeToggle.tsx' }, { path: 'app/layout.tsx' }],
      last: 'Dark mode toggle added and the choice is kept in local storage.',
      auto: true,
    },
    'pantry-live',
  ),
  handoff(
    'pantry-h1',
    PANTRY,
    2,
    'gemini',
    { goal: 'Dark mode toggle', done: 'Toggle and storage done', next: 'Fix contrast on the ingredient chips in dark mode', files: ['components/ThemeToggle.tsx'] },
    'pantry-live',
  ),
  handoff('pantry-h2', PANTRY, 10, 'codex', { goal: 'Nutrition facts per serving', next: 'Handle spices that have no entry in the table' }),
  rule('pantry-r1', PANTRY, 50, 'codex', 'keep recipe amounts as fractions in the data', 'project'),
  rule('pantry-r2', PANTRY, 22, 'cursor', 'use pnpm for every install', 'all'),
];

const knight: Item[] = [
  card('knight-01', KNIGHT, 60, 'codex', {
    goal: 'Bitboard move generation for all pieces',
    changed: [{ path: 'src/movegen/mod.rs' }, { path: 'src/bitboard.rs' }],
    decisions: [{ what: 'magic bitboards for sliding pieces', why: 'they beat ray loops by a wide margin' }],
    commands: ['cargo test'],
  }),
  card('knight-02', KNIGHT, 55, 'claude-code', {
    goal: 'Perft test suite to check move generation',
    changed: [{ path: 'tests/perft.rs' }],
    decisions: [{ what: 'compare against known perft counts for six positions', why: 'one wrong castling rule shows up at depth 4' }],
    commands: ['cargo test --release perft'],
    dead_ends: ['comparing against another engine live was too slow'],
  }),
  card('knight-03', KNIGHT, 50, 'codex', {
    goal: 'Alpha beta search with iterative deepening',
    changed: [{ path: 'src/search/alphabeta.rs' }],
    decisions: [{ what: 'principal variation search', why: 'fewer nodes than plain alpha beta when ordering is good' }],
  }),
  card('knight-04', KNIGHT, 46, 'cursor', {
    goal: 'Transposition table cache keyed by Zobrist hashes',
    changed: [{ path: 'src/search/tt.rs' }, { path: 'src/zobrist.rs' }],
    decisions: [{ what: 'replace by depth with an always replace bucket', why: 'deep entries were thrown out by shallow ones' }],
    dead_ends: ['a HashMap was too slow and used too much memory'],
  }),
  card('knight-05', KNIGHT, 42, 'codex', {
    goal: 'Move ordering with killer moves and the history heuristic',
    changed: [{ path: 'src/search/ordering.rs' }],
    decisions: [{ what: 'try the hash move first, then captures by MVV LVA', why: 'cutoffs come early' }],
  }),
  card('knight-06', KNIGHT, 37, 'claude-code', {
    goal: 'UCI protocol so the engine runs in a GUI',
    changed: [{ path: 'src/uci.rs' }],
    decisions: [{ what: 'parse wtime and btime from go for time control', why: 'GUIs send the clock times every move' }],
    open: ['support ponder'],
  }),
  card('knight-07', KNIGHT, 32, 'gemini', {
    goal: 'Detect threefold repetition and the fifty move rule',
    changed: [{ path: 'src/position/history.rs' }],
    decisions: [{ what: 'store Zobrist keys of past positions since the last capture', why: 'a repetition can only follow reversible moves' }],
  }),
  card('knight-08', KNIGHT, 27, 'codex', {
    goal: 'Static evaluation with piece square tables',
    changed: [{ path: 'src/eval/pst.rs' }],
    decisions: [{ what: 'tapered eval between middlegame and endgame', why: 'the king should hide early and walk late' }],
    open: ['tune the tables with Texel tuning'],
  }),
  card('knight-09', KNIGHT, 21, 'cursor', {
    goal: 'Quiescence search to stop the horizon effect',
    changed: [{ path: 'src/search/quiesce.rs' }],
    decisions: [{ what: 'delta pruning in quiescence', why: 'it cut nodes by a third without losing strength' }],
  }),
  card('knight-10', KNIGHT, 15, 'codex', {
    goal: 'Build a release binary with LTO for the tournament',
    changed: [{ path: 'Cargo.toml' }],
    decisions: [{ what: 'set codegen units to 1 and lto to fat', why: 'it gave 8 percent more nodes per second' }],
    commands: ['cargo build --release'],
  }),
  card('knight-11', KNIGHT, 8, 'claude-code', {
    goal: 'Opening book from a Polyglot file',
    changed: [{ path: 'src/book.rs' }],
    decisions: [{ what: 'read the Polyglot bin format', why: 'most GUIs ship books in it' }],
    dead_ends: ['building our own book from PGN games took too long'],
  }),
  card(
    'knight-12',
    KNIGHT,
    3,
    'codex',
    {
      goal: 'Add a test for the en passant pin bug',
      prompts: ['Add a test for the en passant pin bug', 'The engine played an illegal en passant while the king was pinned'],
      changed: [{ path: 'src/movegen/pawn.rs' }, { path: 'tests/en_passant.rs' }],
      commands: ['cargo test en_passant'],
      last: 'Fixed the pin check for en passant and added a regression test.',
      auto: true,
    },
    'knight-live',
  ),
  handoff(
    'knight-h1',
    KNIGHT,
    2,
    'codex',
    { goal: 'Fix the illegal en passant under a pin', done: 'Fix and test merged', next: 'Run the full perft suite at depth 6 before the tournament', files: ['src/movegen/pawn.rs'] },
    'knight-live',
  ),
  rule('knight-r1', KNIGHT, 40, 'codex', 'run perft at depth five before every merge', 'project'),
  rule('knight-r2', KNIGHT, 18, 'claude-code', 'never use unsafe code in the engine', 'project'),
];

const roll: Item[] = [
  card('roll-01', ROLL, 57, 'claude-code', {
    goal: 'Event sign up form with a capacity limit',
    changed: [{ path: 'src/routes/events/[id]/signup.ts' }, { path: 'src/db/schema.sql' }],
    decisions: [{ what: 'check capacity inside a database transaction', why: 'two people grabbed the last spot at once' }],
  }),
  card('roll-02', ROLL, 51, 'codex', {
    goal: 'Waitlist when an event is full',
    changed: [{ path: 'src/routes/events/waitlist.ts' }],
    decisions: [{ what: 'promote the first person on the waitlist when someone cancels', why: 'leaders asked for no manual work' }],
    open: ['email the promoted person'],
  }),
  card('roll-03', ROLL, 48, 'cursor', {
    goal: 'Login with the school Google accounts',
    changed: [{ path: 'src/auth/google.ts' }],
    decisions: [{ what: 'restrict sign in to the school domain', why: 'only students may join clubs' }],
    dead_ends: ['magic links landed in the school spam filter'],
  }),
  card('roll-04', ROLL, 43, 'claude-code', {
    goal: 'Club leader dashboard with attendance',
    changed: [{ path: 'src/routes/dashboard.tsx' }],
    decisions: [{ what: 'count attendance from check ins and not from sign ups', why: 'many people sign up and never come' }],
  }),
  card('roll-05', ROLL, 39, 'codex', {
    goal: 'QR code check in at the door',
    changed: [{ path: 'src/routes/checkin.ts' }, { path: 'src/lib/qr.ts' }],
    decisions: [{ what: 'sign the QR payload with an HMAC', why: "screenshots of a friend's code were reused" }],
  }),
  card('roll-06', ROLL, 34, 'gemini', {
    goal: 'Reminder emails the day before an event',
    changed: [{ path: 'src/jobs/reminders.ts' }],
    decisions: [{ what: 'send through the transactional email API with a queue', why: 'the free tier cron slept through the job' }],
    dead_ends: ['a setTimeout in the server process lost jobs on deploy'],
  }),
  card('roll-07', ROLL, 29, 'claude-code', {
    goal: 'Export the roster as CSV for club leaders',
    changed: [{ path: 'src/routes/export.ts' }],
    decisions: [{ what: 'stream rows instead of building the file in memory', why: 'big clubs timed out' }],
  }),
  card('roll-08', ROLL, 24, 'codex', {
    goal: 'Cache the club list page',
    changed: [{ path: 'src/routes/clubs.tsx' }],
    decisions: [{ what: 'cache the club list for 60 seconds at the edge', why: 'every student hits the page at the start of term' }],
  }),
  card('roll-09', ROLL, 18, 'cursor', {
    goal: 'Parent consent for students under 13',
    changed: [{ path: 'src/routes/consent.ts' }],
    decisions: [{ what: 'block sign up until a parent approves by email', why: 'the school policy requires it' }],
    open: ['remind parents after two days'],
  }),
  card('roll-10', ROLL, 13, 'codex', {
    goal: 'Fix the flaky end to end test for sign up',
    changed: [{ path: 'tests/e2e/signup.spec.ts' }],
    decisions: [{ what: 'seed a fresh database per test', why: 'tests shared one event and raced' }],
    commands: ['npm test', 'npx playwright test'],
  }),
  card('roll-11', ROLL, 9, 'claude-code', {
    goal: 'Deploy to the free host with a build step',
    changed: [{ path: 'fly.toml' }, { path: 'Dockerfile' }],
    decisions: [{ what: 'run migrations on release', why: 'the app crashed on a missing column after a deploy' }],
    commands: ['fly deploy'],
  }),
  card(
    'roll-12',
    ROLL,
    4,
    'codex',
    {
      goal: 'Let leaders message everyone on the waitlist',
      prompts: ['Let leaders message everyone on the waitlist', 'Keep it to one message a day'],
      changed: [{ path: 'src/routes/broadcast.ts' }],
      last: 'Leaders can now send one message a day to the waitlist.',
      auto: true,
    },
    'roll-live',
  ),
  handoff(
    'roll-h1',
    ROLL,
    3,
    'codex',
    { goal: 'Waitlist broadcast', done: 'Route and rate limit done', next: 'Add the message form to the dashboard', files: ['src/routes/broadcast.ts', 'src/routes/dashboard.tsx'] },
    'roll-live',
  ),
  rule('roll-r1', ROLL, 45, 'cursor', 'store every time in UTC in the database', 'project'),
  rule('roll-r2', ROLL, 11, 'claude-code', 'ask before you run migrations on production', 'all'),
];

export const ITEMS: Item[] = [...gale, ...pantry, ...knight, ...roll];

export type QueryKind = 'answer' | 'none' | 'chat' | 'cross';
export interface Query { q: string; project: string; kind: QueryKind; want: string[] }

const answer = (project: string, q: string, ...want: string[]): Query => ({ q, project, kind: 'answer', want });
const none = (project: string, q: string): Query => ({ q, project, kind: 'none', want: [] });
const chat = (project: string, q: string): Query => ({ q, project, kind: 'chat', want: [] });
const cross = (project: string, q: string, ...want: string[]): Query => ({ q, project, kind: 'cross', want });

export const QUERIES: Query[] = [
  answer(GALE, 'which driver do we use for the BME280 and why', 'gale-01'),
  answer(GALE, 'why did we switch the anemometer to the pulse counter', 'gale-02'),
  answer(GALE, 'how is the gust computed', 'gale-03'),
  answer(GALE, 'wind vane heading lookup table', 'gale-04'),
  answer(GALE, 'what wakes the station from deep sleep', 'gale-05'),
  answer(GALE, 'LoRa spreading factor and duty cycle', 'gale-07'),
  answer(GALE, 'the reed switch on the rain gauge counted triple tips', 'gale-08'),
  answer(GALE, 'how do OTA updates roll back a bad image', 'gale-10'),
  answer(PANTRY, 'how do we scale servings without rounding errors', 'pantry-02'),
  answer(PANTRY, 'flour cup to grams conversion', 'pantry-03'),
  answer(PANTRY, 'how does recipe search work without a server', 'pantry-04'),
  answer(PANTRY, 'why magic links for favorites', 'pantry-05'),
  answer(PANTRY, 'image CDN cache headers', 'pantry-06'),
  answer(PANTRY, 'shopping list merging duplicate ingredients', 'pantry-07'),
  answer(PANTRY, 'where does the nutrition data come from', 'pantry-09'),
  answer(PANTRY, 'spam filtering for recipe comments', 'pantry-11'),
  answer(KNIGHT, 'how are sliding piece moves generated', 'knight-01'),
  answer(KNIGHT, 'which perft positions do we check', 'knight-02'),
  answer(KNIGHT, 'transposition table replacement scheme', 'knight-04'),
  answer(KNIGHT, 'how do we detect threefold repetition', 'knight-07'),
  answer(KNIGHT, 'where do we use zobrist hashes', 'knight-04', 'knight-07'),
  answer(KNIGHT, 'LTO settings for the release binary', 'knight-10'),
  answer(KNIGHT, 'polyglot opening book format', 'knight-11'),
  answer(ROLL, 'two people took the last spot at the same time', 'roll-01'),
  answer(ROLL, 'who gets promoted from the waitlist', 'roll-02'),
  answer(ROLL, 'restrict google sign in to the school domain', 'roll-03'),
  answer(ROLL, 'QR check in screenshots reused', 'roll-05'),
  answer(ROLL, 'reminder emails did not send on the free tier', 'roll-06'),
  answer(ROLL, 'roster CSV export timing out', 'roll-07'),
  answer(ROLL, 'parent consent for younger students', 'roll-09'),
  none(GALE, 'set up stripe checkout for the subscription plan'),
  none(GALE, 'how did we style the login page'),
  none(PANTRY, 'what is the kubernetes ingress config'),
  none(PANTRY, 'how did we tune the PID loop for the heater'),
  none(KNIGHT, 'add a password reset email flow'),
  none(KNIGHT, 'how do we cache images on the CDN'),
  none(KNIGHT, 'which database migrations run on deploy'),
  none(ROLL, 'how fast is the move generator in nodes per second'),
  none(ROLL, 'BME280 humidity calibration'),
  none(ROLL, 'add push notifications to the iOS app'),
  chat(GALE, 'ok continue'),
  chat(PANTRY, 'looks good'),
  chat(KNIGHT, 'sounds great, keep going'),
  chat(ROLL, 'yes do that'),
  chat(GALE, 'thanks, carry on'),
  cross(PANTRY, 'how did the chess engine detect threefold repetition', 'knight-07'),
  cross(GALE, 'what did we decide about magic links on the recipe site', 'pantry-05'),
  cross(KNIGHT, 'how does rollcall check capacity for the last spot', 'roll-01'),
  cross(ROLL, 'how does gale-station cache the last good reading', 'gale-06'),
  cross(KNIGHT, 'which spreading factor does the weather station use for LoRa', 'gale-07'),
];
