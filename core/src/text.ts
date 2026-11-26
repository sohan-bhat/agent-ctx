const STOP = new Set(
  (
    'a an and are as at be been but by can could did do does doing done for from had has have having he her here hers him his how i if in into is it its just me more most my no nor not of off on once only or other our ours out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours ' +
    'also about after again all am any because before below between both each few further let lets like make made need needs now ok okay please pls really get got go going want wants thing things way yes yeah sure still even every much many one two use used using new see look able sorry thanks thank right well back down same try tried src lib index util utils component components'
  ).split(' '),
);

export const STOP_LISTS: Readonly<Record<'es' | 'de' | 'fr' | 'pt' | 'it', readonly string[]>> = {
  es: 'que los unos unas por desde hacia durante segun cuando donde porque aunque mientras pues entonces tambien muy esta estos estas esto eso otro otra otros otras mismo tanto todas cual quien ellos siempre nunca ahora fue estan sido puede'.split(' '),
  de: 'ein eine einen einem einer eines nicht kein keine sich auch sie ich wir ihr wird werden wurde sind haben kann noch nur wie wenn dann aber weil dass durch nach zum zur beim unter ohne mehr sehr diese dieser'.split(' '),
  fr: 'que quoi donc avec depuis selon parmi elles leur leurs notre votre vos lui aussi alors ainsi puis toujours jamais souvent tous toute toutes comme quand puisque lorsque jusqu ceux celui cette chaque quelques etre etait sont ont peut peuvent'.split(' '),
  pt: 'uma umas uns quando porque enquanto embora porem desde durante apenas isso isto essa esta aquele aquela ela eles elas seus nosso nossa quem tambem muito muitos ainda sempre nunca depois entao aqui estao sido podem deve toda todas mesmo'.split(' '),
  it: 'gli tra dello degli dalla dagli nel nella negli nelle sulla sulle essere hanno questo questa questi queste quello quella quelli molto molti gia piu quindi cosi tutto tutte ogni qualche alcuni senza mentre invece oppure dopo cui quale puo'.split(' '),
};

const EXTRA: Record<keyof typeof STOP_LISTS, string> = {
  es: 'el la de en con del para las una un al se lo le les su sus es ha como mas pero sin entre ya hay son ni mi me te nos',
  de: 'der die das den dem des und ist mit im am an auf aus bei fur uber um zu von vom es er man als oder war hat bis so da wo also',
  fr: 'le la les de des du un une et est en au aux ce ces cet se sa son ses il ils elle on ne pas par pour sur dans qui mais ou nous vous tout plus tres sans mon ma mes nos car si',
  pt: 'os as de do da dos das em no na nos nas um com para por pelo pela pelos pelas ao aos se que nao mais mas como ele seu sua suas foi tem ser sao ja',
  it: 'il lo la le di da in con per su del dei dal al alla allo ai agli alle un una uno che non si ci ne ma come sono anche loro ha ho mi ti sul sui fra',
};

export const FULL_LISTS: Readonly<Record<keyof typeof STOP_LISTS, readonly string[]>> = {
  es: [...STOP_LISTS.es, ...EXTRA.es.split(' ')],
  de: [...STOP_LISTS.de, ...EXTRA.de.split(' ')],
  fr: [...STOP_LISTS.fr, ...EXTRA.fr.split(' ')],
  pt: [...STOP_LISTS.pt, ...EXTRA.pt.split(' ')],
  it: [...STOP_LISTS.it, ...EXTRA.it.split(' ')],
};

const SAFE_BY_WORD = new Map<string, string[]>();
for (const [l, safe] of Object.entries(STOP_LISTS)) for (const w of safe) SAFE_BY_WORD.set(w, [...(SAFE_BY_WORD.get(w) ?? []), l]);

const ALL_STOP = new Set([...STOP, ...Object.values(STOP_LISTS).flat()]);

function languageStops(words: string[]): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const w of words) {
    for (const l of SAFE_BY_WORD.get(w) ?? []) {
      const s = seen.get(l) ?? new Set<string>();
      s.add(w);
      seen.set(l, s);
    }
  }
  const out = new Set<string>();
  for (const [l, s] of seen) if (s.size >= 2) for (const w of FULL_LISTS[l as keyof typeof STOP_LISTS]) out.add(w);
  return out;
}

export function isStop(w: string): boolean {
  return ALL_STOP.has(w);
}

function suffix(w: string): string {
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4 && !w.endsWith('eed')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

export function stem(w: string): string {
  if (w.length <= 3) return w;
  const s = suffix(w);
  if (s.length >= 4 && s.endsWith('e') && !s.endsWith('ee')) return s.slice(0, -1);
  return s;
}

const FOLDED = /([\p{Script=Latin}\p{Script=Greek}\p{Script=Arabic}\p{Script=Hebrew}])\p{M}+/gu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu;
const MARK = /^\p{M}$/u;
const UNSPACED = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\u30FC]$/u;
const ASCII = /^[a-z0-9]+$/;

const STACK = /\p{M}{9,}/gu;
const MARKS_KEPT = 8;

