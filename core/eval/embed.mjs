import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';
import { quantize } from '../src/hybrid.ts';
import * as precision from '../test/precision.ts';
import { VECTORS, encode, loadVectors, textKey, textsOf } from '../test/vectors.ts';

const MODEL = 'Xenova/bge-small-en-v1.5';
const POOLING = 'mean';
const THREADS = 4;
const here = path.dirname(fileURLToPath(import.meta.url));

env.cacheDir = path.join(here, 'models');
env.allowLocalModels = false;

const load = () => os.loadavg().map((x) => x.toFixed(2)).join(' ');

function sets() {
  const out = [];
  for (const [name, set] of Object.entries(precision.SETS ?? {})) out.push([name, set]);
  for (const [name, value] of Object.entries(precision)) {
    if (/^SET[0-9A-Z]+$/.test(name) && value && Array.isArray(value.items) && Array.isArray(value.queries)) out.push([name.toLowerCase(), value]);
  }
  return out;
}

const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const model = await AutoModel.from_pretrained(MODEL, { dtype: 'fp32', device: 'cpu', session_options: { intraOpNumThreads: THREADS, interOpNumThreads: 1 } });

async function embed(text) {
  const inputs = tokenizer(text, { truncation: true, max_length: 512 });
  const out = await model(inputs);
  const h = out.last_hidden_state;
  const [, t, d] = h.dims;
  const data = h.data;
  const mean = new Float32Array(d);
  for (let k = 0; k < t; k++) for (let j = 0; j < d; j++) mean[j] += data[k * d + j];
  for (let j = 0; j < d; j++) mean[j] /= t;
  return quantize(mean);
}

const old = loadVectors();
const keep = old && old.model === MODEL && old.pooling === POOLING ? old.entries : {};
const entries = {};
const times = [];
let dim = 384;
const before = load();
const started = performance.now();
for (const [name, set] of sets()) {
  let added = 0;
  const texts = textsOf(set);
  for (const text of texts) {
    const key = textKey(text);
    if (entries[key]) continue;
    if (keep[key]) {
      entries[key] = keep[key];
      continue;
    }
    const t0 = performance.now();
    const v = await embed(text);
    times.push(performance.now() - t0);
    dim = v.length;
    entries[key] = encode(v);
    added++;
  }
  console.log(`${name} texts ${texts.length} embedded ${added}`);
}
const sorted = Object.fromEntries(Object.keys(entries).sort().map((k) => [k, entries[k]]));
fs.writeFileSync(VECTORS, JSON.stringify({ model: MODEL, pooling: POOLING, dim, entries: sorted }) + '\n');
times.sort((a, b) => a - b);
const median = times.length ? times[times.length >> 1] : 0;
console.log(`entries ${Object.keys(sorted).length} new ${times.length} median ${median.toFixed(1)} ms seconds ${((performance.now() - started) / 1000).toFixed(1)} threads ${THREADS} load ${before} to ${load()}`);
