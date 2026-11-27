import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, isChat, namedProjects, oneEdit, rankItems, recency, recent, typoOf } from '../src/rank.ts';
import { tokens } from '../src/text.ts';
import type { Body, CardBody, Item, Kind } from '../src/model.ts';

const NOW = Date.parse('2026-11-20T12:00:00Z');

function item(id: string, kind: Kind, body: Body, daysAgo: number, extra: Partial<Item> = {}, session?: string): Item {
  const at = NOW - daysAgo * DAY;
  return {
    id,
    project: 'github.com/acme/rollcall',
    kind,
    body,
    origin: { agent: 'codex', via: 'tool', source: 'agent', at, ...(session ? { session } : {}) },
    flags: [],
    held: false,
    pinned: false,
    folded: false,
    created: at,
    ...extra,
  };
}

const card = (id: string, goal: string, daysAgo: number, more: Partial<CardBody> = {}, extra: Partial<Item> = {}, session?: string) =>
  item(id, 'card', { goal, ...more }, daysAgo, extra, session);

const items: Item[] = [
  card('waitlist', 'Add a waitlist when an event is full', 3, { decisions: [{ what: 'store waitlist position in the signups table', why: 'one query for the roster' }] }),
  card('emails', 'Send reminder emails the day before an event', 5, { dead_ends: ['cron on the free tier sleeps, moved to a queue'] }),
  card('roster', 'Export the event roster as CSV for club leaders', 8, { changed: [{ path: 'src/export/roster.ts' }] }),
  card('login', 'Switch login to magic links', 12, { open: ['rate limit the magic link endpoint'] }),
  card('theme', 'Dark theme for the event pages', 20),
  card('payments', 'Collect dues with a payment link per member', 30),
  card('held', 'Waitlist position leak in the admin view', 1, {}, { held: true }),
  item('rule', 'rule', { text: 'waitlist position always', words: 'waitlist position always', scope: 'project', status: 'active', proof: 'page' }, 1),
];

test('a query that names the subject of one card finds that card first', () => {
  const hits = rankItems(items, 'where do we store the waitlist position', NOW);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].item.id, 'waitlist');
  assert.ok(hits[0].matched >= 2);
});

test('held items and rules never appear', () => {
  const ids = rankItems(items, 'waitlist position admin leak always', NOW).map((h) => h.item.id);
  assert.ok(!ids.includes('held'));
  assert.ok(!ids.includes('rule'));
});

test('a query that fits nothing gives an empty array', () => {
  assert.deepEqual(rankItems(items, 'tune the kubernetes autoscaler for the gpu nodes', NOW), []);
});

test('chat words carry no weight, so a vague line gives an empty array', () => {
  for (const q of ['ok continue', 'looks good, keep going', 'great, carry on', 'sounds fine', '']) assert.deepEqual(rankItems(items, q, NOW), [], q);
});

test('two distinct query terms must match unless the query has one usable term', () => {
  const nine = [...items, card('badge', 'Badge printer for check in', 9), card('rooms', 'Room booking clash', 10), card('weekly', 'Weekly meetings series', 11)];
  assert.deepEqual(rankItems(nine, 'waitlist kubernetes', NOW), []);
  assert.equal(rankItems(nine, 'waitlist', NOW)[0]?.item.id, 'waitlist');
});

test('rare terms weigh more than terms spread over the project', () => {
  const pool = [
    card('a', 'event event event roster', 1),
    card('b', 'event magic', 1),
    card('c', 'event page', 1),
    card('d', 'event theme', 1),
    card('e', 'unrelated dues', 1),
  ];
  const hits = rankItems(pool, 'event magic', NOW);
  assert.equal(hits[0].item.id, 'b');
});

