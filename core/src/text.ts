const STOP = new Set(
  (
    'a an and are as at be been but by can could did do does doing done for from had has have having he her here hers him his how i if in into is it its just me more most my no nor not of off on once only or other our ours out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours ' +
    'also about after again all am any because before below between both each few further let lets like make made need needs now ok okay please pls really get got go going want wants thing things way yes yeah sure still even every much many one two use used using new see look able sorry thanks thank right well back down same try tried src lib index util utils component components'
  ).split(' '),
);

const words = (...lines: string[]): string[] => lines.join(' ').split(' ');

export const STOP_LISTS: Readonly<Record<'es' | 'de' | 'fr' | 'pt' | 'it', readonly string[]>> = {
  es: words(
    'que los unos unas por desde hacia durante segun cuando donde porque aunque mientras pues entonces tambien muy esta estos estas esto eso otro otra otros otras mismo tanto todas cual quien ellos siempre nunca ahora fue estan sido puede',
    'hasta mediante tras dentro',
    'ello ellas usted ustedes nosotros nosotras vosotros vosotras nuestro nuestra nuestros nuestras vuestro vuestra vuestros vuestras suyo suya suyos suyas tuyo tuya',
    'esos esas aquel aquella aquello aquellos aquellas quienes cuales cuyo cuya cuyos cuyas alguien nadie alguno alguna algunos algunas algun ninguno ninguna ningun',
    'misma mismos mismas toda cada varios varias mucha muchos muchas poca pocos pocas tanta tantos tantas demasiado demasiada demasiados cualquier cualquiera ambos ambas',
    'sino tampoco ademas luego',
    'somos eres eran fueron siendo seria estoy estamos estaba estaban habia habian habra haya hubo hubiera puedo puedes podemos pueden podia podria pudo',
    'debe deben debemos deberia tiene tienen tenemos tenia hace hacen hizo quiero quiere queremos',
    'cuanto cuanta cuantos cuantas adonde',
    'menos bien todavia jamas despues aqui alli ahi casi vez quizas quiza bastante apenas',
    'hola gracias perfecto bueno buena buenos buenas listo venga adelante saludos perdon disculpa porfa porfavor sigue oye',
  ),
  de: words(
    'ein eine einen einem einer eines nicht kein keine sich auch sie ich wir ihr wird werden wurde sind haben kann noch nur wie wenn dann aber weil dass durch nach zum zur beim unter ohne mehr sehr diese dieser',
    'keinen keinem keiner keines',
    'gegen hinter neben seit trotz wahrend wegen zwischen innerhalb ausserhalb gegenuber entlang statt vor',
    'mich dich uns euch ihm ihn ihnen mein meine meinen meinem meiner dein deine deinen sein seinen seinem seiner seines ihre ihren ihrem ihrer unser unsere unseren unserem euer eure',
    'dieses diesen diesem jener jene jenes welcher welche welches welchen jemand niemand etwas nichts alle alles jeder jede jedes jeden beide beiden viele vielen wenige einige manche selbst selber',
    'denn sondern obwohl damit sobald sodass bevor nachdem sowie jedoch trotzdem deshalb daher darum sonst',
    'bist seid gewesen habe hast habt hatte hatten gehabt werde wirst werdet wurden worden geworden kannst konnen konnte konnten musst mussen musste mussten',
    'soll sollst sollen sollte sollten willst wollen wollte wollten darf durfen durfte mochte mochten',
    'wer wem wessen wann warum wieso weshalb woher wohin womit wofur worum wozu woran worauf wodurch',
    'schon nie jetzt hier dort gerade wieder ganz etwa eben eigentlich vielleicht wirklich ziemlich bereits sofort zuerst',
    'dabei dazu davon dafur daran darauf dadurch deswegen ebenfalls sogar kaum leider naturlich nein doch eher irgendwie genau',
    'danke bitte gerne gern klar tschuss servus moin',
  ),
  fr: words(
    'que quoi donc avec depuis selon parmi elles leur leurs notre votre vos lui aussi alors ainsi puis toujours jamais souvent tous toute toutes comme quand puisque lorsque jusqu ceux celui cette chaque quelques etre etait sont ont peut peuvent',
    'dans chez contre apres malgre envers hors durant jusque avant voici',
    'eux moi toi soi ceci cela celle celles lequel laquelle lesquels lesquelles quelque chacun chacune aucun aucune rien autre autres plusieurs certains certaines telle telles',
    'parce quoique tandis cependant pourtant sinon soit toutefois ensuite enfin',
    'suis sommes etes etaient serait seront avons avez avait avaient aurait aurons peux pouvons pouvez pourrait dois devons devez doivent devrait',
    'veux veut voulons voulez veulent voudrais faut fallait fait faites vais vont allons',
    'pourquoi combien quel quelle quels quelles',
    'moins trop bien deja parfois ici maintenant bientot tard beaucoup peu assez tellement tant presque surtout seulement vraiment ailleurs partout oui longtemps autant',
    'dessus dessous dedans dehors plutot',
    'bonjour salut merci coucou bonsoir desole allez',
  ),
  pt: words(
    'uma umas uns quando porque enquanto embora porem desde durante apenas isso isto essa esta aquele aquela ela eles elas seus nosso nossa quem tambem muito muitos ainda sempre nunca depois entao aqui estao sido podem deve toda todas mesmo',
    'nuns dumas neste nesta nestes nestas nesse nessa nesses nessas naquele naquela deste desta destes destas desse dessa desses dessas daquele daquela',
    'por apos perante pra mediante',
    'voce voces lhe lhes mim comigo contigo conosco meu minha meus minhas teu tua teus tuas nossos nossas dela deles delas esse esses essas aquilo aqueles aquelas',
    'qual quais cujo cuja alguem ninguem tudo algum alguma alguns algumas nenhum nenhuma muita muitas pouca poucos poucas tanta tantos varios varias mesma mesmos mesmas proprio propria outra outros outras cada',
    'que contudo todavia entretanto pois portanto conforme nem',
    'sou somos eram foram seja sejam seria estou estamos estava estavam esteve tenho temos tinha tinham teve havia houve',
    'posso pode podemos podia poderia pude devo devemos devem deveria vou vai vao faz fazem quero quer',
    'onde aonde quanto quantos quantas',
    'menos jamais quase talvez bastante demais cedo somente assim',
    'obrigado obrigada valeu beleza otimo perfeito tchau blz vlw',
  ),
  it: words(
    'gli tra dello degli dalla dagli nel nella negli nelle sulla sulle essere hanno questo questa questi queste quello quella quelli molto molti gia piu quindi cosi tutto tutte ogni qualche alcuni senza mentre invece oppure dopo cui quale puo',
    'delle dallo dalle allo nello nei sullo sugli',
    'sotto sopra dentro fuori contro presso oltre tramite attraverso durante insieme',
    'noi voi miei tuo tuoi suo suoi nostro nostra nostri nostre vostro vostra vostri vostre quelle quel quali qualcuno qualcosa nessuno nessuna niente ognuno',
    'altro altra altri altre stesso stessa stessi stesse molta molte pochi poche troppo troppa troppi alcune ciascuno ciascuna',
    'quando dunque neanche nemmeno cioe infatti tuttavia siccome finche affinche benche sebbene',
    'siamo siete erano ero sarebbe abbiamo avete aveva avevano avuto avra avrebbe posso puoi possiamo potete possono poteva potrebbe',
    'devo deve dobbiamo dovete devono doveva dovrebbe voglio vuoi vuole vogliamo volete vogliono vorrei faccio fai facciamo fanno vado vai andiamo vanno sto stai stiamo stanno hai',
    'cosa quanto quanti quante',
    'meno ancora sempre spesso adesso bene soltanto subito tardi forse davvero proprio appena abbastanza piuttosto ovviamente comunque purtroppo finalmente infine',
    'grazie prego perfetto benissimo ottimo buongiorno buonasera arrivederci allora certo scusa scusi favore perfavore',
  ),
};

