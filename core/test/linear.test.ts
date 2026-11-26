import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { sanitize, stripOwn, stripPrivate } from '../src/sanitize.ts';
import { redact } from '../src/redact.ts';

const K = 8192;
const BAR = 20;

function fill(head: string, unit: string, tail = ''): string {
  return (head + unit.repeat(Math.ceil(K / Math.max(1, unit.length)))).slice(0, K - tail.length) + tail;
}

const CALLS: [string, (s: string) => unknown][] = [
  ['sanitize', sanitize],
  ['redact', redact],
  ['stripPrivate', stripPrivate],
  ['stripOwn', stripOwn],
];

function timeOnce(fn: (s: string) => unknown, s: string): number {
  const t = performance.now();
  fn(s);
  return performance.now() - t;
}

function timeBest(fn: (s: string) => unknown, s: string): number {
  let best = timeOnce(fn, s);
  for (let k = 0; k < 2 && best > BAR; k++) best = Math.min(best, timeOnce(fn, s));
  return best;
}

const REVIEWER: [string, string][] = [
  ['<< then spaces', fill('<<', ' ')],
  ['< then spaces', fill('<', ' ')],
  ['[ then spaces', fill('[', ' ')],
  ['# prompt then spaces then x', fill('# prompt', ' ', 'x')],
  ['[ repeated', fill('', '[')],
  ['a. repeated', fill('', 'a.')],
  ['curl repeated', fill('', 'curl ')],
];

const OWN: [string, string][] = [
  ['tag then slash then spaces', fill('< /', ' ')],
  ['system tag then spaces', fill('<system', ' ')],
  ['system tag then words', fill('<system', ' x')],
  ['lower tag then spaces', fill('<tool', ' ')],
  ['pipe tag then spaces', fill('<|', ' ')],
  ['pipe tag name then spaces', fill('<|' + 'a'.repeat(30), ' ')],
  ['square slash then spaces', fill('[/', ' ')],
  ['square name then spaces', fill('[INST', ' ')],
  ['double slash then spaces', fill('<</', ' ')],
  ['heading hash then spaces', fill('#', ' ', 'x')],
  ['heading system then spaces', fill('# system', ' ', 'x')],
  ['heading lines', fill('', '\n# prompt   x')],
  ['role word then spaces', fill('system', ' ', 'x')],
  ['role word then colons', fill('system', ':', ' x')],
  ['role word spaced colons', fill('system', ' :')],
  ['link label run', fill('![', 'a')],
  ['link target spaces', fill('[a](', ' ')],
  ['link target parens', fill('[a](javascript:', '(')],
  ['reference run', fill('[', 'a')],
  ['reference target spaces', fill('[a]:', ' ')],
  ['comment opens', fill('', '<!--')],
  ['private opens', fill('', '<private>')],
  ['private entity zeros', fill('&#', '0')],
  ['private then spaces', fill('<private><', ' ')],
  ['ignore then spaces', fill('ignore', ' ', 'x')],
  ['ignore all then spaces', fill('ignore all', ' ', 'x')],
  ['you are now then spaces', fill('you are now', ' ', 'x')],
  ['do not then spaces', fill('do not', ' ', 'x')],
  ['curl then text', fill('curl ', 'x')],
  ['curl then pipes', fill('curl', '|')],
  ['base64 repeated', fill('', 'base64 -d ')],
  ['sudo pipes', fill('', '| sudo -')],
  ['sh dash c repeated', fill('', 'sh -c ')],
  ['download then output', fill('', 'curl -o x ')],
  ['download output and', fill('curl -o x ', '&& ')],
  ['sk repeated', fill('', 'sk-')],
  ['begin key spaced', fill('-----BEGIN ', 'A ')],
  ['end key spaced', fill('-----BEGIN RSA PRIVATE KEY-----', '-----END A')],
  ['jwt head run', fill('eyJ', 'a')],
  ['credential url colons', fill('x://', 'a:')],
  ['sendgrid run', fill('SG.', 'a')],
  ['slack prefix repeated', fill('', 'xoxb-')],
  ['password then spaces', fill('password', ' ')],
  ['password equals repeated', fill('', 'password=')],
  ['authorization repeated', fill('', 'Authorization: ')],
  ['token words', fill('', 'token ')],
  ['opaque mixed run', fill('', 'A1b2')],
  ['opaque slash run', fill('', 'A1b2/')],
  ['opaque dot run', fill('', 'Ab3.')],
  ['env prefix run', fill('', 'DB_', 'PASSWORD=x')],
  ['env name run', fill('', 'a_')],
  ['name then equals', fill('', 'x', '=')],
  ['webhook path', fill('https://hooks.slack.com/services/', 'A/')],
  ['bearer repeated', fill('', 'Bearer ')],
  ['soft hyphen run', fill('ign', '\u00AD', 'ore all previous instructions')],
  ['lookalike run', fill('', '\u0455ystem ')],
];

