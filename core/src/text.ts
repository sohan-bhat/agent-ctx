const STOP = new Set(
  (
    'a an and are as at be been but by can could did do does doing done for from had has have having he her here hers him his how i if in into is it its just me more most my no nor not of off on once only or other our ours out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours ' +
    'also about after again all am any because before below between both each few further let lets like make made need needs now ok okay please pls really get got go going want wants thing things way yes yeah sure still even every much many one two use used using new see look able sorry thanks thank right well back down same try tried src lib index util utils component components'
  ).split(' '),
);

export function isStop(w: string): boolean {
  return STOP.has(w);
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

function word(w: string, out: string[]): void {
  if (ASCII.test(w)) {
    if (w.length < 2 || w.length > 30) return;
    if (/^\d+$/.test(w) && w.length > 4) return;
    if (STOP.has(w)) return;
    out.push(stem(w));
    return;
  }
  const n = [...w].length;
  if (n >= 2 && n <= 30) out.push(w);
}

function pairs(units: string[], out: string[]): void {
  if (units.length === 1) out.push(units[0]);
  for (let k = 0; k + 1 < units.length; k++) out.push(units[k] + units[k + 1]);
}

function split(run: string, out: string[]): void {
  let units: string[] = [];
  let rest = '';
  const flush = () => {
    if (units.length) pairs(units, out);
    if (rest) word(rest, out);
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
  const out: string[] = [];
  for (const m of fold(spaced).matchAll(WORD)) split(m[0], out);
  return out;
}

export function fileTokens(file: string): string[] {
  const parts = file.split('/').filter(Boolean);
  const base = parts[parts.length - 1] ?? '';
  const parent = parts[parts.length - 2] ?? '';
  const name = base.replace(/\.[a-z0-9]{1,6}$/i, '');
  return [...tokens(name), ...tokens(parent)];
}
