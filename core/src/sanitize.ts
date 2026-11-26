import { redact } from './redact.ts';
import type { Body, Item, RuleBody } from './model.ts';
import { FOOTER } from './recall.ts';

export type Flag = 'hidden' | 'role' | 'override' | 'shell' | 'markup';

const ORDER: Flag[] = ['hidden', 'role', 'override', 'shell', 'markup'];

const ZERO_WIDTH = /[\u200B-\u200F\u2060-\u2064\uFEFF]/g;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g;
const TAGS = /[\u{E0000}-\u{E007F}]/gu;
const CONTROL = /[\u0000-\u0008\u000B-\u001F]/g;

const ROLE_WORDS = '(?:system|assistant|developer|user|tool|human)';
const ROLE_LINE = new RegExp(String.raw`^([ \t>*_]*)(${ROLE_WORDS})((?:[ \t]*:)+)`, 'gim');
const ROLE_LINE_SEEN = new RegExp(String.raw`^[ \t>*_]*${ROLE_WORDS}[ \t]*:`, 'im');
const ROLE_NESTED = new RegExp(String.raw`^[ \t>*_]*${ROLE_WORDS}[ \t]*:(?:[ \t]*:)+(?=\s|$)`, 'im');
const ROLE_TAG = /<[ \t]*(?:(\/)[ \t]*)?((?:system(?:[-_][a-z0-9]+){0,4}|instructions?|important|developer|assistant|human)(?:[ \t\/][^<>\n]{0,200})?)>/gi;
const LOWER_TAG = /<[ \t]*(?:(\/)[ \t]*)?((?:user|tool(?:[-_](?:call|calls|result|results|use))?|function[-_](?:calls|results)|invoke|parameter)(?:[ \t\/][^<>\n]{0,200})?)>/g;
const PIPE_TAG = /<[|\uFF5C][ \t]*([a-z_\u2581]{1,30})[ \t]*[|\uFF5C]>/gi;
const SQUARE_TAG = /\[[ \t]*(?:(\/)[ \t]*)?(INST|SYS|SYSTEM)[ \t]*\]/gi;
const DOUBLE_TAG = /<<[ \t]*(?:(\/)[ \t]*)?(SYS|SYSTEM)[ \t]*>>/gi;
const HEADING = /^([ \t]*)#{1,6}[ \t]*((?:new[ \t]+|system[ \t]+|important[ \t]+)?(?:instructions?|system[ \t]+prompt|prompt)(?:[ \t]*:)?[ \t]*)$/gim;

