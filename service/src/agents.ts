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

const DOCUMENTED: Record<string, string> = {
  [CLAUDE_REDIRECT]: 'Claude',
  'https://chatgpt.com/connector_platform_oauth_redirect': 'ChatGPT',
  'cursor://anysphere.cursor-mcp/oauth/callback': 'Cursor',
};

export function labelFor(c: ClientIdentity): string {
  const id = c.clientId ?? '';
  const redirect = c.redirectUri ?? '';
  const metadataHost = id.startsWith('https://') ? host(id) : '';
  if (id === CLAUDE_CODE_CLIENT) return 'Claude Code';
  if (id.startsWith(CODEX_PREFIX)) return 'Codex';
  if (within(metadataHost, 'chatgpt.com')) return 'ChatGPT';
  if (within(metadataHost, 'antigravity.google')) return 'Antigravity';
  if (within(metadataHost, 'cursor.com')) return 'Cursor';
  if (DOCUMENTED[redirect]) return DOCUMENTED[redirect];
  const clean = (c.clientName ?? '').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ._-]+/gu, '').replace(/ +/g, ' ').trim().slice(0, 40).trim();
  return `unverified ${clean || OTHER}`;
}
