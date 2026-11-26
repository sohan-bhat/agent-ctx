const QUOTE = 34;
const SLASH = 92;

const name = (s: string) => Buffer.from(s);
const RESULT = name('toolUseResult');
const TYPE = name('type');
const BLANKED = [name('data'), name('signature'), name('thinking')];
const KINDS = [name('user'), name('assistant')];

export const SLIM_FROM = 16 * 1024;
const LONG = 1024;

interface Cut {
  from: number;
  to: number;
  put: string;
}

const BAD = new Error('bad line');

function stringEnd(buf: Buffer, open: number): number {
  for (let q = buf.indexOf(QUOTE, open + 1); q !== -1; q = buf.indexOf(QUOTE, q + 1)) {
    let k = 0;
    while (buf[q - 1 - k] === SLASH) k++;
    if (k % 2 === 0) return q;
  }
  throw BAD;
}

function space(buf: Buffer, i: number): number {
  while (buf[i] === 32 || buf[i] === 9 || buf[i] === 10 || buf[i] === 13) i++;
  return i;
}

function same(buf: Buffer, a: number, b: number, n: Buffer): boolean {
  return b - a === n.length && buf.compare(n, 0, n.length, a, b) === 0;
}

interface Walk {
  cuts: Cut[];
  kind: boolean;
}

function value(buf: Buffer, at: number, blank: boolean, w: Walk | null, top: boolean): number {
  let i = space(buf, at);
  const c = buf[i];
  if (c === QUOTE) {
    const q = stringEnd(buf, i);
    if (blank && w && q - i > LONG) w.cuts.push({ from: i, to: q + 1, put: '""' });
    return q + 1;
  }
  if (c === 123) {
    i = space(buf, i + 1);
    if (buf[i] === 125) return i + 1;
    for (;;) {
      if (buf[i] !== QUOTE) throw BAD;
      const q = stringEnd(buf, i);
      const k0 = i + 1;
      i = space(buf, q + 1);
      if (buf[i] !== 58) throw BAD;
      i++;
      if (w && top && same(buf, k0, q, RESULT)) {
        const from = space(buf, i);
        i = value(buf, from, false, null, false);
        if (i - from > 4) w.cuts.push({ from, to: i, put: 'null' });
      } else if (w && top && same(buf, k0, q, TYPE)) {
        const from = space(buf, i);
        i = value(buf, from, false, null, false);
        if (buf[from] === QUOTE) w.kind = KINDS.some((n) => same(buf, from + 1, i - 1, n));
      } else i = value(buf, i, BLANKED.some((n) => same(buf, k0, q, n)), w, false);
      i = space(buf, i);
      if (buf[i] === 44) {
        i = space(buf, i + 1);
        continue;
      }
      if (buf[i] === 125) return i + 1;
      throw BAD;
    }
  }
  if (c === 91) {
    i = space(buf, i + 1);
    if (buf[i] === 93) return i + 1;
    for (;;) {
      i = space(buf, value(buf, i, false, w, false));
      if (buf[i] === 44) {
        i++;
        continue;
      }
      if (buf[i] === 93) return i + 1;
      throw BAD;
    }
  }
  const start = i;
  while (i < buf.length && buf[i] !== 44 && buf[i] !== 125 && buf[i] !== 93) i++;
  if (i >= buf.length || i === start) throw BAD;
  return i;
}

export function slim(buf: Buffer): Buffer {
  if (buf.length < SLIM_FROM || buf[0] !== 123) return buf;
  const w: Walk = { cuts: [], kind: false };
  try {
    if (value(buf, 0, false, w, true) !== buf.length) return buf;
  } catch {
    return buf;
  }
  if (!w.kind || !w.cuts.length) return buf;
  const parts: Buffer[] = [];
  let at = 0;
  for (const c of w.cuts.sort((x, y) => x.from - y.from)) {
    parts.push(buf.subarray(at, c.from), Buffer.from(c.put));
    at = c.to;
  }
  parts.push(buf.subarray(at));
  return Buffer.concat(parts);
}
