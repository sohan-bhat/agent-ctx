import type { CardBody, HandoffBody, Item, RuleBody } from '../src/model.ts';
import { autoCard, type Ev } from '../src/events.ts';
import { GALE, KNIGHT, NOW, PANTRY, PROJECTS, ROLL } from './corpus.ts';

export { NOW, PROJECTS };

const DAY = 86400000;
let tick = 0;
function at(daysAgo: number): number {
  tick = (tick + 5) % 19;
  return NOW - daysAgo * DAY - tick * 3600000;
}

function base(id: string, project: string, daysAgo: number, agent: string) {
  const t = at(daysAgo);
  return { id, project, origin: { agent, via: 'tool' as const, source: 'agent' as const, at: t, session: `${id}-s` }, flags: [], held: false, pinned: false, folded: false, created: t };
}

interface C { f?: string[]; d?: [string, string][]; r?: string[]; x?: string[]; o?: string[] }

function c(id: string, project: string, daysAgo: number, agent: string, goal: string, m: C = {}): Item {
  const body: CardBody = { goal };
  if (m.f) body.changed = m.f.map((path) => ({ path }));
  if (m.d) body.decisions = m.d.map(([what, why]) => ({ what, why }));
  if (m.r) body.commands = m.r;
  if (m.x) body.dead_ends = m.x;
  if (m.o) body.open = m.o;
  return { ...base(id, project, daysAgo, agent), kind: 'card', body };
}

function auto(id: string, project: string, daysAgo: number, agent: string, prompt: string, files: string[], commands: [string, boolean][], stop: string): Item {
  const b = base(id, project, daysAgo, agent);
  const t = b.created - 3600000;
  const evs: Ev[] = [{ t: 'prompt', at: t, text: prompt }];
  files.forEach((path, k) => evs.push({ t: 'edit', at: t + (k + 1) * 60000, path }));
  commands.forEach(([text, ok], k) => evs.push({ t: 'command', at: t + (files.length + k + 1) * 60000, text, ok }));
  evs.push({ t: 'stop', at: t + 3000000, text: stop });
  return { ...b, kind: 'card', body: autoCard(evs) as CardBody };
}

function h(id: string, project: string, daysAgo: number, agent: string, body: HandoffBody): Item {
  return { ...base(id, project, daysAgo, agent), kind: 'handoff', body };
}

function rule(id: string, project: string, daysAgo: number, agent: string, words: string, scope: 'project' | 'all'): Item {
  const body: RuleBody = { text: words, words, scope, status: 'active', proof: 'hook' };
  return { ...base(id, project, daysAgo, agent), kind: 'rule', body };
}

