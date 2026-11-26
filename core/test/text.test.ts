import test from 'node:test';
import assert from 'node:assert/strict';
import { fileTokens, isStop, stem, tokens } from '../src/text.ts';

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