const EXTRA: Record<keyof typeof STOP_LISTS, readonly string[]> = {
  es: words(
    'el la de en con del para las una un al se lo le les su sus es ha como mas pero sin entre ya hay son ni mi me te nos',
    'yo tu ella mis tus ese esa este nada todo todos mucho poco ante antes contra sobre si asi',
    'era sea sean ser estar han va voy vamos iba tengo tal tan pronto mal aun vale genial favor',
  ),
  de: words(
    'der die das den dem des und ist mit im am an auf aus bei fur uber um zu von vom es er man als oder war hat bis so da wo also',
    'du ab ob ins ans aufs mag sei ware seine wen nun oft bald mal ja gut dank mach toll prima hallo falls muss',
  ),
  fr: words(
    'le la les de des du un une et est en au aux ce ces cet se sa son ses il ils elle ne pas par pour sur qui mais ou nous vous tout plus tres sans mon ma mes nos car si',
    'je tu te ca dont ta tes sous vers pendant ni',
    'ete sera pu aura doit va comment voila encore tot non pardon accord bravo genial parfait svp stp',
  ),
  pt: words(
    'os de da dos das em no na nos nas um com para pelo pela pelos pelas ao aos se nao mais mas como ele seu sua suas foi tem ser sao ja',
    'tu te si ti lo la vos ou sob ate dum duma dele outro todo todos nada pouco quanta',
    'era ha vamos fez sim bem mal agora antes tao boa oi ola favor',
  ),
  it: words(
    'il lo la le di da con per su del dei dal al alla agli alle un una uno che non si ci ne ma come sono anche loro ha ho mi ti sul sui fra',
    'tu lei te se ce ve mio mia mie sua sue chi tutti nulla della dai coi verso prima poi sia ed od',
    'sei era sara devi sta fa va qui qua ora mai male quasi dove quanta perche bravo salve ciao',
  ),
};