test('recency multiplies the score with the 21 day curve', () => {
  assert.equal(recency(NOW, NOW), 1);
  assert.ok(Math.abs(recency(NOW - 21 * DAY, NOW) - (0.4 + 0.6 / Math.E)) < 1e-12);
  assert.ok(Math.abs(recency(NOW - 400 * DAY, NOW) - 0.4) < 1e-6);
  const pool = [card('old', 'Badge printer driver for check in', 50), card('new', 'Badge printer driver for check in', 1), card('x', 'unrelated', 2), card('y', 'other', 3)];
  const hits = rankItems(pool, 'badge printer driver', NOW);
  assert.deepEqual(hits.map((h) => h.item.id), ['new', 'old']);
  assert.ok(hits[0].score > hits[1].score);
});

test('recent gives the newest cards and handoffs that are not held', () => {
  const pool = [
    ...items,
    item('h', 'handoff', { goal: 'Finish the waitlist', next: 'Wire the email' }, 2),
    item('d', 'dropped', { label: 'prompt', text: 'x', size: 1 }, 0),
  ];
  assert.deepEqual(recent(pool, 3).map((i) => i.id), ['h', 'waitlist', 'emails']);
  assert.deepEqual(recent(pool, 0), []);
});

test('for one session the card written by an agent wins over the auto card', () => {
  const pool = [
    card('auto', 'auto from hooks', 1, { auto: true }, {}, 's-9'),
    card('written', 'written by the agent', 2, {}, {}, 's-9'),
    card('auto-other', 'auto in another session', 3, { auto: true }, {}, 's-8'),
  ];
  assert.deepEqual(recent(pool, 5).map((i) => i.id), ['written', 'auto-other']);
});

test('namedProjects finds other projects named as a whole word', () => {
  const projects = [
    { key: 'github.com/acme/rollcall', names: ['club app'] },
    { key: 'github.com/acme/knightmare', names: ['chess engine'] },
    { key: 'github.com/acme/gale-station', names: ['weather station'] },
    { key: 'folder:pantry', names: [] },
  ];
  const cur = 'github.com/acme/rollcall';
  assert.deepEqual(namedProjects('how did knightmare cache positions', projects, cur), ['github.com/acme/knightmare']);
  assert.deepEqual(namedProjects('what did the Chess Engine use', projects, cur), ['github.com/acme/knightmare']);
  assert.deepEqual(namedProjects('the gale station firmware', projects, cur), ['github.com/acme/gale-station']);
  assert.deepEqual(namedProjects('pantry login and the weather-station', projects, cur), ['github.com/acme/gale-station', 'folder:pantry']);
  assert.deepEqual(namedProjects('rollcall and the club app', projects, cur), []);
  assert.deepEqual(namedProjects('knightmares and pantryware', projects, cur), []);
});

const FILLER = 'ok so i was looking at this again today and honestly i am not totally sure what we ended up doing last week, can you look it up and tell me before we go any further with the next part of it';

const spread: Item[] = [
  card('s01', 'Badge printer driver for check in at the front desk', 2, { decisions: [{ what: 'thermal printer over USB', why: 'labels print in one second' }] }),
  card('s02', 'Roster export as CSV for club leaders', 4),
  card('s03', 'Reminder emails the day before an event', 6),
  card('s04', 'Dark theme for the event pages', 8),
  card('s05', 'Waitlist when an event is full', 10),
  card('s06', 'Magic link login for parents', 12),
  card('s07', 'Room booking clash check', 14),
  card('s08', 'Recurring weekly meetings', 16),
];

test('a long prompt passes on absolute evidence however many words no card holds', () => {
  const q = `${FILLER}, the badge printer driver kept jamming on thermal labels at the front desk`;
  assert.ok(q.split(' ').length > 40);
  const hits = rankItems(spread, q, NOW);
  assert.deepEqual(hits.map((h) => h.item.id), ['s01']);
  assert.ok(hits[0].matched >= 3);
});

test('a long prompt with fewer than three matched terms returns nothing', () => {
  assert.deepEqual(rankItems(spread, `${FILLER}, something about the badge on the monitor`, NOW), []);
  const wide = [...spread, ...Array.from({ length: 12 }, (_, k) => card(`w${k}`, `unrelated chores number ${k}`, 20 + k))];
  const long = `${FILLER}, my coworker brought up the thermal labels yesterday at standup`;
  assert.deepEqual(rankItems(wide, long, NOW), []);
  assert.deepEqual(rankItems(wide, `${long} and the badge`, NOW).map((h) => h.item.id), ['s01']);
});

