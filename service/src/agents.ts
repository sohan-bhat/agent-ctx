export interface ClientIdentity { clientId: string; clientName?: string; redirectUri?: string }

export const CLAUDE_CODE_CLIENT = 'https://claude.ai/oauth/claude-code-client-metadata';
export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
export const CODEX_PREFIX = 'https://chatgpt.com/oauth/codex/';
export const OTHER = 'another agent';

function host(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

function within(h: string, domain: string): boolean {
  return h === domain || h.endsWith(`.${domain}`);
}

export function labelFor(c: ClientIdentity): string {
  const id = c.clientId ?? '';
  const name = c.clientName ?? '';
  const redirect = c.redirectUri ?? '';
  const idHost = host(id);
  const redirectHost = host(redirect);
  if (id === CLAUDE_CODE_CLIENT) return 'Claude Code';
  if (redirect === CLAUDE_REDIRECT) return 'Claude';
  if (id.startsWith(CODEX_PREFIX)) return 'Codex';
  if (within(idHost, 'chatgpt.com') || within(redirectHost, 'chatgpt.com')) return 'ChatGPT';
  if (within(idHost, 'antigravity.google') || within(redirectHost, 'antigravity.google')) return 'Antigravity';
  if (/cursor/i.test(name) || /cursor/i.test(redirect)) return 'Cursor';
  const clean = name.replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ._-]+/gu, '').replace(/ +/g, ' ').trim().slice(0, 40).trim();
  return clean || OTHER;
}
