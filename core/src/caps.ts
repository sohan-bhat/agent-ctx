import { redact } from './redact.ts';

export const ITEM_BYTES = 2048;
export const RESULT_CHARS = 600;
export const CALL_CHARS = 2400;
export const FIRST_CHARS = 3000;
export const RULE_MIN = 12;
export const RULE_MAX = 300;
export const RULE_PROMPT_MAX = 800;
export const RULES_AUTO_PER_DAY = 5;
export const RULES_SHOWN = 10;
export const STORE_BYTES = 10 * 1024 * 1024;
export const FOLD_AT = 0.8;

export function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  if (n < 2) return n < 1 ? '' : '…';
  let sl = s.slice(0, n - 1);
  if (/[\uD800-\uDBFF]$/.test(sl)) sl = sl.slice(0, -1);
  const sp = sl.lastIndexOf(' ');
  return (sp > n * 0.6 ? sl.slice(0, sp) : sl).trimEnd() + '…';
}

const encoder = new TextEncoder();

export function bytes(s: string): number {
  return encoder.encode(s).length;
}

export function clean(text: string, max: number): string {
  return cut(redact(text ?? ''), max);
}
