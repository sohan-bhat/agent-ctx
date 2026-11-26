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

test('tokens split camel case, drop stop words, short words and long numbers', () => {
  assert.deepEqual(tokens('The windGust filter in src/WindVane.ts'), ['wind', 'gust', 'filter', 'wind', 'vane', 'ts']);
  assert.deepEqual(tokens('a 1 22 123456 x'), ['22']);
  assert.deepEqual(tokens('HTTPServer'), ['http', 'server']);
  assert.deepEqual(tokens(''), []);
});

test('fileTokens reads the base name and the parent folder', () => {
  assert.deepEqual(fileTokens('/w/station/firmware/rainGauge.c'), ['rain', 'gauge', 'firmware']);
});