const G = GALE;
const gale: Item[] = [
  c('g01', G, 58, 'codex', 'Bring up the BME280 over I2C on the station board', { f: ['firmware/src/sensors/bme280.c'], d: [['use the Bosch reference driver', 'the compensation math is easy to get wrong']], x: ['400 kHz I2C gave bus errors on the long cable'], r: ['pio test -e native'] }),
  c('g02', G, 54, 'claude-code', 'Count anemometer pulses with the PCNT peripheral', { f: ['firmware/src/sensors/anemometer.c'], d: [['PCNT unit instead of a GPIO interrupt', 'interrupts dropped pulses above 30 m/s']] }),
  c('g03', G, 50, 'cursor', 'Wind vane direction from the resistor ladder', { f: ['firmware/src/sensors/vane.c'], d: [['nearest match lookup over the 16 ladder values', 'divider readings drift with temperature']], x: ['linear interpolation gave wrong headings near north'] }),
  c('g04', G, 47, 'codex', 'Rain gauge reed switch debounce', { f: ['firmware/src/sensors/rain.c'], d: [['50 ms debounce on the reed switch', 'one bucket tip counted as three']] }),
  c('g05', G, 44, 'gemini', 'Humidity reads 100 percent after fog', { f: ['firmware/src/sensors/bme280.c'], d: [['turn on the BME280 heater for 2 seconds after saturation', 'condensation on the sensor kept it pinned at 100']], o: ['check whether the heater skews the temperature reading'] }),
  c('g06', G, 41, 'codex', 'Lightning sensor AS3935 on SPI', { f: ['firmware/src/sensors/lightning.c'], d: [['mask disturber events', 'the radio itself triggered false strikes']] }),
  c('g07', G, 38, 'claude-code', 'Deep sleep between readings', { f: ['firmware/src/power/sleep.c'], d: [['wake every 10 seconds from the ULP timer', 'the radio stays off most of the time']], x: ['light sleep drew 20 mA'] }),
  c('g08', G, 35, 'codex', 'Keep the last good reading across a brownout', { f: ['firmware/src/storage/rtc_cache.c'], d: [['cache the reading in RTC memory with a CRC', 'a torn write after a brownout looked valid']] }),
  c('g09', G, 33, 'cursor', 'Clock drift fix', { f: ['firmware/src/time/rtc_sync.c'], d: [['sync the RTC from GPS once a day', 'the crystal drifts on cold nights']], x: ['NTP over LoRa was too chatty'] }),
  c('g10', G, 31, 'codex', 'LoRa link to the base station', { f: ['firmware/src/radio/lora.c'], d: [['spreading factor 9', 'SF12 airtime broke the duty cycle limit']] }),
  c('g11', G, 29, 'gemini', 'Packet format for readings', { f: ['firmware/src/radio/packet.c'], d: [['fixed 24 byte binary packet with a CRC16', 'JSON did not fit in one LoRa frame']], o: ['two spare bytes left at the end of the packet'] }),
  c('g12', G, 27, 'claude-code', 'Retries when the base station misses a packet', { f: ['firmware/src/radio/lora.c'], d: [['three retries with random backoff', 'two stations collided on the same slot']] }),
  c('g13', G, 25, 'codex', 'Base station receiver service', { f: ['base/cmd/receiver/main.go'], d: [['a small Go service on the Raspberry Pi writes readings to SQLite', 'Python on the Pi missed packets under load']] }),
  c('g14', G, 55, 'cursor', 'Live wind chart on the dashboard', { f: ['dashboard/src/WindChart.tsx'], d: [['uPlot for the charts', 'Chart.js was too heavy for the Pi browser']] }),
  c('g15', G, 43, 'codex', 'Wind chart units', { f: ['dashboard/src/WindChart.tsx', 'dashboard/src/units.ts'], d: [['toggle between knots and meters per second with knots as the default', 'the sailing club reads knots']] }),
  c('g16', G, 31, 'claude-code', 'Wind chart flickered on every redraw', { f: ['dashboard/src/WindChart.tsx'], d: [['draw into an offscreen canvas and swap it in', 'clearing the visible canvas each tick caused the flicker']], x: ['requestAnimationFrame alone did not stop it'] }),
  c('g17', G, 19, 'cursor', 'Wind chart refresh rate', { f: ['dashboard/src/api/poll.ts'], d: [['poll the API every 10 seconds', 'stations only send a reading every 10 seconds']], o: ['push updates over a websocket instead of polling'] }),
  auto('g18', G, 7, 'claude-code', 'add gust markers to the wind chart, red dots where the gust is above 25 knots', ['dashboard/src/WindChart.tsx'], [['npm test', true]], 'Gust markers drawn as red dots above 25 knots.'),
  c('g19', G, 52, 'codex', 'Dashboard login', { f: ['dashboard/server/auth.ts'], d: [['basic auth behind the club VPN', 'only five people use it']] }),
  c('g20', G, 36, 'claude-code', 'Replace basic auth with passkeys on the dashboard login', { f: ['dashboard/server/auth.ts', 'dashboard/src/pages/login.tsx'], d: [['WebAuthn passkeys', 'members kept sharing the one password']], x: ['magic links needed an SMTP relay the Pi cannot reach'] }),
  c('g21', G, 22, 'gemini', 'Login session expired every hour on the wall display', { f: ['dashboard/server/session.ts'], d: [['30 day session cookie for the kiosk user only', 'the clubhouse screen logged out overnight']] }),
  auto('g22', G, 9, 'codex', 'the login page is blank on safari, check the passkey button', ['dashboard/src/pages/login.tsx'], [['npx playwright test login', false], ['npx playwright test login', true]], 'Safari needed the conditional mediation check before showing the passkey button.'),
  c('g23', G, 40, 'codex', 'Cache the station list in the dashboard API', { f: ['base/api/stations.go'], d: [['cache the list for 60 seconds in memory', 'every chart asked SQLite for the same list']] }),
  c('g24', G, 15, 'cursor', 'Stale readings after a station reboot', { f: ['base/api/stations.go'], d: [['drop the API cache entry when a station sends a boot packet', "the dashboard showed yesterday's reading for a minute"]] }),
  c('g25', G, 49, 'claude-code', 'Unit tests for the gust filter on the native env', { f: ['firmware/test/test_gust/test_gust.c'], d: [['run the filter tests with pio test -e native in CI', 'no board is needed']], r: ['pio test -e native'] }),
  c('g26', G, 30, 'codex', 'Hardware in the loop test rig', { f: ['rig/run.py', 'rig/README.md'], d: [['drive the anemometer input from a signal generator on a spare board', 'spinning the cups by hand was not repeatable']] }),
  c('g27', G, 13, 'gemini', 'Flaky packet decoder test', { f: ['base/radio/decoder_test.go'], d: [['seed the random backoff in tests', 'the test raced the retry timer']], r: ['go test ./...'] }),
  c('g28', G, 45, 'cursor', 'Deploy the dashboard to the Pi', { f: ['deploy/dashboard.service', 'deploy/deploy.sh'], d: [['systemd unit and a deploy script over ssh', 'no container runtime on the Pi']] }),
  c('g29', G, 24, 'codex', 'Over the air firmware updates', { f: ['firmware/src/ota/update.c', 'firmware/partitions.csv'], d: [['two app partitions with rollback', 'a bad image must not brick a station on the roof']] }),
  c('g30', G, 11, 'claude-code', 'Deploy broke the dashboard after the Node upgrade', { f: ['deploy/deploy.sh'], d: [['pin Node 20 in the deploy script', 'the Pi image ships an older glibc']] }),
  c('g31', G, 39, 'gemini', 'Settings page for station names and locations', { f: ['dashboard/src/pages/settings.tsx'], d: [['store settings in the same SQLite file', 'one file to back up']] }),
  c('g32', G, 28, 'codex', 'Alert thresholds on the settings page', { f: ['dashboard/src/pages/settings.tsx', 'base/alerts/alerts.go'], d: [['per station gust threshold with a default of 35 knots', 'the hilltop station is always windier']] }),
  c('g33', G, 17, 'cursor', 'Settings page lost changes on save', { f: ['dashboard/src/pages/settings.tsx', 'base/api/settings.go'], d: [['send the whole form instead of a patch', 'the patch set unchanged fields to null']] }),
  auto('g34', G, 5, 'gemini', 'add a units setting to the settings page so people can pick celsius or fahrenheit', ['dashboard/src/pages/settings.tsx', 'dashboard/src/units.ts'], [['npm run build', true]], 'Units setting added with celsius as the default.'),
  c('g35', G, 34, 'claude-code', 'Wind alert emails', { f: ['base/alerts/mail.go'], d: [['send through the club mail account with a 30 minute cooldown', 'one gusty afternoon sent forty emails']] }),
  c('g36', G, 26, 'codex', 'Export readings as CSV', { f: ['base/api/export.go'], d: [['stream the CSV straight from SQLite', 'a year of data did not fit in memory on the Pi']] }),
  c('g37', G, 21, 'gemini', 'Solar panel voltage in the status packet', { f: ['firmware/src/power/solar.c', 'firmware/src/radio/packet.c'], d: [['send millivolts as a 16 bit field', 'the packet had two spare bytes']] }),
  c('g38', G, 14, 'codex', 'Battery drains in winter', { f: ['firmware/src/power/sleep.c', 'firmware/src/sensors/lightning.c'], d: [['skip the lightning sensor when the battery is under 3.5 volts', 'the AS3935 drew the most power']], o: ['measure the panel output on cloudy days'] }),
  c('g39', G, 10, 'claude-code', 'Humidity drift above 90 percent', { f: ['firmware/src/sensors/bme280.c'], d: [["apply the vendor's long term drift correction", 'readings crept up 3 percent a month']] }),
  auto('g40', G, 3, 'codex', 'the vane reads north when it is calm, can we hold the last direction when wind is under 1 knot', ['firmware/src/sensors/vane.c'], [['pio test -e native', true]], 'Vane holds the last heading when wind speed is under 1 knot.'),
  h('gh1', G, 2, 'codex', { goal: 'Hold the vane heading in calm wind', done: 'Heading holds under 1 knot', next: 'Show calm periods as a gap in the wind chart', files: ['firmware/src/sensors/vane.c', 'dashboard/src/WindChart.tsx'] }),
  rule('gr1', G, 33, 'codex', 'always run pio test -e native before you flash', 'project'),
  rule('gr2', G, 16, 'claude-code', 'never commit the wifi credentials file', 'all'),
];