export const FULL_LISTS: Readonly<Record<keyof typeof STOP_LISTS, readonly string[]>> = {
  es: [...STOP_LISTS.es, ...EXTRA.es],
  de: [...STOP_LISTS.de, ...EXTRA.de],
  fr: [...STOP_LISTS.fr, ...EXTRA.fr],
  pt: [...STOP_LISTS.pt, ...EXTRA.pt],
  it: [...STOP_LISTS.it, ...EXTRA.it],
};

const SAFE_BY_WORD = new Map<string, string[]>();
for (const [l, safe] of Object.entries(STOP_LISTS)) for (const w of safe) SAFE_BY_WORD.set(w, [...(SAFE_BY_WORD.get(w) ?? []), l]);

const ALL_STOP = new Set([...STOP, ...Object.values(STOP_LISTS).flat()]);

export type Lang = keyof typeof STOP_LISTS;

function held(words: string[]): Lang[] {
  const seen = new Map<string, Set<string>>();
  for (const w of words) {
    for (const l of SAFE_BY_WORD.get(w) ?? []) {
      const s = seen.get(l) ?? new Set<string>();
      s.add(w);
      seen.set(l, s);
    }
  }
  return [...seen].filter(([, s]) => s.size >= 2).map(([l]) => l as Lang);
}

export const LANG_CARDS = 2;
export const LANG_SHARE = [3, 10] as const;

export function projectLanguages(cards: readonly (readonly Lang[])[]): Lang[] {
  const count = new Map<Lang, number>();
  for (const langs of cards) for (const l of new Set(langs)) count.set(l, (count.get(l) ?? 0) + 1);
  return [...count].filter(([, c]) => c >= LANG_CARDS && c * LANG_SHARE[1] >= LANG_SHARE[0] * cards.length).map(([l]) => l);
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

type Rule = (w: string) => string;

const PLURAL: Partial<Record<Lang, Rule>> = {
  it: (w) => {
    const s = w.length >= 5 && /[aeio]$/.test(w) ? w.slice(0, -1) : w;
    return s.length >= 5 && /[cg]h$/.test(s) ? s.slice(0, -1) : s;
  },
};

function word(w: string, out: string[], extra: Set<string>, rules: Rule[]): void {
  if (ASCII.test(w)) {
    if (w.length < 2 || w.length > 30) return;
    if (/^\d+$/.test(w) && w.length > 4) return;
    if (ALL_STOP.has(w) || extra.has(w)) return;
    out.push(rules.reduce((s, r) => r(s), stem(w)));
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

function partsOf(text: string): Part[] {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const parts: Part[] = [];
  for (const m of fold(spaced).matchAll(WORD)) split(m[0], parts);
  return parts;
}

const wordsIn = (parts: Part[]): string[] => parts.filter((p) => p[1]).map((p) => p[0]);

export function languagesOf(text: string): Lang[] {
  return text ? held(wordsIn(partsOf(text))) : [];
}

export function tokens(text: string, langs: readonly Lang[] = []): string[] {
  if (!text) return [];
  const parts = partsOf(text);
  const extra = new Set<string>();
  for (const l of new Set([...held(wordsIn(parts)), ...langs])) for (const w of FULL_LISTS[l]) extra.add(w);
  const rules = langs.flatMap((l) => PLURAL[l] ?? []);
  const out: string[] = [];
  for (const [p, isWord] of parts) {
    if (isWord) word(p, out, extra, rules);
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