function fold(text: string): string {
  const capped = text.replace(STACK, (m) => [...m].slice(0, MARKS_KEPT).join(''));
  return capped.normalize('NFKD').replace(FOLDED, '$1').normalize('NFC').toLowerCase();
}

function word(w: string, out: string[], extra: Set<string>): void {
  if (ASCII.test(w)) {
    if (w.length < 2 || w.length > 30) return;
    if (/^\d+$/.test(w) && w.length > 4) return;
    if (ALL_STOP.has(w) || extra.has(w)) return;
    out.push(stem(w));
    return;
  }
  const n = [...w].length;
  if (n >= 2 && n <= 30) out.push(w);
}

type Part = [string, boolean];

function pairs(units: string[], out: Part[]): void {
  if (units.length === 1) out.push([units[0], false]);
  for (let k = 0; k + 1 < units.length; k++) out.push([units[k] + units[k + 1], false]);
}

function split(run: string, out: Part[]): void {
  let units: string[] = [];
  let rest = '';
  const flush = () => {
    if (units.length) pairs(units, out);
    if (rest) out.push([rest, true]);
    units = [];
    rest = '';
  };
  for (const ch of run) {
    if (MARK.test(ch)) {
      if (units.length && !rest) units[units.length - 1] += ch;
      else rest += ch;
      continue;
    }
    if (UNSPACED.test(ch)) {
      if (rest) flush();
      units.push(ch);
    } else {
      if (units.length) flush();
      rest += ch;
    }
  }
  flush();
}

export function tokens(text: string): string[] {
  if (!text) return [];
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const parts: Part[] = [];
  for (const m of fold(spaced).matchAll(WORD)) split(m[0], parts);
  const extra = languageStops(parts.filter((p) => p[1]).map((p) => p[0]));
  const out: string[] = [];
  for (const [p, isWord] of parts) {
    if (isWord) word(p, out, extra);
    else out.push(p);
  }
  return out;
}

export function fileTokens(file: string): string[] {
  const parts = file.split('/').filter(Boolean);
  const base = parts[parts.length - 1] ?? '';
  const parent = parts[parts.length - 2] ?? '';
  const name = base.replace(/\.[a-z0-9]{1,6}$/i, '');
  return [...tokens(name), ...tokens(parent)];
}

const PHRASES: [RegExp, string][] = [
  [/\bsign[\s_-]*in\b/gi, 'signin'],
  [/\blog[\s_-]*in\b/gi, 'login'],
  [/\bsign[\s_-]*up\b/gi, 'signup'],
  [/\b(?:log|sign)[\s_-]*out\b/gi, 'logout'],
  [/\bend[\s_-]+to[\s_-]+end\b/gi, 'e2e'],
  [/\bpull[\s_-]+requests?\b/gi, 'pr'],
  [/\bmerge[\s_-]+requests?\b/gi, 'mr'],
  [/\bweb[\s_-]*sockets?\b/gi, 'websocket'],
  [/\bout[\s_-]+of[\s_-]+memory\b/gi, 'oom'],
  [/\btime[\s_-]*zones?\b/gi, 'timezone'],
  [/\brate[\s_-]+limit(?:s|ed|ing)?\b/gi, 'ratelimit'],
  [/\bapi[\s_-]+keys?\b/gi, 'apikey'],
  [/\benv(?:ironment)?[\s_-]+var(?:iable)?s?\b/gi, 'envvar'],
];

export const GROUPS: string[][] = [
  ['login', 'signin', 'logon', 'auth', 'authentication', 'authenticate'],
  ['signup', 'register', 'registration', 'onboarding'],
  ['logout', 'signout'],
  ['password', 'passphrase', 'passcode'],
  ['token', 'credential', 'credentials', 'apikey', 'secret'],
  ['permission', 'permissions', 'access', 'role', 'roles', 'authorization'],
  ['admin', 'administrator', 'moderator', 'superuser'],
  ['user', 'account', 'profile'],
  ['session', 'cookie'],
  ['picture', 'image', 'photo', 'img', 'thumbnail'],
  ['speed', 'fast', 'slow', 'performance', 'perf', 'latency', 'sluggish'],
  ['crash', 'exception', 'panic', 'segfault'],
  ['timeout', 'hang', 'hangs', 'freeze', 'frozen', 'unresponsive'],
  ['delete', 'erase', 'destroy', 'purge'],
  ['settings', 'config', 'configuration', 'preferences', 'prefs', 'options'],
  ['docs', 'documentation', 'readme', 'guide'],
  ['repo', 'repository', 'monorepo'],
  ['db', 'database', 'datastore'],
  ['deps', 'dependency', 'dependencies', 'package', 'packages', 'library', 'libraries'],
  ['deploy', 'deployment', 'release', 'ship', 'publish', 'rollout'],
  ['rollback', 'downgrade'],
  ['upgrade', 'bump'],
  ['phone', 'mobile', 'smartphone', 'iphone', 'android'],
  ['big', 'large', 'huge', 'bloated', 'oversized'],
  ['email', 'mail', 'mailer', 'smtp'],
  ['notification', 'notify', 'alert', 'warning', 'alarm'],
  ['cache', 'memoize', 'memoization', 'memo'],
  ['thread', 'worker', 'concurrency', 'parallel', 'parallelism'],
  ['memory', 'ram', 'heap', 'oom', 'leak'],
  ['cpu', 'processor'],
  ['storage', 'disk', 'blob'],
  ['backend', 'server'],
  ['endpoint', 'route', 'handler', 'api'],
  ['frontend', 'ui', 'client'],
  ['button', 'btn'],
  ['search', 'find'],
  ['upload', 'attach', 'attachment'],
  ['export', 'download'],
  ['ci', 'pipeline', 'workflow'],
  ['compile', 'compiler', 'bundle', 'bundler'],
  ['lint', 'linter', 'eslint'],
  ['format', 'formatter', 'prettier'],
  ['log', 'logging', 'trace', 'tracing'],
  ['metric', 'metrics', 'telemetry', 'analytics', 'monitoring'],
  ['backup', 'snapshot', 'dump'],
  ['migration', 'migrate', 'schema'],
  ['env', 'environment', 'envvar', 'dotenv'],
  ['container', 'docker', 'dockerfile'],
  ['websocket', 'socket', 'realtime'],
  ['refresh', 'reload'],
  ['queue', 'job', 'cron', 'scheduler'],
  ['timezone', 'tz', 'utc'],
  ['timestamp', 'datetime'],
  ['accessibility', 'a11y', 'screenreader'],
  ['i18n', 'translation', 'localization', 'l10n', 'translate'],
  ['offline', 'pwa', 'serviceworker'],
  ['payment', 'billing', 'checkout', 'invoice'],
  ['chart', 'graph', 'plot'],
  ['ratelimit', 'throttle', 'throttling'],
  ['pr', 'mr'],
  ['e2e', 'playwright', 'cypress'],
];