const P = PANTRY;
const pantry: Item[] = [
  c('p01', P, 59, 'cursor', 'Recipe pages from markdown with static generation', { f: ['app/recipes/[slug]/page.tsx'], d: [['generate pages at build time', 'recipes change rarely']] }),
  c('p02', P, 56, 'codex', 'Scale ingredient amounts with servings', { f: ['lib/scale.ts'], d: [['store amounts as fractions', 'a third of a cup times three must give one cup']], x: ['floats printed 0.333 cups'] }),
  c('p03', P, 51, 'claude-code', 'Convert between metric and cups', { f: ['lib/units.ts'], d: [['density table per ingredient', 'a cup of flour and a cup of water weigh different amounts']] }),
  c('p04', P, 47, 'codex', 'Scaling rounded eggs to fractions', { f: ['lib/scale.ts'], d: [['round countable items like eggs to whole numbers', 'nobody can use 1.5 eggs']] }),
  c('p05', P, 43, 'gemini', 'Unit choice remembered per reader', { f: ['lib/prefs.ts'], d: [['keep the metric or US choice in a cookie', 'readers switched units on every page']] }),
  c('p06', P, 53, 'codex', 'Full text search over recipes', { f: ['lib/search/index.ts', 'scripts/build-search.ts'], d: [['build a MiniSearch index at build time and ship it as JSON', 'the free host runs no search server']] }),
  c('p07', P, 39, 'cursor', 'Search by ingredient', { f: ['lib/search/index.ts'], d: [['index ingredient names as their own field with a boost', 'people search for what is in the fridge']] }),
  c('p08', P, 23, 'claude-code', 'Search index too big on mobile', { f: ['scripts/build-search.ts'], d: [['split the index per category and load it on demand', 'the JSON reached 2 MB']] }),
  auto('p09', P, 8, 'gemini', 'typing fast in the search box makes the results jump around, add a debounce', ['components/SearchBox.tsx'], [['npm test', true]], 'Search waits 200 ms after the last key.'),
  c('p10', P, 48, 'gemini', 'Recipe photos through the image CDN', { f: ['next.config.js'], d: [['one year cache header on hashed image URLs', 'the origin bucket is slow and costs egress']] }),
  c('p11', P, 34, 'codex', 'Old photo kept showing after an edit', { f: ['lib/images.ts'], d: [['put a content hash in the image URL', 'the CDN served the cached photo for a year']] }),
  c('p12', P, 20, 'cursor', 'Cache recipe pages at the edge', { f: ['app/recipes/[slug]/page.tsx'], d: [['revalidate a page when its markdown changes', 'a full rebuild took nine minutes']] }),
  c('p13', P, 45, 'cursor', 'Login with magic links for favorites', { f: ['app/api/auth/route.ts'], d: [['magic links over passwords', 'fewer reset requests']], x: ['Google sign in needed a verified domain'] }),
  c('p14', P, 30, 'claude-code', 'Magic link emails went to spam', { f: ['lib/mail.ts'], d: [['send from a subdomain with SPF and DKIM set', 'the shared host IP was on a blocklist']] }),
  c('p15', P, 16, 'codex', 'Login session lost in the mobile webview', { f: ['lib/session.ts'], d: [['use a same site lax cookie', 'strict cookies were dropped after the redirect from the mail app']] }),
  auto('p16', P, 4, 'cursor', 'add google sign in next to the magic link button now that the domain is verified', ['app/api/auth/google/route.ts', 'components/LoginForm.tsx'], [['npm run build', true]], 'Google sign in added next to the magic link button.'),
  c('p17', P, 37, 'claude-code', 'Comments on recipes', { f: ['app/api/comments/route.ts'], d: [['hold comments with links for review', 'spam bots post links']] }),
  c('p18', P, 18, 'gemini', 'Star ratings with comments', { f: ['app/api/ratings/route.ts'], d: [['one rating per signed in reader', 'one account rated a recipe forty times']] }),
  c('p19', P, 41, 'codex', 'Shopping list from selected recipes', { f: ['lib/list.ts'], d: [['merge the same ingredient across recipes by unit', 'two recipes with onions should give one line']] }),
  c('p20', P, 27, 'cursor', 'Shopping list grouped by aisle', { f: ['lib/aisles.ts'], d: [['map ingredients to aisles with a small table', 'readers walk the store once']] }),
  c('p21', P, 12, 'claude-code', 'Shopping list shared with a link', { f: ['app/list/[id]/page.tsx'], d: [['store the list under a random id for 30 days', 'no login needed to read a shared list']] }),
  c('p22', P, 35, 'cursor', 'Nutrition facts per serving', { f: ['lib/nutrition.ts'], d: [['use the USDA FoodData table offline', 'the API rate limit is low']], x: ['scraping product labels broke every week'] }),
  c('p23', P, 14, 'codex', 'Nutrition wrong after scaling', { f: ['lib/nutrition.ts', 'lib/scale.ts'], d: [['compute nutrition from the scaled amounts', 'facts showed the original servings']] }),
  c('p24', P, 32, 'codex', 'Print layout for recipes', { f: ['app/recipes/[slug]/print.css'], d: [['hide comments and photos in print', 'a recipe should fit on one sheet']] }),
  c('p25', P, 29, 'gemini', 'Weekly meal planner', { f: ['app/planner/page.tsx'], d: [['drag recipes onto a seven day grid with dnd kit', 'it handles touch screens']] }),
  c('p26', P, 11, 'claude-code', 'Meal planner feeds the shopping list', { f: ['app/planner/page.tsx', 'lib/list.ts'], d: [["add the whole week's recipes to the list in one press", 'readers planned and then copied by hand']] }),
  c('p27', P, 50, 'codex', 'Unit tests for scaling and units', { f: ['lib/scale.test.ts'], d: [['vitest with table driven cases', 'fractions have many edge cases']], r: ['npx vitest'] }),
  c('p28', P, 26, 'claude-code', 'End to end tests for the recipe page', { f: ['e2e/recipe.spec.ts'], d: [['playwright against a preview build', 'static pages only fail after a build']], r: ['npx playwright test'] }),
  c('p29', P, 10, 'cursor', 'Flaky search test', { f: ['e2e/search.spec.ts'], d: [['wait for the index fetch before typing', 'the test typed before the JSON loaded']] }),
  c('p30', P, 52, 'gemini', 'Deploy on the free static host', { f: ['.github/workflows/deploy.yml'], d: [['deploy from main through a workflow', 'no server is needed']] }),
  c('p31', P, 28, 'codex', 'Preview deploys for pull requests', { f: ['.github/workflows/deploy.yml'], d: [['one preview per pull request', 'the cook who writes recipes checks the layout before merge']] }),
  c('p32', P, 13, 'claude-code', 'Deploy failed on the image step', { f: ['.github/workflows/deploy.yml'], d: [['raise the build memory to 4 GB', 'sharp ran out of memory on large photos']] }),
  c('p33', P, 42, 'cursor', 'Reader settings page', { f: ['app/settings/page.tsx'], d: [['one page for units, dark mode and email preferences', 'options were spread over three menus']] }),
  c('p34', P, 24, 'gemini', 'Settings page did not save email preferences', { f: ['app/settings/page.tsx'], d: [['send the checkbox as false when unchecked', 'the form left unchecked boxes out']] }),
  auto('p35', P, 6, 'codex', 'add a delete my account button to the settings page, ask twice before deleting', ['app/settings/page.tsx', 'app/api/account/route.ts'], [['npm test', true]], 'Delete account button added with a second confirm.'),
  c('p36', P, 46, 'claude-code', 'Dark mode', { f: ['components/ThemeToggle.tsx'], d: [['follow the system setting with a manual override', 'most readers cook at night']] }),
  c('p37', P, 38, 'codex', 'Cook mode keeps the screen on', { f: ['components/CookMode.tsx'], d: [['use the wake lock API with a toggle', 'phones dimmed in the middle of a recipe']] }),
  c('p38', P, 21, 'cursor', 'Recipe import from a URL', { f: ['app/api/import/route.ts'], d: [['read schema.org Recipe data from the page', 'most food blogs publish it']], x: ['scraping the visible text failed on ad heavy pages'] }),
  c('p39', P, 9, 'gemini', 'Timers in cook mode', { f: ['components/StepTimer.tsx'], d: [['turn durations like 20 minutes in steps into tap to start timers', 'readers switched apps to set timers']] }),
  auto('p40', P, 2, 'claude-code', 'the timer sound does not play on iphone when the screen is locked, can we fix that', ['components/StepTimer.tsx'], [['npm test', true]], 'The timer now plays through an audio element unlocked on the first tap.'),
  h('ph1', P, 1, 'claude-code', { goal: 'Timer sound on locked iPhones', done: 'Audio unlock on the first tap', next: 'Test the timer sound on Android Chrome', files: ['components/StepTimer.tsx'] }),
  rule('pr1', P, 50, 'codex', 'keep recipe amounts as fractions in the data', 'project'),
  rule('pr2', P, 22, 'cursor', 'use pnpm for every install', 'all'),
];

