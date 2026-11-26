import { FIRST_CHARS, cut } from './model.ts';

export const QUIET_MIN = 15;
export const HOOK_HOSTS = ['claude-code', 'codex'];

export function quietPrompt(prompt: string): boolean {
  const p = typeof prompt === 'string' ? prompt.trim() : '';
  return p.length < QUIET_MIN || /^[/!#]/.test(p);
}

export function hookOutput(host: string, event: string, text: string): string {
  if (!HOOK_HOSTS.includes(host) || typeof text !== 'string' || !text) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: cut(text, FIRST_CHARS) } });
}
