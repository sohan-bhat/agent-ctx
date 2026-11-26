import test from 'node:test';
import assert from 'node:assert/strict';
import { itemText } from '../src/model.ts';
import { isStop, STOP_LISTS, tokens } from '../src/text.ts';
import * as one from './corpus.ts';
import * as two from './corpus2.ts';
import * as twoB from './corpus2b.ts';

const LANGS = ['es', 'de', 'fr', 'pt', 'it'] as const;

function raw(text: string): string[] {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const folded = spaced.normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC').toLowerCase();
  return folded.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [];
}

test('five lists of 25 to 40 plain lowercase words', () => {
  assert.deepEqual(Object.keys(STOP_LISTS).sort(), [...LANGS].sort());
  for (const l of LANGS) {
    const list = STOP_LISTS[l];
    assert.ok(list.length >= 25 && list.length <= 40, `${l} ${list.length}`);
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
    ['eine Rechnung nicht durch die Bank', ['rechnung', 'die', 'bank']],
    ['avec une facture depuis toujours', ['une', 'factur']],
    ['uma fatura quando ainda paga', ['fatura', 'paga']],
    ['nella fattura senza questo sconto', ['fattura', 'sconto']],
  ];
  for (const [text, want] of cases) assert.deepEqual(tokens(text), want, text);
});

test('no list word removes a card or query term of sets 1, 2 and 2b', () => {
  const words = new Map<string, number>();
  const texts = [...one.ITEMS, ...two.ITEMS].map(itemText).concat([...one.QUERIES, ...two.QUERIES, ...twoB.QUERIES].map((q) => q.q));
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