const K = KNIGHT;
const knight: Item[] = [
  c('k01', K, 60, 'codex', 'Bitboard move generation', { f: ['src/movegen/mod.rs'], d: [['magic bitboards for sliding pieces', 'faster than ray loops']] }),
  c('k02', K, 57, 'claude-code', 'Perft suite', { f: ['tests/perft.rs'], d: [['known perft counts for six positions', 'castling bugs show at depth 4']], r: ['cargo test --release perft'] }),
  c('k03', K, 53, 'codex', 'Castling rights after a rook capture', { f: ['src/position/castle.rs'], d: [['clear the right when the rook square is captured', 'perft at depth 4 was off by 12 in kiwipete']] }),
  c('k04', K, 49, 'cursor', 'En passant under a pin', { f: ['src/movegen/pawn.rs'], d: [['check the rank pin before allowing en passant', 'the king was exposed on the fifth rank']] }),
  c('k05', K, 55, 'codex', 'Alpha beta with iterative deepening', { f: ['src/search/alphabeta.rs'], d: [['principal variation search', 'fewer nodes with good ordering']] }),
  c('k06', K, 46, 'claude-code', 'Move ordering', { f: ['src/search/ordering.rs'], d: [['hash move first, then captures by MVV LVA, then killers', 'cutoffs come early']] }),
  c('k07', K, 42, 'gemini', 'Quiescence search', { f: ['src/search/quiesce.rs'], d: [['delta pruning', 'it cut a third of the nodes']] }),
  c('k08', K, 36, 'codex', 'Null move pruning', { f: ['src/search/alphabeta.rs'], d: [['skip null move in pawn endings', 'zugzwang lost won endgames']] }),
  c('k09', K, 30, 'cursor', 'Late move reductions', { f: ['src/search/alphabeta.rs'], d: [['reduce quiet moves after the fourth by one ply', 'it gave 40 elo in self play']] }),
  c('k10', K, 19, 'claude-code', 'Search explodes in time trouble', { f: ['src/search/time.rs'], d: [['check the clock every 2048 nodes', 'checking at every node cost 5 percent of the speed']] }),
  c('k11', K, 51, 'cursor', 'Transposition table', { f: ['src/search/tt.rs'], d: [['replace by depth with an always replace bucket', 'deep entries were thrown out']], x: ['a HashMap was too slow'] }),
  c('k12', K, 38, 'codex', 'Transposition table size from the UCI Hash option', { f: ['src/search/tt.rs', 'src/uci.rs'], d: [['round the hash size down to a power of two', 'index by mask instead of modulo']] }),
  c('k13', K, 25, 'gemini', 'Eval cache', { f: ['src/eval/cache.rs'], d: [['a small cache of static evals keyed by Zobrist', 'eval was 30 percent of the time']] }),
  auto('k14', K, 12, 'codex', 'clear the transposition table between games, the bot played the same blunder twice in a row', ['src/search/tt.rs', 'src/uci.rs'], [['cargo test', true]], 'The table is cleared on ucinewgame.'),
  c('k15', K, 44, 'codex', 'Piece square tables', { f: ['src/eval/pst.rs'], d: [['tapered eval between middlegame and endgame', 'the king should hide early and walk late']] }),
  c('k16', K, 33, 'claude-code', 'Texel tuning of the eval', { f: ['tools/tune.rs'], d: [['tune on 700k quiet positions', 'hand values lost to the old version']] }),
  c('k17', K, 22, 'cursor', 'Pawn structure terms', { f: ['src/eval/pawns.rs'], d: [['penalty for doubled and isolated pawns and a bonus for passed pawns by rank', 'the engine walked into weak pawns']] }),
  c('k18', K, 40, 'gemini', 'Threefold repetition and the fifty move rule', { f: ['src/position/history.rs'], d: [['store Zobrist keys since the last capture or pawn move', 'repetition only follows reversible moves']] }),
  c('k19', K, 15, 'codex', 'Draws by insufficient material', { f: ['src/eval/draw.rs'], d: [['treat king and minor piece against king as a draw', 'the engine shuffled for fifty moves']] }),
  c('k20', K, 48, 'claude-code', 'UCI protocol', { f: ['src/uci.rs'], d: [['parse wtime and btime for time control', 'GUIs send the clocks every move']] }),
  c('k21', K, 27, 'codex', 'Opening book from a Polyglot file', { f: ['src/book.rs'], d: [['read the Polyglot bin format', 'GUIs ship books in it']], x: ['building our own book from PGN took too long'] }),
  c('k22', K, 9, 'cursor', 'Book moves repeat the same opening', { f: ['src/book.rs'], d: [['pick book moves weighted by count with some randomness', 'the bot always played the same line and got farmed']] }),
  c('k23', K, 45, 'codex', 'Unit tests for move generation edge cases', { f: ['tests/movegen.rs'], d: [['one test per special move', 'perft only says that something is wrong']], r: ['cargo test'] }),
  c('k24', K, 29, 'gemini', 'SPRT testing for changes', { f: ['tools/sprt.sh'], d: [['run cutechess SPRT with elo bounds 0 and 5', 'small gains were noise']] }),
  c('k25', K, 7, 'claude-code', 'Flaky search test', { f: ['tests/search.rs'], d: [['use a fixed node count instead of time in tests', 'time based tests failed on the slow CI runner']] }),
  c('k26', K, 35, 'cursor', 'Run the engine as an online bot', { f: ['bot/config.yml'], d: [["connect through the chess server's bot API with a token in an env var", 'tokens must not sit in the repo']] }),
  c('k27', K, 24, 'codex', 'Deploy the bot to a small VPS', { f: ['deploy/knightmare-bot.service'], d: [['systemd service with restart on failure', 'the bot died overnight and nobody noticed']] }),
  c('k28', K, 11, 'gemini', 'Deploy builds for the wrong CPU', { f: ['.cargo/config.toml', 'deploy/build.sh'], d: [['build with target-cpu x86-64-v2', 'native builds used AVX512 that the VPS lacks']] }),
  c('k29', K, 33, 'claude-code', 'Bot login token rotation', { f: ['bot/auth.rs'], d: [['read the token from a file mounted at start', 'rotating meant editing the service']] }),
  c('k30', K, 20, 'cursor', 'Login to the web GUI for analysis', { f: ['web/src/auth.ts'], d: [['GitHub login for the analysis page', 'only the two of us use it']] }),
  auto('k31', K, 5, 'codex', 'the web gui login loops back to the sign in page after github redirects, look at the callback', ['web/src/auth.ts'], [['npm test', false], ['npm test', true]], 'The callback URL had a trailing slash mismatch.'),
  c('k32', K, 26, 'gemini', 'Engine settings page in the web GUI', { f: ['web/src/pages/settings.tsx'], d: [['show the UCI options as a form built from the option list', 'options change as the engine grows']] }),
  c('k33', K, 16, 'codex', 'Settings page threads option crashed the engine', { f: ['src/uci.rs', 'web/src/pages/settings.tsx'], d: [['clamp Threads to the number of cores', 'a typo of 400 threads crashed the VPS']] }),
  auto('k34', K, 3, 'claude-code', 'add a contempt setting to the settings page and pass it to the engine as a uci option', ['web/src/pages/settings.tsx', 'src/uci.rs'], [['cargo test', true]], 'Contempt option added in centipawns with 0 as the default.'),
  c('k35', K, 58, 'cursor', 'Board representation', { f: ['src/position/mod.rs'], d: [['bitboards plus a mailbox array', 'piece lookup by square is fast']] }),
  c('k36', K, 41, 'codex', 'Static exchange evaluation', { f: ['src/search/see.rs'], d: [['SEE to prune losing captures in quiescence', 'the engine searched bad captures deeply']] }),
  c('k37', K, 31, 'claude-code', 'Multi threaded search', { f: ['src/search/smp.rs'], d: [['lazy SMP with a shared transposition table', 'simple and it scales to 4 cores']] }),
  c('k38', K, 18, 'gemini', 'Endgame tablebases', { f: ['src/tb.rs'], d: [['probe Syzygy 5 piece tables at the root', 'the engine misplayed rook endings']] }),
  c('k39', K, 13, 'cursor', 'Analysis arrows in the web GUI', { f: ['web/src/Board.tsx'], d: [['draw the principal variation as arrows', 'the text line was hard to follow']] }),
  auto('k40', K, 1, 'gemini', 'the engine loses on time in bullet games, leave more margin for lag', ['src/search/time.rs'], [['cargo test', true]], 'Move time now keeps a 50 ms margin for network lag.'),
  h('kh1', K, 1, 'gemini', { goal: 'Bullet time margin', done: '50 ms margin added', next: 'Run 500 bullet games against the last release', files: ['src/search/time.rs'] }),
  rule('kr1', K, 40, 'codex', 'run perft at depth five before every merge', 'project'),
  rule('kr2', K, 18, 'claude-code', 'never use unsafe code in the engine', 'project'),
];