const ALL = new RegExp(PHRASES.map(([re]) => `(${re.source})`).join('|'), 'gi');

export function joinPhrases(text: string): string {
  return (text ?? '').replace(ALL, (...m: unknown[]) => {
    for (let k = 0; k < PHRASES.length; k++) if (m[k + 1] !== undefined) return PHRASES[k][1];
    return m[0] as string;
  });
}

const INDEX = new Map<string, string[]>();
for (const group of GROUPS) {
  const stems = [...new Set(group.flatMap((w) => tokens(joinPhrases(w))))];
  for (const s of stems) {
    const others = stems.filter((x) => x !== s);
    INDEX.set(s, [...new Set([...(INDEX.get(s) ?? []), ...others])]);
  }
}

export function synonymsOf(term: string): string[] {
  return INDEX.get(term) ?? [];
}

export function vocabulary(): string[] {
  return [...INDEX.keys()];
}

export const K1 = 1.2;
export const B = 0.75;

export interface Postings {
  [term: string]: number[];
}

export interface Bm25Data {
  n: number;
  avgdl: number;
  dl: number[];
  terms: Postings;
}

export interface Bm25View {
  n: number;
  avgdl: number;
  dl: number[];
  get(term: string): number[] | undefined;
}

export function buildBm25(docs: string[][]): Bm25Data {
  const terms: Postings = Object.create(null);
  const dl: number[] = [];
  let total = 0;
  docs.forEach((toks, i) => {
    dl.push(toks.length);
    total += toks.length;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, n] of tf) {
      let p = terms[t];
      if (!p) p = terms[t] = [];
      p.push(i, n);
    }
  });
  return { n: docs.length, avgdl: docs.length ? total / docs.length : 0, dl, terms };
}

export function view(data: Bm25Data): Bm25View {
  return { n: data.n, avgdl: data.avgdl, dl: data.dl, get: (t) => data.terms[t] };
}

export function bucketOf(term: string, buckets: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < term.length; i++) {
    h ^= term.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % buckets;
}

export function idf(n: number, df: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

export interface Scored {
  doc: number;
  score: number;
  norm: number;
  matched: number;
}

export const COMMON = 0.5;

export function search(data: Bm25View, query: string[], weights?: Map<string, number>): Scored[] {
  const q = new Map<string, number>();
  for (const t of query) q.set(t, (q.get(t) || 0) + (weights?.get(t) ?? 1));
  const n = data.n;
  const acc = new Float64Array(n);
  const hit = new Uint16Array(n);
  const touched: number[] = [];
  const avg = data.avgdl || 1;
  const dl = data.dl;
  let max = 0;
  for (const [t, qw] of q) {
    const p = data.get(t);
    if (!p) continue;
    const df = p.length / 2;
    if (n >= 20 && df / n > COMMON) continue;
    const w = idf(n, df) * qw;
    max += w * (K1 + 1);
    for (let i = 0; i < p.length; i += 2) {
      const doc = p[i];
      const tf = p[i + 1];
      const s = (w * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dl[doc]) / avg));
      if (hit[doc] === 0) touched.push(doc);
      acc[doc] += s;
      hit[doc]++;
    }
  }
  const out: Scored[] = [];
  for (const doc of touched) out.push({ doc, score: acc[doc], norm: max ? acc[doc] / max : 0, matched: hit[doc] });
  out.sort((a, b) => b.score - a.score);
  return out;
}
