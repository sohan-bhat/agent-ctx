import type { RuleBody, Via } from './model.ts';

export const PENDING = 'Rule saved as pending. The person turns the rule on with Accept on the agent-ctx page.';

export function decideRule(ctx: { via: Via; accepted?: boolean }): { status: 'active' | 'pending'; proof?: 'elicit' | 'page'; reason: string } {
  if (ctx.via === 'page') return { status: 'active', proof: 'page', reason: 'The person added the rule on the page, so the rule is active.' };
  if (ctx.via === 'tool' && ctx.accepted === true) return { status: 'active', proof: 'elicit', reason: 'The person accepted this exact rule in the agent, so the rule is active.' };
  return { status: 'pending', reason: PENDING };
}

export function readRule(body: RuleBody): RuleBody {
  if (body.proof !== 'hook') return body;
  const { proof: _hook, ...rest } = body;
  return { ...rest, status: body.status === 'active' ? 'pending' : body.status };
}

function quoted(s: string): string {
  return `"${(s ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim()}"`;
}

export function ruleLine(body: Pick<RuleBody, 'text' | 'words'>): string {
  const words = typeof body.words === 'string' ? body.words : '';
  return quoted(words.trim() ? words : (body.text ?? ''));
}