const OVERRIDE: RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|former|original)\s+(?:instructions?|prompts?|rules?|messages?|directions?|context)\b/i,
  /\bignore\s+(?:all|any)\s+(?:instructions?|rules?)\b/i,
  /\bdisregard\s+(?:all\s+|any\s+)?(?:of\s+)?the\s+above\b/i,
  /\bdisregard\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+)?(?:previous|prior|earlier|preceding|above)\s+(?:instructions?|prompts?|rules?|messages?|directions?)\b/i,
  /\bforget\s+(?:all\s+)?(?:of\s+)?(?:your|the|all|previous|prior|earlier)\s+(?:previous\s+|prior\s+|earlier\s+)?(?:instructions?|rules?|prompts?)\b/i,
  /\bnew\s+instructions?\s*(?:follow|below|:)/i,
  /\b(?:do\s+not|don['\u2019]?t|never)\s+(?:tell|inform|notify|alert|warn)\s+the\s+user\b/i,
  /\bwithout\s+(?:asking|telling|informing|notifying|alerting|warning)\s+the\s+user\b/i,
  /\byou\s+are\s+now\s+(?:a|an|the|in|my|acting|operating|free|unrestricted|jailbroken|dan|no\s+longer)\b/i,
  /\bact\s+as\s+(?:the\s+|a\s+)?system\b/i,
  /\boverride\s+(?:your|the|all)\s+(?:previous\s+)?(?:instructions?|rules?|system\s+prompt)\b/i,
];

const INTERP = String.raw`(?:sudo\s+(?:-\S+\s+)*)?(?:env\s+)?(?:sh|bash|zsh|dash|ksh|fish|python[0-9.]*|node|perl|ruby|iex|invoke-expression|powershell|pwsh)\b`;

const SHELL: RegExp[] = [
  /\b(?:source|(?:ba|z|da|k)?sh)\s+<\(\s*(?:curl|wget)\b/i,
  /\beval\s+["']?\$\(\s*(?:curl|wget)\b/i,
  /\|\s*sudo\s+(?:-\S+\s+)*(?:ba|z|da|k)?sh\b/i,
  /\biex\s*\(\s*(?:iwr|irm|invoke-webrequest|invoke-restmethod|new-object\s+(?:system\.)?net\.webclient)\b/i,
];

const DOWNLOAD = /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b/i;
const DECODE = /\bbase64\s+(?:-d|-D|--decode)\b/i;
const PIPE_INTERP = new RegExp(String.raw`\|\s*${INTERP}`, 'i');
const PIPE_SH = /\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i;

function after(line: string, first: RegExp, then: RegExp): boolean {
  const m = first.exec(line);
  return !!m && then.test(line.slice(m.index + m[0].length));
}

const SUBSHELL = /\b(?:ba|z|da|k)?sh\s+-c\s+["']?(?:\$\(|`)\s*(?:curl|wget|iwr|irm)\b/i;
const OUTPUT = /\s(?:-o|-O|--output(?:-document)?)(?:\s+|=)?[^\s;&|]+/;
const THEN = /&&|;|\|\|/;
const RUN = /(?:^|[\s;&|])(?:sudo\s+)?(?:(?:ba|z|da|k)?sh|source|python[0-9.]*|perl|ruby|node|\.)\s+\S|(?:^|[\s;&|])\.\/\S/i;

function fetchedThenRun(line: string): boolean {
  const d = DOWNLOAD.exec(line);
  if (!d) return false;
  const rest = line.slice(d.index + d[0].length);
  const o = OUTPUT.exec(rest);
  if (!o) return false;
  const tail = rest.slice(o.index + o[0].length);
  const j = THEN.exec(tail);
  return !!j && RUN.test(tail.slice(j.index + j[0].length));
}

function piped(s: string): boolean {
  if (SUBSHELL.test(s)) return true;
  for (const line of s.split('\n')) {
    if (after(line, DOWNLOAD, PIPE_INTERP) || after(line, DECODE, PIPE_SH) || fetchedThenRun(line)) return true;
  }
  return false;
}

const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
const MARKS = /\p{M}/gu;

const LOOKALIKE: [number, string][] = [
  [0x0430, 'a'], [0x0435, 'e'], [0x043a, 'k'], [0x043e, 'o'], [0x0440, 'p'], [0x0441, 'c'], [0x0443, 'y'], [0x0445, 'x'],
  [0x0455, 's'], [0x0456, 'i'], [0x0458, 'j'], [0x04bb, 'h'], [0x04cf, 'l'], [0x0501, 'd'], [0x051b, 'q'], [0x051d, 'w'],
  [0x0410, 'A'], [0x0412, 'B'], [0x0415, 'E'], [0x041a, 'K'], [0x041c, 'M'], [0x041d, 'H'], [0x041e, 'O'], [0x0420, 'P'],
  [0x0421, 'C'], [0x0422, 'T'], [0x0423, 'Y'], [0x0425, 'X'], [0x0405, 'S'], [0x0406, 'I'], [0x0408, 'J'], [0x04ae, 'Y'],
  [0x03b1, 'a'], [0x03b5, 'e'], [0x03b9, 'i'], [0x03ba, 'k'], [0x03bd, 'v'], [0x03bf, 'o'], [0x03c1, 'p'], [0x03c5, 'u'],
  [0x03c7, 'x'], [0x0391, 'A'], [0x0392, 'B'], [0x0395, 'E'], [0x0396, 'Z'], [0x0397, 'H'], [0x0399, 'I'], [0x039a, 'K'],
  [0x039c, 'M'], [0x039d, 'N'], [0x039f, 'O'], [0x03a1, 'P'], [0x03a4, 'T'], [0x03a5, 'Y'], [0x03a7, 'X'],
  [0x0131, 'i'], [0x0261, 'g'], [0x0269, 'i'], [0x0585, 'o'], [0x0570, 'h'],
  [0x2039, '<'], [0x203a, '>'], [0x2329, '<'], [0x232a, '>'], [0x3008, '<'], [0x3009, '>'], [0x276e, '<'], [0x276f, '>'],
];
const FOLD = new Map<string, string>(LOOKALIKE.map(([c, l]) => [String.fromCodePoint(c), l]));

function normalized(s: string): string {
  const n = s.replace(INVISIBLE, '').normalize('NFKC').normalize('NFKD').replace(MARKS, '').replace(INVISIBLE, '');
  let out = '';
  for (const ch of n) out += FOLD.get(ch) ?? ch;
  return out;
}

const once = (re: RegExp) => new RegExp(re.source, re.flags.replace('g', ''));

const ROLE_DETECT = [ROLE_TAG, LOWER_TAG, PIPE_TAG, SQUARE_TAG, DOUBLE_TAG, HEADING].map(once);

const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const BAD_LINK = /(!?\[[^\[\]\n]{0,200}\])\(\s*(?:<\s*)?(?:javascript|data|vbscript)\s*:(?:[^()\n]|\([^()\n]*\))*\)/gi;
const BAD_REF = /^([ \t]*\[[^\]\n]{1,200}\]:)[ \t]*(?:<[ \t]*)?(?:javascript|data|vbscript)\s*:\S*/gim;

function count(s: string, re: RegExp): number {
  return s.match(re)?.length ?? 0;
}

function swap(s: string, re: RegExp, to: string, flag: Flag, flags: Set<Flag>): string {
  const out = s.replace(re, to);
  if (out !== s) flags.add(flag);
  return out;
}

function unwrap(s: string, re: RegExp, flags: Set<Flag>): string {
  const out = s.replace(re, (m: string, ...rest: unknown[]) => {
    const groups = rest.slice(0, -2).map((g) => (typeof g === 'string' ? g : ''));
    const at = rest[rest.length - 2] as number;
    const word = groups.join('');
    const before = at > 0 && /\S/.test(s[at - 1]) ? ' ' : '';
    const after = at + m.length < s.length && /\S/.test(s[at + m.length]) ? ' ' : '';
    return before + word + after;
  });
  if (out !== s) flags.add('role');
  return out;
}

export function sanitize(text: string): { text: string; flags: Flag[] } {
  const flags = new Set<Flag>();
  let s = typeof text === 'string' ? text : '';
  if (count(s, TAGS) || count(s, BIDI) || count(s, ZERO_WIDTH) > 2) flags.add('hidden');
  s = s.replace(TAGS, '').replace(BIDI, '').replace(ZERO_WIDTH, '').replace(CONTROL, '');
  const n = normalized(s);
  if (OVERRIDE.some((re) => re.test(n))) flags.add('override');
  if (SHELL.some((re) => re.test(n)) || piped(n)) flags.add('shell');
  if (ROLE_DETECT.some((re) => re.test(n)) || ROLE_NESTED.test(n) || (ROLE_LINE_SEEN.test(n) && !ROLE_LINE_SEEN.test(s))) flags.add('role');
  s = swap(s, COMMENT, '', 'markup', flags);
  s = swap(s, BAD_LINK, '$1', 'markup', flags);
  s = swap(s, BAD_REF, '$1', 'markup', flags);
  s = swap(s, ROLE_LINE, '$1$2', 'markup', flags);
  if (ROLE_LINE_SEEN.test(s)) s = swap(s, ROLE_LINE, '$1$2', 'role', flags);
  s = unwrap(s, ROLE_TAG, flags);
  s = unwrap(s, LOWER_TAG, flags);
  s = unwrap(s, PIPE_TAG, flags);
  s = unwrap(s, SQUARE_TAG, flags);
  s = unwrap(s, DOUBLE_TAG, flags);
  s = swap(s, HEADING, '$1$2', 'role', flags);
  return { text: s, flags: ORDER.filter((f) => flags.has(f)) };
}

const LT = '(?:<|&lt;|&#0*60;|&#x0*3c;)';
const GT = '(?:>|&gt;|&#0*62;|&#x0*3e;)';
const PRIVATE = new RegExp(String.raw`${LT}[ \t]*private[ \t]*${GT}[\s\S]*?(?:${LT}[ \t]*\/[ \t]*private[ \t]*${GT}|$)`, 'gi');
const OWN_START = /^[ \t>]*agent-ctx memory\b/i;

export function stripPrivate(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(PRIVATE, '');
}

export function stripOwn(text: string): string {
  if (typeof text !== 'string') return '';
  if (!/agent-ctx memory/i.test(text)) return text;
  const out: string[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (!inside && OWN_START.test(line)) inside = true;
    if (inside) {
      if (line.includes(FOOTER)) inside = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function mapStrings(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = mapStrings(x, fn);
    return out;
  }
  return v;
}

const HOLD = new Set<string>(['role', 'override', 'shell']);

export function sanitizeItem(item: Item): Item {
  const flags = new Set<string>(item.flags ?? []);
  const clean = (s: string): string => {
    const r = sanitize(redact(stripOwn(stripPrivate(s))));
    for (const f of r.flags) flags.add(f);
    return r.text;
  };
  let body: Body;
  if (item.kind === 'rule') {
    const b = item.body as RuleBody;
    body = { ...b, text: clean(b.text ?? ''), words: clean(b.words ?? '') };
  } else {
    body = mapStrings(item.body, clean) as Body;
  }
  const list = [...flags];
  return { ...item, body, flags: list, held: item.held || list.some((f) => HOLD.has(f)) };
}
