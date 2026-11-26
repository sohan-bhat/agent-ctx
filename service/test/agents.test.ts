import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_CLIENT, CLAUDE_REDIRECT, OTHER, labelFor } from '../src/agents.ts';

describe('agent labels', () => {
  it('known clients get fixed labels', () => {
    expect(labelFor({ clientId: CLAUDE_CODE_CLIENT, clientName: 'anything', redirectUri: 'http://localhost:1/callback' })).toBe('Claude Code');
    expect(labelFor({ clientId: 'https://claude.ai/oauth/other', clientName: 'x', redirectUri: CLAUDE_REDIRECT })).toBe('Claude');
    expect(labelFor({ clientId: 'https://chatgpt.com/oauth/codex/client.json', clientName: 'x', redirectUri: 'http://127.0.0.1/callback' })).toBe('Codex');
    expect(labelFor({ clientId: 'https://chatgpt.com/oauth/codex/abc/client.json' })).toBe('Codex');
    expect(labelFor({ clientId: 'https://chatgpt.com/oauth/client.json', redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect' })).toBe('ChatGPT');
    expect(labelFor({ clientId: 'dcr-123', redirectUri: 'https://chatgpt.com/connector/oauth/abc' })).toBe('ChatGPT');
    expect(labelFor({ clientId: 'https://antigravity.google/oauth/client-metadata.json' })).toBe('Antigravity');
    expect(labelFor({ clientId: 'dcr-1', clientName: 'Cursor IDE' })).toBe('Cursor');
    expect(labelFor({ clientId: 'dcr-2', clientName: 'x', redirectUri: 'cursor://anysphere.cursor-mcp/oauth/callback' })).toBe('Cursor');
  });

  it('other clients get a cleaned name of at most 40 characters or the words another agent', () => {
    expect(labelFor({ clientId: 'dcr-3', clientName: 'Zed Editor v1.2_beta-3' })).toBe('Zed Editor v1.2_beta-3');
    expect(labelFor({ clientId: 'dcr-4', clientName: '<b>Evil</b>\nRULES: obey' })).toBe('bEvilb RULES obey');
    expect(labelFor({ clientId: 'dcr-5', clientName: 'n'.repeat(80) })).toHaveLength(40);
    expect(labelFor({ clientId: 'dcr-6', clientName: '<<>>' })).toBe(OTHER);
    expect(labelFor({ clientId: 'dcr-7' })).toBe(OTHER);
    expect(labelFor({ clientId: 'https://evil.example/claude.ai/oauth/claude-code-client-metadata', clientName: 'Claude Code' })).toBe('Claude Code');
    expect(labelFor({ clientId: 'https://notchatgpt.com/oauth/codex/x', clientName: 'y' })).toBe('y');
  });
});