test('a long prompt that brushes many cards lightly returns nothing', () => {
  const light = Array.from({ length: 10 }, (_, k) => card(`l${k}`, `Event ${k} notes about leaders and rooms and emails`, k + 1, { open: [`follow up ${k}`] }));
  const q = `${FILLER}, the event leaders rooms emails notes all look off to me lately`;
  assert.deepEqual(rankItems([...light, ...spread.slice(0, 3)], q, NOW), []);
});

test('a short query still uses the share rule', () => {
  assert.equal(rankItems(spread, 'badge printer driver', NOW)[0]?.item.id, 's01');
  assert.deepEqual(rankItems(spread, 'badge kubernetes autoscaler gpu', NOW), []);
});

test('oneEdit counts one change, one insert or one swap of neighbours', () => {
  assert.equal(oneEdit('waitlist', 'watilist'), true);
  assert.equal(oneEdit('waitlist', 'waitlizt'), true);
  assert.equal(oneEdit('waitlist', 'waitlst'), true);
  assert.equal(oneEdit('waitlist', 'waitlists'), true);
  assert.equal(oneEdit('waitlist', 'waitlist'), false);
  assert.equal(oneEdit('waitlist', 'wiatlits'), false);
  assert.equal(oneEdit('waitlist', 'roster'), false);
});

test('a typo of five characters or more maps only when exactly one card term is one edit away', () => {
  assert.equal(typoOf('watilist', ['waitlist', 'roster']), 'waitlist');
  assert.equal(typoOf('hatch', ['latch', 'match']), null);
  assert.equal(typoOf('rostr', ['roster']), 'roster');
  assert.equal(typoOf('mgic', ['magic']), null);
  assert.equal(rankItems(spread, 'watilist when an evnet is full', NOW)[0]?.item.id, 's05');
});

test('a synonym matches at a lower weight than the exact word', () => {
  const pool = [card('a', 'Login loop on the dashboard', 3), card('b', 'Authentication timeout on the dashboard', 3), card('c', 'unrelated card', 3), card('d', 'another unrelated card', 3)];
  const hits = rankItems(pool, 'sign in loop', NOW);
  assert.equal(hits[0]?.item.id, 'a');
  const rest = [card('z', 'Roster export for leaders', 3), card('w', 'Weekly meetings', 3), card('v', 'Room booking clash', 3)];
  const bySyn = rankItems([card('x', 'Authentication timeout', 3), ...rest], 'login timeout', NOW);
  const byWord = rankItems([card('y', 'Login timeout', 3), ...rest], 'login timeout', NOW);
  assert.deepEqual([bySyn[0]?.item.id, byWord[0]?.item.id], ['x', 'y']);
  assert.ok(bySyn[0].score < byWord[0].score);
});

test('a card must stand out from the median of every card with any match', () => {
  const groups = [['quartz', 'zephyr', 'nimbus', 'falcon', 'ember'], ['cobalt', 'tundra', 'mosaic', 'harbor', 'violet'], ['saffron', 'glacier', 'pylon', 'meadow', 'thistle']];
  const even: Item[] = [];
  groups.forEach((g, k) => {
    even.push(card(`e${k}a`, `${g.join(' ')} notes`, k + 1));
    even.push(card(`e${k}b`, `${g.join(' ')} more notes`, k + 2));
  });
  for (let k = 0; k < 4; k++) even.push(card(`u${k}`, `unrelated chores ${k}`, 9));
  const q = `${FILLER} ${groups.flat().join(' ')}`;
  assert.deepEqual(rankItems(even, q, NOW), []);
  const strong = card('strong', `${groups.flat().join(' ')} obsidian lantern all in one`, 1);
  assert.deepEqual(rankItems([...even, strong], `${q} obsidian lantern`, NOW).map((h) => h.item.id), ['strong']);
});

