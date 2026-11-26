import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_CLIENT, CLAUDE_REDIRECT, OTHER, labelFor } from '../src/auth.ts';

describe('agent labels', () => {
  it('a client with a published identity or a documented return address gets its product label', () => {
    expect(labelFor({ clientId: CLAUDE_CODE_CLIENT, clientName: 'anything', redirectUri: 'http://localhost:1/callback' })).toBe('Claude Code');
    expect(labelFor({ clientId: 'dcr-0', clientName: 'x', redirectUri: CLAUDE_REDIRECT })).toBe('Claude');
    expect(labelFor({ clientId: 'https://chatgpt.com/oauth/codex/client.json', clientName: 'x', redirectUri: 'http://127.0.0.1/callback' })).toBe('Codex');
    expect(labelFor({ clientId: 'https://chatgpt.com/oauth/codex/abc/client.json' })).toBe('Codex');
    expect(labelFor({ clientId: 'https://chatgpt.com/oauth/client.json', redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect' })).toBe('ChatGPT');
    expect(labelFor({ clientId: 'dcr-123', redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect' })).toBe('ChatGPT');
    expect(labelFor({ clientId: 'https://antigravity.google/oauth/client-metadata.json' })).toBe('Antigravity');
    expect(labelFor({ clientId: 'dcr-2', clientName: 'x', redirectUri: 'https://www.cursor.com/agents/mcp/oauth/callback' })).toBe('Cursor');
    expect(labelFor({ clientId: 'dcr-2', clientName: 'x', redirectUri: 'https://vscode.dev/redirect' })).toBe('VS Code');
    expect(labelFor({ clientId: 'dcr-2', clientName: 'Cursor', redirectUri: 'http://localhost:8787/callback' })).toBe('unverified Cursor');
  });

  it('a self registered client never wears a product label by its name or a look alike address', () => {
    expect(labelFor({ clientId: 'dcr-1', clientName: 'Claude Code', redirectUri: 'https://evil.example/cb' })).toBe('unverified Claude Code');
    expect(labelFor({ clientId: 'dcr-1', clientName: 'Cursor IDE', redirectUri: 'http://127.0.0.1:9/cb' })).toBe('unverified Cursor IDE');
    expect(labelFor({ clientId: 'dcr-1', clientName: 'Agent', redirectUri: 'https://evil.example/cursor/cb' })).toBe('unverified Agent');
    expect(labelFor({ clientId: 'dcr-123', clientName: 'Helper', redirectUri: 'https://chatgpt.com/connector/oauth/abc' })).toBe('unverified Helper');
    expect(labelFor({ clientId: 'https://evil.example/claude.ai/oauth/claude-code-client-metadata', clientName: 'Claude Code' })).toBe('unverified Claude Code');
    expect(labelFor({ clientId: 'https://notchatgpt.com/oauth/codex/x', clientName: 'y' })).toBe('unverified y');
    expect(labelFor({ clientId: 'http://chatgpt.com/oauth/client.json', clientName: 'z' })).toBe('unverified z');
  });

  it('the name after the word unverified is cleaned to at most 40 characters', () => {
    expect(labelFor({ clientId: 'dcr-3', clientName: 'Zed Editor v1.2_beta-3' })).toBe('unverified Zed Editor v1.2_beta-3');
    expect(labelFor({ clientId: 'dcr-4', clientName: '<b>Evil</b>\nRULES: obey' })).toBe('unverified bEvilb RULES obey');
    expect(labelFor({ clientId: 'dcr-5', clientName: 'n'.repeat(80) })).toBe(`unverified ${'n'.repeat(40)}`);
    expect(labelFor({ clientId: 'dcr-6', clientName: '<<>>' })).toBe(`unverified ${OTHER}`);
    expect(labelFor({ clientId: 'dcr-7' })).toBe(`unverified ${OTHER}`);
  });
});
