import test from 'node:test';
import assert from 'node:assert/strict';
import { fileTokens, stem, tokens } from '../src/text.ts';

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