const R = ROLL;
const roll: Item[] = [
  c('r01', R, 57, 'claude-code', 'Event sign up with capacity', { f: ['src/routes/events/signup.ts'], d: [['check capacity in a database transaction', 'two people took the last spot at once']] }),
  c('r02', R, 53, 'codex', 'Waitlist when an event is full', { f: ['src/routes/events/waitlist.ts'], d: [['promote the first person when someone cancels', 'leaders wanted no manual work']] }),
  c('r03', R, 47, 'cursor', 'Waitlist promotion emails', { f: ['src/jobs/promote.ts'], d: [['email the promoted person and give them 24 hours to confirm', 'some promoted people never came']] }),
  c('r04', R, 31, 'gemini', 'Waitlist order bug', { f: ['src/routes/events/waitlist.ts'], d: [['order the waitlist by join time and not by id', 'imported rows had ids out of order']] }),
  auto('r05', R, 6, 'codex', 'let leaders message everyone on the waitlist, one message a day max', ['src/routes/broadcast.ts'], [['npm test', true]], 'Leaders can send one message a day to the waitlist.'),
  c('r06', R, 55, 'cursor', 'Login with school Google accounts', { f: ['src/auth/google.ts'], d: [['restrict sign in to the school domain', 'only students may join']], x: ['magic links landed in the school spam filter'] }),
  c('r07', R, 37, 'claude-code', 'Parents cannot log in', { f: ['src/auth/parents.ts'], d: [['add a separate parent login with email codes', 'parents have no school account']] }),
  c('r08', R, 21, 'codex', 'Login loop on the school Chromebooks', { f: ['src/auth/session.ts'], d: [['set the session cookie with SameSite lax', 'the managed Chromebooks blocked third party cookies after the Google redirect']] }),
  c('r09', R, 41, 'codex', 'Cache the club list page', { f: ['src/routes/clubs.tsx'], d: [['cache for 60 seconds at the edge', 'every student hits it at the start of term']] }),
  c('r10', R, 17, 'gemini', 'Club list showed a deleted club', { f: ['src/routes/clubs.tsx'], d: [['purge the edge cache when a club changes', 'the 60 second cache kept old clubs']] }),
  c('r11', R, 45, 'claude-code', 'End to end tests for sign up', { f: ['tests/e2e/signup.spec.ts'], d: [['playwright with a seeded database per test', 'tests shared one event and raced']], r: ['npx playwright test'] }),
  c('r12', R, 28, 'cursor', 'Unit tests for capacity rules', { f: ['tests/capacity.test.ts'], d: [['test the capacity check against a real Postgres in docker', 'mocks hid the transaction bug']] }),
  c('r13', R, 10, 'codex', 'Flaky consent test', { f: ['tests/consent.test.ts'], d: [['freeze the clock in the consent reminder test', 'it failed around midnight']] }),
  c('r14', R, 50, 'gemini', 'Deploy to the free host', { f: ['fly.toml', 'Dockerfile'], d: [['Docker image with migrations run on release', 'the app crashed on a missing column after a deploy']] }),
  c('r15', R, 33, 'claude-code', 'Deploy at the start of term went down', { f: ['fly.toml'], d: [['scale to two machines for the first week of term', 'one machine ran out of memory at 9am']] }),
  c('r16', R, 12, 'cursor', 'Staging deploy', { f: ['fly.staging.toml'], d: [["a staging app with a copy of last term's data and emails switched off", 'a test email went to every parent']] }),
  c('r17', R, 43, 'codex', 'Club settings page for leaders', { f: ['src/routes/clubs/settings.tsx'], d: [['leaders edit name, meeting room and capacity on one page', 'they emailed the admin for every change']] }),
  c('r18', R, 24, 'gemini', 'Settings page let any member edit the club', { f: ['src/routes/clubs/settings.tsx', 'src/auth/roles.ts'], d: [['check the leader role on the server for every settings change', 'the page only hid the button']] }),
  auto('r19', R, 8, 'claude-code', 'add a setting on the club settings page to close sign ups on a date', ['src/routes/clubs/settings.tsx', 'src/routes/events/signup.ts'], [['npm test', true]], 'Leaders can set a closing date for sign ups.'),
  c('r20', R, 51, 'codex', 'QR code check in', { f: ['src/routes/checkin.ts'], d: [['sign the QR payload with an HMAC', "screenshots of a friend's code were reused"]] }),
  c('r21', R, 39, 'cursor', 'Check in works offline', { f: ['src/pwa/queue.ts'], d: [['queue check ins in IndexedDB and sync later', 'the gym has no signal']] }),
  c('r22', R, 48, 'claude-code', 'Leader dashboard with attendance', { f: ['src/routes/dashboard.tsx'], d: [['count attendance from check ins and not from sign ups', 'many sign up and never come']] }),
  c('r23', R, 35, 'codex', 'Roster export', { f: ['src/routes/export.ts'], d: [['stream the CSV rows', 'big clubs timed out']] }),
  c('r24', R, 26, 'gemini', 'Reminder emails before events', { f: ['src/jobs/reminders.ts'], d: [['send through the email API with a queue', 'the free tier cron slept']], x: ['a setTimeout in the server lost jobs on deploy'] }),
  c('r25', R, 19, 'cursor', 'Parent consent under 13', { f: ['src/routes/consent.ts'], d: [['block sign up until a parent approves by email', 'the school policy requires it']] }),
  c('r26', R, 14, 'claude-code', 'Consent reminder to parents', { f: ['src/jobs/consent.ts'], d: [['remind after two days and at most twice', 'parents ignored the first email']] }),
  c('r27', R, 44, 'gemini', 'Times shown in the wrong zone', { f: ['src/lib/time.ts'], d: [["store UTC and render in the school's zone", 'a summer time change moved every event by an hour']] }),
  c('r28', R, 30, 'codex', 'Recurring weekly meetings', { f: ['src/lib/recur.ts'], d: [['store a rule and expand the events for the term', 'leaders created 14 events by hand']] }),
  c('r29', R, 22, 'claude-code', 'Cancel a single meeting in a series', { f: ['src/lib/recur.ts'], d: [['store exceptions next to the rule', 'deleting one meeting deleted the series']] }),
  c('r30', R, 16, 'gemini', 'Room booking clash', { f: ['src/routes/rooms.ts'], d: [['reject two clubs in one room at the same time', 'chess and debate both booked room 12']] }),
  c('r31', R, 9, 'cursor', 'Accessibility pass', { f: ['src/components/Form.tsx'], d: [['label every form field and fix the focus order', 'a screen reader user could not sign up']] }),
  auto('r32', R, 4, 'gemini', 'the sign up button does nothing on old iphones, check if it is the dialog element', ['src/components/SignupDialog.tsx'], [['npx playwright test', true]], 'Old Safari lacked the dialog element so a polyfill now loads.'),
  c('r33', R, 46, 'cursor', 'Admin can merge duplicate students', { f: ['src/routes/admin/merge.ts'], d: [['merge by school email and keep the older account', 'students signed up twice with different names']] }),
  c('r34', R, 36, 'claude-code', 'Club pages with photos', { f: ['src/routes/clubs/photos.ts'], d: [['resize photos on upload to 1200 px', 'leaders uploaded 12 MB phone photos']] }),
  c('r35', R, 27, 'codex', 'Image cache for club photos', { f: ['src/lib/images.ts'], d: [['serve photos from the CDN with a long cache and hashed names', 'club pages were slow at lunch']] }),
  c('r36', R, 20, 'gemini', 'Push notifications', { f: ['src/push.ts'], d: [['web push for event changes with an opt in', 'students miss emails']] }),
  c('r37', R, 15, 'claude-code', 'Notification settings', { f: ['src/routes/me/settings.tsx'], d: [['a mute switch per club on the settings page', 'members of ten clubs got too many pushes']] }),
  c('r38', R, 11, 'codex', 'Rate limit sign ups', { f: ['src/routes/events/signup.ts'], d: [['limit to five sign ups a minute per account', 'a script grabbed every spot']] }),
  c('r39', R, 7, 'cursor', 'Term archive', { f: ['src/jobs/archive.ts'], d: [["archive last term's events as read only", 'the event list grew too long']] }),
  auto('r40', R, 2, 'codex', 'waitlisted students should see their position, show number 3 of 7 on the event page', ['src/routes/events/[id].tsx'], [['npm test', true]], 'The event page shows the waitlist position like 3 of 7.'),
  h('rh1', R, 1, 'codex', { goal: 'Waitlist position', done: 'Shown on the event page', next: 'Update the position live when someone cancels', files: ['src/routes/events/[id].tsx'] }),
  rule('rr1', R, 45, 'cursor', 'store every time in UTC in the database', 'project'),
  rule('rr2', R, 11, 'claude-code', 'ask before you run migrations on production', 'all'),
];

