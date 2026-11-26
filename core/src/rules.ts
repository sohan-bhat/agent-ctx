import { RULE_MAX, RULE_MIN, RULE_PROMPT_MAX, RULES_AUTO_PER_DAY } from './caps.ts';
import type { RuleBody, Via } from './model.ts';
import { sanitize } from './sanitize.ts';

export function normalizeWords(s: string): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isWordChar(c: string | undefined): boolean {
  return !!c && /[\p{L}\p{N}]/u.test(c);
}

function runIn(hay: string, needle: string): boolean {
  let at = hay.indexOf(needle);
  while (at >= 0) {
    const before = hay[at - 1];
    const after = hay[at + needle.length];
    const edgeStart = !isWordChar(needle[0]) || !isWordChar(before);
    const edgeEnd = !isWordChar(needle[needle.length - 1]) || !isWordChar(after);
    if (edgeStart && edgeEnd) return true;
    at = hay.indexOf(needle, at + 1);
  }
  return false;
}

export function proveWords(words: string, prompts: string[]): boolean {
  const w = normalizeWords(words);
  if (w.length < RULE_MIN || w.length > RULE_MAX) return false;
  return (prompts ?? []).some((p) => typeof p === 'string' && p.length <= RULE_PROMPT_MAX && runIn(normalizeWords(p), w));
}

const LATER = 'so the rule is pending until the person adds it on the page.';

export function decideRule(
  input: { text: string; words: string; scope: 'project' | 'all' },
  ctx: { via: Via; prompts: string[]; activatedToday: number; accepted?: boolean },
): { status: 'active' | 'pending'; proof?: 'hook' | 'elicit' | 'page'; reason: string } {
  if (ctx.via === 'page') return { status: 'active', proof: 'page', reason: 'The person added the rule on the page, so the rule is active.' };
  if (ctx.accepted === true) return { status: 'active', proof: 'elicit', reason: 'The person accepted the rule in the agent, so the rule is active.' };
  const w = normalizeWords(input.words);
  if (w.length < RULE_MIN) return { status: 'pending', reason: `The source words are too short to check, ${LATER}` };
  if (w.length > RULE_MAX) return { status: 'pending', reason: `The source words are too long to check, ${LATER}` };
  if (!proveWords(input.words, ctx.prompts)) return { status: 'pending', reason: `The source words match no short prompt from this session, ${LATER}` };
  if (sanitize(input.words).flags.length) return { status: 'pending', reason: `The source words hold text that looks unsafe, ${LATER}` };
  if (!(ctx.activatedToday < RULES_AUTO_PER_DAY)) return { status: 'pending', reason: `${RULES_AUTO_PER_DAY} rules already became active today, ${LATER}` };
  return { status: 'active', proof: 'hook', reason: "The source words match the person's prompt, so the rule is active." };
}

function quoted(s: string): string {
  return `"${(s ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim()}"`;
}

export function ruleLine(body: RuleBody): string {
  if (body.proof === 'hook') return quoted(body.words);
  return quoted(body.text);
}