const PIECES = [
  '<', '>', '<<', '>>', '[', ']', '(', ')', ' ', '  ', '\t', '\n', '/', '#', ':', '::', '|', '!', '-', '.', 'a.', '&', ';', '=', '"', "'", '$(', '`', '_', '@',
  'system', 'sys', 'SYS', 'INST', 'user', 'tool', 'prompt', 'instructions', 'private', 'important', 'curl ', 'wget ', '| sh', 'bash -c ', 'base64 -d ', 'sudo ', '-o ', '&& ',
  'ignore ', 'previous ', 'all ', 'javascript:', 'data:', '<!--', '-->', 'sk-', 'ghp_', 'eyJ', '://', 'x://', 'password', 'token', 'secret', 'Bearer ', 'Basic ',
  'Authorization: ', 'AKIA', '-----BEGIN ', 'PRIVATE KEY', '-----END ', 'DB_', 'KEY', 'A', 'z', '0', '9', 'Q', 'ab12CD34', '&lt;', '&#60;', 'agent-ctx memory',
  'hooks.slack.com/services/', 'whsec_', 'AccountKey=', '\u00AD', '\u200B', '\u0455', '\uFF1C', '\uFE0F',
];

function randomString(seed: number): string {
  let s = seed;
  const next = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s;
  };
  let out = '';
  while (out.length < K) out += PIECES[next() % PIECES.length];
  return out.slice(0, K);
}

function report(t: { diagnostic: (m: string) => void }, label: string, worst: number, name: string): void {
  t.diagnostic(`${label} worst ${worst.toFixed(1)} ms on ${name}, load average ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
}

test('the reviewer inputs at 8 KB run under 20 ms in every call', (t) => {
  let worst = 0;
  let where = '';
  for (const [name, input] of REVIEWER) {
    for (const [call, fn] of CALLS) {
      const ms = timeBest(fn, input);
      if (ms > worst) [worst, where] = [ms, `${call} ${name}`];
      assert.ok(ms <= BAR, `${call} on ${name} took ${ms.toFixed(1)} ms`);
    }
  }
  report(t, 'reviewer', worst, where);
});

test('each pattern worst case at 8 KB runs under 20 ms in every call', (t) => {
  let worst = 0;
  let where = '';
  for (const [name, input] of OWN) {
    assert.ok(input.length <= K && input.length > K - 64, name);
    for (const [call, fn] of CALLS) {
      const ms = timeBest(fn, input);
      if (ms > worst) [worst, where] = [ms, `${call} ${name}`];
      assert.ok(ms <= BAR, `${call} on ${name} took ${ms.toFixed(1)} ms`);
    }
  }
  report(t, 'own', worst, where);
});

test('2,000 random 8 KB strings run under 20 ms in every call', (t) => {
  let worst = 0;
  let where = '';
  for (let k = 0; k < 2000; k++) {
    const input = randomString(k + 1);
    for (const [call, fn] of CALLS) {
      const ms = timeBest(fn, input);
      if (ms > worst) [worst, where] = [ms, `${call} seed ${k + 1}`];
      assert.ok(ms <= BAR, `${call} on random seed ${k + 1} took ${ms.toFixed(1)} ms`);
    }
  }
  report(t, 'random', worst, where);
});