export const ITEMS: Item[] = [...gale, ...pantry, ...knight, ...roll];

export type Kind2 = 'prompt' | 'short' | 'other' | 'none' | 'cross';
export interface Query2 { q: string; project: string; kind: Kind2; want: string[] }

const q = (kind: Kind2) => (project: string, text: string, ...want: string[]): Query2 => ({ q: text, project, kind, want });
const prompt = q('prompt');
const short = q('short');
const other = q('other');
const none = q('none');
const cross = q('cross');

export const QUERIES: Query2[] = [
  prompt(G, 'ok now make the wind chart refresh every five seconds, last time the redraw flickered and i think we decided something about that', 'g16', 'g17'),
  prompt(G, 'the humidity is stuck at 100 after foggy mornings again, what did we do last time about the sensor staying saturated', 'g05'),
  prompt(G, 'can you add a second retry pass when the base station misses packets, i think we already have some backoff in there somewhere', 'g12'),
  prompt(G, 'the dashboard login on the clubhouse screen keeps logging out overnight, fix it so the kiosk stays signed in', 'g21'),
  prompt(G, "lets show yesterday's max gust on the dashboard but careful, after a station reboots the api showed stale readings before", 'g24'),
  prompt(G, 'i want to add a pressure trend arrow to the status packet, are there spare bytes left in the packet format or did solar take them', 'g11', 'g37'),
  prompt(G, 'deploy the new dashboard build to the pi, last deploy broke because of the node version so check that first', 'g30'),
  prompt(G, 'the settings page dropped the station location when i saved only the name, did we not fix that already', 'g33'),
  prompt(G, 'battery is dying again in cold weather, what did we turn off to save power last winter', 'g38'),
  prompt(G, 'write a test for the lightning sensor driver like we did for the gust filter on the native env', 'g25'),
  prompt(P, 'scaling a recipe to 3 servings gives 1.5 eggs, i thought we handled countable things like eggs somewhere', 'p04'),
  prompt(P, 'the search index is huge again on phones, remind me how we split it last time before i add the new tags field', 'p08'),
  prompt(P, 'someone edited the lasagna photo and the old one still shows up everywhere, didnt we already solve this with hashes', 'p11'),
  prompt(P, 'magic link emails are landing in spam for gmail users, what did we set up for the mail domain', 'p14'),
  prompt(P, 'add a button to the meal planner that sends the week to the shopping list, i think we started on that', 'p26'),
  prompt(P, 'nutrition numbers look wrong when i change servings to 8, can you check how nutrition is computed', 'p23'),
  prompt(P, 'the settings page forgets that i unchecked the weekly email every time i save, fix the save please', 'p34'),
  prompt(P, 'deploy keeps failing on the image step for the big photos, what did we change in the build last time', 'p32'),
  prompt(P, 'importing a recipe from a food blog with lots of ads gives garbage text, how does the import read the page', 'p38'),
  prompt(P, 'make the cook mode timer work when the phone screen is locked on iphone, i think the sound was the problem', 'p40'),
  prompt(K, 'perft at depth 4 is off again in kiwipete after my castling change, what was the rook capture thing we fixed', 'k03'),
  prompt(K, 'the bot keeps playing the same blunder in consecutive games, i think it is something about the hash table between games', 'k14'),
  prompt(K, 'set the hash size from the gui to 100 mb and see what happens, i remember we round it somehow', 'k12'),
  prompt(K, 'the engine is losing won pawn endings since null move went in, did we not already exclude those', 'k08'),
  prompt(K, 'searching gets stuck when the clock is low and we flag, how often do we check the time during search', 'k10'),
  prompt(K, 'the bot always plays the same opening line and people farm it, look at how book moves are picked', 'k22'),
  prompt(K, 'the web gui login goes back to the sign in page after github, fix the redirect', 'k31'),
  prompt(K, 'someone set threads to 400 on the settings page and the server died, make sure that cant happen again', 'k33'),
  prompt(K, 'the deploy on the vps crashes with illegal instruction after the new build, what cpu target do we use', 'k28'),
  prompt(K, 'lets tune the eval again with more positions, what did we use for the texel run last time', 'k16'),
  prompt(R, 'two kids got the last spot for the trip at the same time again, how do we check capacity on sign up', 'r01'),
  prompt(R, 'promoted kids from the waitlist never show up, what did we do about confirming the spot', 'r03'),
  prompt(R, 'the school chromebooks are stuck in a login loop after the google redirect, i think we hit this before with cookies', 'r08'),
  prompt(R, 'the club list still shows the robotics club after we deleted it, is that the cache', 'r10'),
  prompt(R, 'start of term is next week, last year the deploy went down at 9am, what did we do to handle the load', 'r15'),
  prompt(R, 'any member can change the club name on the settings page, that should only be leaders', 'r18'),
  prompt(R, 'a parent got a test email from staging again, how is staging supposed to keep emails off', 'r16'),
  prompt(R, 'cancelling one chess club meeting next week deleted the whole series again, can you fix the exceptions thing', 'r29'),
  prompt(R, 'the event times moved an hour after the clocks changed, how do we store times', 'r27'),
  prompt(R, 'check in at the gym fails because there is no signal, did we build any offline queue for that', 'r21'),

  short(G, 'wind chart library', 'g14'),
  short(G, 'rain gauge debounce', 'g04'),
  short(G, 'lora spreading factor', 'g10'),
  short(G, 'csv export memory', 'g36'),
  short(G, 'passkey login', 'g20'),
  short(P, 'ingredient search boost', 'p07'),
  short(P, 'aisle grouping', 'p20'),
  short(P, 'shared shopping list link', 'p21'),
  short(P, 'wake lock', 'p37'),
  short(P, 'preview deploys', 'p31'),
  short(K, 'late move reductions', 'k09'),
  short(K, 'syzygy tablebases', 'k38'),
  short(K, 'sprt bounds', 'k24'),
  short(K, 'insufficient material draws', 'k19'),
  short(K, 'lazy smp', 'k37'),
  short(R, 'recurring meetings', 'r28'),
  short(R, 'room booking clash', 'r30'),
  short(R, 'merge duplicate students', 'r33'),
  short(R, 'sign up rate limit', 'r38'),
  short(R, 'qr hmac', 'r20'),

  other(G, 'why did the chart blink when it repainted', 'g16'),
  other(G, 'what lets us push new firmware to stations remotely', 'g29'),
  other(G, 'too many warning mails on a windy day', 'g35'),
  other(G, 'time on the station creeps off', 'g09'),
  other(P, 'pictures load slowly from the storage bucket', 'p10'),
  other(P, 'sign in emails for favorites', 'p13'),
  other(P, 'night theme for the site', 'p36'),
  other(P, 'spam on recipe reviews', 'p17'),
  other(K, 'static eval is slow, did we memoize it', 'k13'),
  other(K, 'engine forfeits on the clock', 'k10'),
  other(K, 'the program crashes when too many workers are set', 'k33'),
  other(R, 'same pupil has two accounts', 'r33'),
  other(R, 'parental permission for young members', 'r25'),
  other(R, 'attendance numbers count no shows', 'r22'),
  other(R, 'big uploads from phones for club pictures', 'r34'),

  none(G, 'commit and push'),
  none(P, 'run the tests again'),
  none(K, 'why is this failing'),
  none(R, 'looks good next'),
  none(G, 'do the same for the other file'),
  none(P, 'ok continue'),
  none(K, 'yes go ahead'),
  none(R, 'can you explain what you just did'),
  none(G, 'undo that last change'),
  none(P, 'try again'),
  none(K, 'push it'),
  none(R, 'fix the lint errors'),
  none(G, 'make it cleaner'),
  none(P, 'thanks that works'),
  none(K, 'wait no revert that'),
  none(G, 'add a snow depth sensor with an ultrasonic module on the spare uart'),
  none(G, 'set up grafana for the station metrics so we can see trends'),
  none(G, 'translate the dashboard into spanish for the visiting club'),
  none(G, 'the ci build is slow, can we cache node modules between runs'),
  none(P, 'add a paywall with stripe for premium recipes'),
  none(P, 'write a sitemap so search engines index every recipe'),
  none(P, 'add video clips to recipe steps'),
  none(P, 'rename the repo and update the readme badges'),
  none(K, 'add a chess960 mode to the move generator'),
  none(K, 'port the engine to webassembly so it runs in a browser tab'),
  none(K, 'add a puzzle trainer page to the web gui'),
  none(K, 'write release notes for version 2'),
  none(R, 'add stripe payments for club dues'),
  none(R, 'let students upload homework files for the coding club'),
  none(R, 'build a group chat between club members'),

  cross(P, 'how did the chess engine clear the hash table between games', 'k14'),
  cross(G, 'on the recipe site how did we stop magic link mails going to spam', 'p14'),
  cross(K, 'in rollcall how do we stop two people taking the last spot', 'r01'),
  cross(R, 'how does gale-station keep the last reading through a brownout', 'g08'),
  cross(K, 'what spreading factor does the weather station use', 'g10'),
  cross(G, 'what did knightmare decide about null move in pawn endings', 'k08'),
  cross(R, 'how does pantry-notes scale eggs when servings change', 'p04'),
  cross(P, 'how does the club app handle login loops on chromebooks', 'r08'),
  cross(K, 'how did the recipe site split the search index for phones', 'p08'),
  cross(R, 'how did the weather station fix the chart flicker', 'g16'),
  cross(G, 'in the sign up app how is the waitlist ordered', 'r04'),
  cross(P, 'which polyglot book format does knightmare read', 'k21'),
  cross(K, 'how do rollcall reminders survive deploys', 'r24'),
  cross(R, 'how does the chess engine detect threefold repetition', 'k18'),
  cross(G, 'how did pantry-notes cache recipe pages at the edge', 'p12'),
];