test('rankItems on 400 items and a 60 word prompt runs under 5 ms as a median of 200 runs', (t) => {
  let seed = 11;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const vocab = Array.from({ length: 700 }, (_, k) => `term${(k * 7919) % 100003}`);
  const pick = (n: number) => Array.from({ length: n }, () => vocab[rand(vocab.length)]).join(' ');
  const pool = Array.from({ length: 400 }, (_, k) => card(`p${k}`, pick(10), k % 60, { decisions: [{ what: pick(12), why: pick(10) }], open: [pick(8)], changed: [{ path: `src/${vocab[rand(700)]}.ts` }] }));
  const unknown = Array.from({ length: 30 }, (_, k) => `zq${k}${'xyzwv'.slice(0, 1 + (k % 5))}k`);
  const words = [...pick(30).split(' '), ...unknown];
  const prompt = words.sort(() => rand(3) - 1).join(' ');
  assert.equal(prompt.split(' ').length, 60);
  const times: number[] = [];
  for (let k = 0; k < 200; k++) {
    const t0 = performance.now();
    rankItems(pool, prompt, NOW);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[100];
  t.diagnostic(`median ${median.toFixed(2)} ms`);
  assert.ok(median < 5, `median ${median} ms`);
});

test('a cached pool sees a changed item body', () => {
  const pool = [card('m1', 'Badge printer driver', 2), card('m2', 'Roster export', 3), card('m3', 'Room booking', 4), card('m4', 'Weekly meetings', 5)];
  assert.equal(rankItems(pool, 'badge printer', NOW)[0]?.item.id, 'm1');
  assert.deepEqual(rankItems(pool, 'sundial calibration', NOW), []);
  pool[2].body = { goal: 'Sundial calibration for the courtyard' };
  assert.equal(rankItems(pool, 'sundial calibration', NOW)[0]?.item.id, 'm3');
});

const target = card('t', 'Waitlist promotion when someone cancels', 2, { decisions: [{ what: 'promote the first person on the waitlist', why: 'leaders wanted no manual work' }] });
const smallOthers = ['Roster export as CSV', 'Reminder emails before events', 'Room booking clash check', 'Badge printer for check in', 'Dark theme for event pages', 'Recurring weekly meetings series'].map((goal, k) => card(`o${k}`, goal, k + 3));
const WHOLE = 'ok so the waitlist promotion is acting weird again when someone cancels at the last minute, can you look at how we pick who gets promoted first';

for (const size of [1, 2, 5, 7]) {
  const pool = [target, ...smallOthers.slice(0, size - 1)];
  test(`a pool of ${size} finds the card for a short question and a whole prompt`, () => {
    assert.equal(pool.length, size);
    assert.deepEqual(rankItems(pool, 'waitlist promotion', NOW).map((h) => h.item.id), ['t']);
    assert.deepEqual(rankItems(pool, WHOLE, NOW).map((h) => h.item.id), ['t']);
  });
  test(`a pool of ${size} gives nothing for a chat prompt or a query about something else`, () => {
    assert.deepEqual(rankItems(pool, 'ok looks good, continue', NOW), []);
    assert.deepEqual(rankItems(pool, 'set up stripe checkout for the yearly dues', NOW), []);
  });
}

test('a small pool needs two matched terms when the query has more than two usable terms', () => {
  const pool = [target, ...smallOthers.slice(0, 4)];
  assert.deepEqual(rankItems(pool, 'waitlist kubernetes autoscaler', NOW), []);
  assert.deepEqual(rankItems(pool, 'waitlist kubernetes', NOW).map((h) => h.item.id), ['t']);
  assert.deepEqual(rankItems(pool, 'watilist promotion', NOW).map((h) => h.item.id), ['t']);
});

test('a pool of 8 keeps the common term skip while a pool of 7 does not', () => {
  const all = Array.from({ length: 8 }, (_, k) => card(`c${k}`, `Waitlist note number ${k}`, k + 1));
  assert.deepEqual(rankItems(all, 'waitlist', NOW), []);
  assert.equal(rankItems(all.slice(0, 7), 'waitlist', NOW).length, 7);
});

const SHARED: [string, string[]][] = [
  ['the car is on the plus plan', ['car', 'plus', 'plan']],
  ['war room notes, man page for die()', ['war', 'room', 'not', 'man', 'pag', 'die']],
  ['sin and come are math and shell words', ['sin', 'com', 'math', 'shell', 'word']],
  ['his son has a hat and also a van', ['son', 'hat', 'van']],
  ['press del to drop the con port, para mode stays on', ['press', 'del', 'drop', 'con', 'port', 'para', 'mod', 'stay']],
  ['a fast gut check before the bald eagle demo', ['fast', 'gut', 'check', 'bald', 'eagl', 'demo']],
  ['set the font size, vite build and the pendant light', ['set', 'font', 'siz', 'vit', 'build', 'pendant', 'light']],
  ['the sea level data shows a tan line at the mal port', ['sea', 'level', 'data', 'show', 'tan', 'lin', 'mal', 'port']],
  ['legal show of the sim card at the boa pro meetup', ['legal', 'show', 'sim', 'card', 'boa', 'pro', 'meetup']],
  ['quasi male presto chi test in the solo dove mode', ['quasi', 'mal', 'presto', 'chi', 'test', 'solo', 'dov', 'mod']],
  ['the todo list says nada about the algo bug', ['todo', 'list', 'say', 'nada', 'algo', 'bug']],
  ['an ensemble encore with super bravo pardon notes', ['ensembl', 'encor', 'super', 'bravo', 'pardon', 'not']],
  ['doit runs the comment task and the parfait job', ['doit', 'run', 'comment', 'task', 'parfait', 'job']],
  ['the falls and the seine are the halt points on the map', ['fall', 'sein', 'halt', 'point', 'map']],
  ['the dir path and the mag reader in the ins file', ['dir', 'path', 'mag', 'reader', 'ins', 'fil']],
  ['a pure poi export with verso pages and a col grid', ['pur', 'poi', 'export', 'verso', 'pag', 'col', 'grid']],
];

const panaderia = [
  card('c1', 'Pedido de pan para el sábado', 3, { decisions: [{ what: 'guardar los pedidos en una cola', why: 'los clientes pedían por teléfono desde temprano' }] }),
  card('c2', 'Factura en PDF para la panadería', 4, { decisions: [{ what: 'generar la factura en el servidor', why: 'el navegador era muy lento' }] }),
  card('c3', 'Precio de la barra de pan', 5, { decisions: [{ what: 'leer el precio desde la tabla de productos', why: 'los precios cambiaban cada semana' }] }),
  card('c4', 'Horario de reparto en el barrio', 6, { decisions: [{ what: 'mostrar la hora de llegada', why: 'los vecinos querían saber cuando llega el pan' }] }),
  card('c5', 'Login con código por correo', 7, { decisions: [{ what: 'enviar un código de seis cifras', why: 'la contraseña se olvidaba' }] }),
  card('c6', 'Foto del pan en la tienda', 8, { decisions: [{ what: 'subir la foto comprimida', why: 'las fotos grandes tardaban en cargar' }] }),
];

test('a short query to a project of spanish cards drops spanish function words', () => {
  assert.deepEqual(rankItems(panaderia, 'la foto de la tienda', NOW).map((h) => h.item.id), ['c6']);
  assert.deepEqual(rankItems(panaderia, 'factura de la panaderia', NOW).map((h) => h.item.id), ['c2']);
  assert.deepEqual(rankItems(panaderia, 'lo de la barra', NOW).map((h) => h.item.id), ['c3']);
});

test('english and code sentences keep every word, alone and as a query to a project of english cards', () => {
  const quote = card('quote', 'The client error said no se puede guardar porque falta el archivo', 1);
  const pool = [quote, ...SHARED.map(([s], k) => card(`s${k}`, s, k + 2))];
  SHARED.forEach(([s, want], k) => {
    assert.deepEqual(tokens(s), want, s);
    const hit = rankItems(pool, s, NOW).find((h) => h.item.id === `s${k}`);
    assert.equal(hit?.matched, new Set(want.filter((t) => !isChat(t))).size, s);
  });
});
