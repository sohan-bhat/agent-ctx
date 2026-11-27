import test from 'node:test';
import assert from 'node:assert/strict';
import { FULL_LISTS, GROUPS, STOP_LISTS, bucketOf, languagesOf, projectLanguages, buildBm25, fileTokens, idf, isStop, joinPhrases, search, stem, synonymsOf, tokens, view, vocabulary } from '../src/text.ts';
import { itemText } from '../src/model.ts';
import * as one from './corpus.ts';
import * as two from './corpus2.ts';

test('stem folds plural and verb endings', () => {
  assert.equal(stem('readings'), 'reading');
  assert.equal(stem('batteries'), 'battery');
  assert.equal(stem('caching'), 'cach');
  assert.equal(stem('cached'), 'cach');
  assert.equal(stem('class'), 'class');
  assert.equal(stem('status'), 'status');
  assert.equal(stem('bus'), 'bus');
});

test('each word family gives one stem', () => {
  const families = [
    ['compute', 'computed', 'computing', 'computes'],
    ['cache', 'cached', 'caching', 'caches'],
    ['parse', 'parsed', 'parsing'],
    ['migrate', 'migrated', 'migrating'],
    ['release', 'released', 'releases'],
    ['save', 'saved', 'saving', 'saves'],
    ['file', 'files'],
    ['code', 'codes'],
    ['name', 'names', 'named'],
  ];
  for (const f of families) assert.equal(new Set(f.map(stem)).size, 1, f.join(' '));
  assert.equal(stem('compute'), 'comput');
  assert.equal(stem('save'), 'sav');
});

test('words of three characters or fewer and words ending in ee keep their e', () => {
  for (const w of ['use', 'one', 'ice', 'tree', 'agree', 'degree']) assert.equal(stem(w), w);
});

test('tokens split camel case, drop stop words, short words and long numbers', () => {
  assert.deepEqual(tokens('The windGust filter in src/WindVane.ts'), ['wind', 'gust', 'filter', 'wind', 'van', 'ts']);
  assert.deepEqual(tokens('a 1 22 123456 x'), ['22']);
  assert.deepEqual(tokens('HTTPServer'), ['http', 'server']);
  assert.deepEqual(tokens(''), []);
});

test('fileTokens reads the base name and the parent folder', () => {
  assert.deepEqual(fileTokens('/w/station/firmware/rainGauge.c'), ['rain', 'gaug', 'firmwar']);
});

function oldTokens(text: string): string[] {
  if (!text) return [];
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const out: string[] = [];
  for (const raw of spaced.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || raw.length > 30) continue;
    if (/^\d+$/.test(raw) && raw.length > 4) continue;
    if (isStop(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

test('ASCII text splits exactly as before', () => {
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const pieces = ['HTTPServer', 'windGust', 'XMLHttpRequest', 'src/a_b-c.ts', 'the', 'Caching', 'tests', '123456', '42', 'x', 'abc'.repeat(12), ' ', '  ', '\n', '.', '_', '-', "don't", 'API2Key', 'v3', 'README.md', 'files', 'ok'];
  for (let k = 0; k < 500; k++) {
    let s = '';
    for (let j = 0; j < 12; j++) s += pieces[rand(pieces.length)];
    assert.deepEqual(tokens(s), oldTokens(s), s);
  }
});

test('marks fold away from Latin letters, so resume finds résumé and the reverse', () => {
  assert.deepEqual(tokens('résumé'), tokens('resume'));
  assert.deepEqual(tokens('CAFÉ menü'), tokens('cafe menu'));
  assert.deepEqual(tokens('Ｒｅｓｕｍｅ ＣＳＶ'), tokens('resume csv'));
});

test('words in spaced scripts are kept whole, lower cased and not stemmed', () => {
  assert.deepEqual(tokens('भुगतान की पुष्टि'), ['भुगतान', 'की', 'पुष्टि']);
  assert.deepEqual(tokens('حجز المواعيد'), ['حجز', 'المواعيد']);
  assert.deepEqual(tokens('Пароли и ΚΩΔΙΚΟΙ'), ['пароли', 'κωδικοι']);
  assert.deepEqual(tokens('Rechnungen größer'), ['rechnungen', 'großer']);
});

test('scripts written without spaces become overlapping pairs, a lone character one term', () => {
  assert.deepEqual(tokens('在庫数'), ['在庫', '庫数']);
  assert.deepEqual(tokens('好'), ['好']);
  assert.deepEqual(tokens('サーバー'), ['サー', 'ーバ', 'バー']);
  assert.deepEqual(tokens('がき'), ['がき']);
  assert.deepEqual(tokens('สวัสดี'), ['สวั', 'วัส', 'สดี']);
  assert.deepEqual(tokens('WebSocketで在庫'), ['web', 'socket', 'で在', '在庫']);
  assert.deepEqual(tokens('utf8编码'), ['utf8', '编码']);
});

test('stop words, the stemmer and short words apply to ASCII words only', () => {
  assert.deepEqual(tokens('the files'), ['fil']);
  assert.deepEqual(tokens('las reservas'), ['las', 'reserva']);
  assert.deepEqual(tokens('a ب c'), []);
});

test('a run of more than eight marks keeps only eight, so normalizing stays fast', () => {
  const ka = String.fromCodePoint(0x915);
  const i = String.fromCodePoint(0x93f);
  const ta = String.fromCodePoint(0x924);
  assert.deepEqual(tokens(ka + i.repeat(20) + ta), tokens(ka + i.repeat(8) + ta));
  assert.notDeepEqual(tokens(ka + i.repeat(8) + ta), tokens(ka + i.repeat(7) + ta));
});

const SUBJECT = [
  'weather', 'wind', 'gust', 'rain', 'humidity', 'temperature', 'pressure', 'anemometer', 'vane', 'lightning', 'solar', 'forecast', 'station', 'sensor', 'lora', 'barometer', 'fog', 'battery',
  'recipe', 'ingredient', 'serving', 'servings', 'flour', 'sugar', 'egg', 'cook', 'cooking', 'meal', 'nutrition', 'aisle', 'grocery', 'kitchen', 'oven', 'bake', 'food', 'timer', 'shopping',
  'chess', 'pawn', 'king', 'queen', 'rook', 'bishop', 'knight', 'castle', 'castling', 'checkmate', 'perft', 'opening', 'endgame', 'eval', 'evaluation', 'tablebase', 'board', 'move', 'elo', 'book', 'engine',
  'club', 'waitlist', 'roster', 'student', 'parent', 'leader', 'member', 'meeting', 'attendance', 'consent', 'school', 'term', 'event', 'checkin', 'room', 'gym',
];

test('the table holds about 50 groups of general developer vocabulary', () => {
  assert.ok(GROUPS.length >= 45 && GROUPS.length <= 65, String(GROUPS.length));
  for (const g of GROUPS) assert.ok(g.length >= 2, g.join(' '));
});

test('the table holds no word of the made up projects own subject matter', () => {
  const subject = new Set(SUBJECT.flatMap((w) => tokens(w)));
  const words = new Set(GROUPS.flat().flatMap((w) => tokens(joinPhrases(w))));
  for (const w of words) assert.ok(!subject.has(w), w);
});

test('a word in a group gives the other members, both ways', () => {
  const [login] = tokens('login');
  const [auth] = tokens('auth');
  assert.ok(synonymsOf(login).includes(auth));
  assert.ok(synonymsOf(auth).includes(login));
  const [photo] = tokens('photo');
  const [image] = tokens('images');
  assert.ok(synonymsOf(photo).includes(image));
  assert.deepEqual(synonymsOf('zzz'), []);
  for (const t of vocabulary()) for (const o of synonymsOf(t)) assert.ok(synonymsOf(o).includes(t), `${t} ${o}`);
});

test('two word phrases join into one term before matching', () => {
  assert.deepEqual(tokens(joinPhrases('Sign in with github, then log-in again')), ['signin', 'github', 'login']);
  assert.deepEqual(tokens(joinPhrases('the sign up form and the end to end test')), ['signup', 'form', 'e2e', 'test']);
  assert.ok(synonymsOf(tokens(joinPhrases('sign in'))[0]).includes(tokens('login')[0]));
});

const docs = [
  ['wind', 'gust', 'filter'],
  ['rain', 'gauge', 'bucket', 'rain'],
  ['wind', 'vane', 'offset'],
  ['battery', 'sleep'],
];

test('buildBm25 stores lengths, the average and postings of doc and count', () => {
  const d = buildBm25(docs);
  assert.equal(d.n, 4);
  assert.deepEqual(d.dl, [3, 4, 3, 2]);
  assert.equal(d.avgdl, 3);
  assert.deepEqual(d.terms.wind, [0, 1, 2, 1]);
  assert.deepEqual(d.terms.rain, [1, 2]);
});

test('rarer terms get a larger idf', () => {
  assert.ok(idf(10, 1) > idf(10, 5));
  assert.ok(idf(10, 0) > idf(10, 1));
});

test('search scores the matching docs, counts matched terms and gives a share of the best case', () => {
  const v = view(buildBm25(docs));
  const hits = search(v, ['wind', 'gust']);
  assert.deepEqual(hits.map((h) => h.doc), [0, 2]);
  assert.equal(hits[0].matched, 2);
  assert.equal(hits[1].matched, 1);
  assert.ok(hits[0].norm > hits[1].norm && hits[0].norm <= 1);
  assert.deepEqual(search(v, ['missing']), []);
});

test('query weights scale a term', () => {
  const v = view(buildBm25(docs));
  const plain = search(v, ['wind', 'rain']);
  const heavy = search(v, ['wind', 'rain'], new Map([['rain', 5]]));
  assert.equal(heavy[0].doc, 1);
  assert.ok(heavy.find((h) => h.doc === 1)!.score > plain.find((h) => h.doc === 1)!.score);
});

test('bucketOf is stable and inside the range', () => {
  assert.equal(bucketOf('wind', 64), bucketOf('wind', 64));
  for (const t of ['a', 'wind', 'gauge', 'x'.repeat(50)]) {
    const b = bucketOf(t, 64);
    assert.ok(b >= 0 && b < 64);
  }
});

const LANGS = ['es', 'de', 'fr', 'pt', 'it'] as const;

const stemmed = (w: string): string => tokens(w)[0];

function raw(text: string): string[] {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const folded = spaced.normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC').toLowerCase();
  return folded.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [];
}

test('five safe lists of 150 to 250 plain lowercase words', () => {
  assert.deepEqual(Object.keys(STOP_LISTS).sort(), [...LANGS].sort());
  for (const l of LANGS) {
    const list = STOP_LISTS[l];
    assert.ok(list.length >= 150 && list.length <= 250, `${l} ${list.length}`);
    assert.equal(new Set(list).size, list.length, l);
    for (const w of list) assert.match(w, /^[a-z]{3,}$/, `${l} ${w}`);
  }
});

test('every list word is a stop word and leaves no term', () => {
  for (const l of LANGS) {
    for (const w of STOP_LISTS[l]) {
      assert.ok(isStop(w), `${l} ${w}`);
      assert.deepEqual(tokens(w), [], `${l} ${w}`);
      assert.deepEqual(tokens(w.toUpperCase()), [], `${l} ${w}`);
    }
  }
});

test('function words drop out of each language and content stays', () => {
  const cases: [string, string[]][] = [
    ['los pagos por tarjeta desde que vence', ['pago', 'tarjeta', 'venc']],
    ['eine Rechnung nicht durch die Bank', ['rechnung', 'bank']],
    ['avec une facture depuis toujours', ['factur']],
    ['uma fatura quando ainda paga', ['fatura', 'paga']],
    ['nella fattura senza questo sconto', ['fattura', 'sconto']],
  ];
  for (const [text, want] of cases) assert.deepEqual(tokens(text), want, text);
});

test('question, chat and other closed class words set the language of a short text', () => {
  const cases: [string, string[]][] = [
    ['hola, gracias, alguien sabe donde quedo la factura', ['sab', 'quedo', 'factura']],
    ['danke, warum fehlt die Rechnung schon wieder', ['fehlt', 'rechnung']],
    ['bonjour, pourquoi la facture est encore fausse', ['factur', 'fauss']],
    ['obrigado, onde fica o boleto do aluno', ['fica', 'boleto', 'aluno']],
    ['grazie, perché il conto non torna ancora', ['conto', 'torna']],
  ];
  for (const [text, want] of cases) assert.deepEqual(tokens(text), want, text);
});

test('no list word removes a card or query term of sets 1, 2 and 2b', () => {
  const words = new Map<string, number>();
  const texts = [...one.ITEMS, ...two.ITEMS].map(itemText).concat([...one.QUERIES, ...two.QUERIES, ...two.QUERIES_2B].map((q) => q.q));
  for (const t of texts) for (const w of raw(t)) words.set(w, (words.get(w) ?? 0) + 1);
  assert.ok(words.size > 1000);
  for (const l of LANGS) {
    const hits = STOP_LISTS[l].filter((w) => words.has(w)).map((w) => `${w}:${words.get(w)}`);
    assert.deepEqual(hits, [], l);
  }
});

test('risky words stay out of every list', () => {
  const risky = 'die hat war also sin son come pour main mais con del para las una pero como sobre entre este der den das mit und ist les des est par sur nao sono anche perche loro tutti'.split(' ');
  const all = new Set(LANGS.flatMap((l) => STOP_LISTS[l]));
  for (const w of risky) {
    assert.ok(!all.has(w), w);
    assert.equal(isStop(w), w === 'also', w);
  }
});

test('a full list word drops only when the text holds two safe words of that language', () => {
  assert.deepEqual(tokens('el pago de la tarjeta'), ['el', 'pago', 'de', 'la', 'tarjeta']);
  assert.deepEqual(tokens('el pago de la tarjeta que vence'), ['el', 'pago', 'de', 'la', 'tarjeta', 'venc']);
  assert.deepEqual(tokens('el pago de la tarjeta que vence que'), ['el', 'pago', 'de', 'la', 'tarjeta', 'venc']);
  assert.deepEqual(tokens('el pago de la tarjeta que vence desde hoy'), ['pago', 'tarjeta', 'venc', 'hoy']);
  assert.deepEqual(tokens('il pago que vence desde hoy'), ['il', 'pago', 'venc', 'hoy']);
  assert.deepEqual(tokens('die Rechnung und der Kunde'), ['die', 'rechnung', 'und', 'der', 'kund']);
  assert.deepEqual(tokens('die Rechnung und der Kunde sind nicht da'), ['rechnung', 'kund']);
  for (const l of ['es', 'de', 'fr', 'pt', 'it'] as const) {
    const [a, b] = STOP_LISTS[l];
    for (const w of FULL_LISTS[l]) {
      assert.deepEqual(tokens(`${w} ${a} ${b}`), [], `${l} ${w}`);
      if (!STOP_LISTS[l].includes(w) && !isStop(w)) assert.deepEqual(tokens(`${w} ${a}`), [stemmed(w)], `${l} ${w}`);
    }
  }
});

test('no text of sets 1, 2 and 2b holds two safe words of one language', () => {
  const texts = [...one.ITEMS, ...two.ITEMS].map(itemText).concat([...one.QUERIES, ...two.QUERIES, ...two.QUERIES_2B].map((q) => q.q));
  for (const t of texts) {
    const words = new Set(raw(t));
    for (const l of LANGS) assert.ok(STOP_LISTS[l].filter((w) => words.has(w)).length < 2, `${l} ${t}`);
  }
});

test('a project takes a language when at least two cards and three in ten hold it', () => {
  const es = ['es'] as const;
  const of = (held: number, all: number) => projectLanguages(Array.from({ length: all }, (_, k) => (k < held ? [...es] : [])));
  assert.deepEqual([of(0, 0), of(1, 1), of(2, 2), of(1, 3), of(2, 6), of(2, 10), of(3, 10), of(9, 40), of(12, 40)], [[], [], ['es'], [], ['es'], [], ['es'], [], ['es']]);
  assert.deepEqual(projectLanguages([['es', 'pt'], ['pt'], ['es'], []]), ['es', 'pt']);
  assert.deepEqual(languagesOf('los pagos por tarjeta desde que vence'), ['es', 'pt']);
  assert.deepEqual(languagesOf('nosotros pagamos los recibos'), ['es']);
  assert.deepEqual(languagesOf('the car is on the plus plan'), []);
});

test('the language of a project drops its full list from a text that holds no safe word', () => {
  assert.deepEqual(tokens('el pago de la tarjeta'), ['el', 'pago', 'de', 'la', 'tarjeta']);
  assert.deepEqual(tokens('el pago de la tarjeta', ['es']), ['pago', 'tarjeta']);
  assert.deepEqual(tokens('der Kunde und die Rechnung', ['de']), ['kund', 'rechnung']);
  assert.deepEqual(tokens('the car is on the plus plan', ['es']), ['car', 'plus', 'plan']);
});

test('in a project of italian cards the plural and the singular of a noun give one term', () => {
  assert.deepEqual(tokens('piatto piatti tavolo tavoli banco banchi pizza pizze', ['it']), ['piatt', 'piatt', 'tavol', 'tavol', 'banc', 'banc', 'pizz', 'pizz']);
  assert.deepEqual(tokens('piatto piatti gli ogni'), ['piatto', 'piatti']);
  assert.deepEqual(tokens('piatto piatti', ['es']), ['piatto', 'piatti']);
  assert.deepEqual(tokens('data cache tokens', ['it']), ['data', 'cach', 'token']);
});

const CODE_TERMS: Record<string, string> = {
  javascript: 'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static await async of from get set undefined require module exports prototype constructor arguments es',
  typescript: 'any unknown never number string boolean symbol bigint object type interface namespace declare readonly keyof infer is abstract implements private protected public satisfies override accessor',
  python: 'and as assert def del elif except global lambda nonlocal not or pass raise none self cls print len range dict list tuple str int float bool bytes open isinstance super init main',
  go: 'chan defer fallthrough func go goto map package select struct nil make append cap copy panic recover iota byte rune error fmt strings strconv context errors',
  rust: 'crate dyn extern fn impl loop match mod move mut pub ref trait unsafe use where box macro vec option result some ok err usize isize std alloc mir hir rustc clippy rustfmt',
  sql: 'insert into update create table drop alter index join inner outer left right full on group by order having limit offset union all distinct exists when then end values primary key foreign references check unique view trigger begin commit rollback grant revoke cascade constraint column schema serial varchar text integer date timestamp',
  shell: 'fi esac until done echo printf read cd ls cp mv rm mkdir rmdir touch cat less head tail grep sed awk find xargs sort uniq wc tee cut tr diff patch tar gzip zip unzip curl wget ssh scp rsync chmod chown sudo su kill ps top htop df du mount ln alias unset exit eval exec trap env pwd whoami cron crontab systemctl journalctl man vi vim nano ed cmake gcc clang ld',
  idents: 'bin dir num tmp src lib arg args argv argc buf ctx cfg conf req res resp msg obj arr idx val ptr fd cb db io ui ux id ids uid gid pid tid url uri ip os pkg cmd opt opts util utils app api sdk cli gui ini log logs min max avg sum cnt pos abs ret dst dest impl spec doc docs dev prod mock stub seed temp cache net http fs dom svg png jpg gif css html xml json yaml toml csv md sh bash zsh',
  tools: 'vite immer redis nginx docker stripe react vue angular svelte next nuxt remix astro webpack rollup esbuild babel jest vitest mocha chai cypress playwright puppeteer eslint prettier node deno bun npm yarn pnpm git github gitlab bitbucket jira slack discord notion figma sentry datadog grafana prometheus kibana elasticsearch kafka rabbitmq celery postgres postgresql mysql sqlite mongo mongodb cassandra supabase firebase prisma drizzle sequelize knex typeorm express fastify koa nest hono django flask fastapi rails laravel spring gradle maven cargo rustup tokio serde axum actix pandas numpy scipy torch pytorch tensorflow keras jupyter conda pip poetry pytest kubernetes kubectl helm terraform ansible vagrant consul vault nomad heroku vercel netlify cloudflare wrangler okta twilio sendgrid mailgun shopify paypal plaid openai anthropic claude gemini llama mistral ollama huggingface langchain zod lodash axios dayjs luxon rxjs redux zustand mobx jotai tailwind bootstrap sass postcss storybook electron tauri expo flutter dart kotlin swift xcode android ios linux ubuntu debian alpine macos windows chrome firefox safari webkit chromium vscode neovim tmux homebrew brew jq ffmpeg nix bazel turbo lerna graphql apollo trpc grpc protobuf swagger openapi postman minio presto spark hadoop airflow dbt snowflake bigquery',
  cloud: 'aws gcp azure s3 ec2 iam rds sqs sns ses ecs eks ecr lambda dynamodb kinesis athena cognito cloudfront gke gcs pubsub firestore aks eu us uk ap region zone',
  protocol: 'rest tcp udp dns tls ssl ftp sftp smtp imap mqtt amqp websocket webhook oauth jwt saml sso mfa totp otp cors csrf xss cdn vpn vpc nat lan wan ipv4 ipv6 mtls hsts dkim spf dmarc ca crt pem csr rsa aes des sha md5 hmac utf8 ascii unicode base64 bom crlf eol tel mailto',
  hardware: 'cpu gpu ram ssd hdd numa simd raid iot mutex futex mmap fork pipe signal socket epoll syscall errno stdin stdout stderr malloc sem',
  ai: 'ai ia ml llm nlp gpt rag model dataset tensor epoch batch layer embedding vector prompt agent ensemble inference training eval benchmark gradient',
  css: 'font grid flex block inline margin padding border color background display position absolute relative fixed sticky width height top bottom center align justify content items wrap gap overflow hidden visible opacity transform transition animation hover focus active before after auto inherit initial unset solid dashed dotted bold italic normal sans serif mono monospace cursor pointer outline shadow radius scale rotate translate filter blur media print screen ease linear px em rem vh vw',
  html: 'abbr address article aside audio base blockquote body br button canvas caption code col colgroup data datalist dd details dialog div dl dt embed fieldset figure footer form head header hr iframe img input ins kbd label legend li link main mark menu meta meter nav noscript ol optgroup output param picture pre progress samp script section slot small source span strong style sub summary sup tbody td template textarea tfoot th thead time title track ul video wbr',
  git: 'clone push pull fetch merge rebase stash tag branch checkout switch restore reset revert blame bisect cherry pick status add remote origin master hook show log',
  patterns: 'mvc mvvm orm dto dao di ioc dry solid crud',
  flags: 'verbose quiet force fast watch debug strict silent',
  plans: 'free pro team enterprise solo starter basic premium plus business',
  pages: 'home about pricing blog legal privacy terms contact support careers login signup dashboard settings profile account billing',
  slang: 'algo repo config staging infra perf regex deps auth admin todo fixme hack',
  web3: 'ton eth btc nft dao defi wallet chain',
  social: 'meme emoji sticker avatar feed post story',
  licenses: 'mit apache gpl lgpl bsd mpl isc',
  math: 'sin cos tan exp sqrt floor ceil round pow',
  scripting: 'php isset foreach puts elsif unless rescue ensure die warn chomp',
  java: 'java jar war jvm jdk jre servlet throws final',
  domains: 'com org co',
  security: 'dos ddos mitm sqli rce',
  devops: 'ci cd devops sre qa uat nas san',
  editing: 'comment review lint snippet',
  functional: 'pure immutable closure monad curry thunk',
  maps: 'poi geo lat lng gps tile',
  timezones: 'utc gmt est pst cet cest jst ist',
  dates: 'mon tue wed thu fri sat sun jan feb mar apr jun jul aug sep oct nov dec',
  boards: 'arduino uno esp32 raspberry stm32',
};

const CODE = new Set(Object.values(CODE_TERMS).flatMap((s) => s.split(' ')));

const ALLOWED: Record<(typeof LANGS)[number], Record<string, string>> = {
  es: { del: 'of the, Python del is rarer', su: 'his or her, the su command is rarer', sin: 'without, the sine function is rarer', tan: 'so, the tangent function is rarer', todo: 'all, a TODO marker is rarer', es: 'is, the ECMAScript short name is rarer' },
  de: { des: 'of the, the DES cipher is rare', mit: 'with, the MIT license is rarer', man: 'one, man pages are rarer', du: 'you, the du command is rarer', ins: 'into the, the ins tag is rare', die: 'the, a die call is rare', war: 'was, a war file is rare', es: 'it, the ECMAScript short name is rarer', ist: 'is, the India time zone is rare' },
  fr: { comment: 'how, a code comment is commentaire', des: 'of the, the DES cipher is rare', du: 'of the, the du command is rarer', ses: 'his or her, the mail service is rarer', plus: 'more, the plus plan is rarer', sans: 'without, the sans font is rarer', ca: 'that, a certificate authority is rarer', est: 'is, the US time zone is rarer', cet: 'this, the time zone is rarer', mon: 'my, the Monday short form is rarer' },
  pt: { os: 'the, the os module is rarer', em: 'in, the em unit is rarer', todo: 'all, a TODO marker is rarer', com: 'with, the com domain is rarer', dos: 'of the, a dos attack is rarer', nas: 'in the, a nas drive is rarer' },
  it: { di: 'of, dependency injection is rarer', su: 'on, the su command is rarer', del: 'of the, Python del is rarer', ed: 'and, the ed editor is rare', ci: 'us or there, CI is rarer', poi: 'then, a map point is rarer', uno: 'one, the Arduino board is rarer' },
};

test('the code and tool fixture holds at least 400 plain lowercase terms and no safe list word', () => {
  assert.ok(CODE.size >= 400, String(CODE.size));
  for (const w of CODE) assert.match(w, /^[a-z][a-z0-9]*$/, w);
  for (const l of LANGS) assert.deepEqual(STOP_LISTS[l].filter((w) => CODE.has(w)), [], l);
});

test('the lists for an established language share only a short allow list with code and tool terms', () => {
  for (const l of LANGS) {
    const extra = FULL_LISTS[l].filter((w) => !STOP_LISTS[l].includes(w));
    assert.deepEqual(extra.filter((w) => CODE.has(w)).sort(), Object.keys(ALLOWED[l]).sort(), l);
    assert.ok(Object.keys(ALLOWED[l]).length <= 12, l);
  }
});
