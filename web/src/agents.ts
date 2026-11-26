export const REPO = 'sohan-bhat/agent-ctx';

export type Step =
  | { type: 'open'; label: string; copy: boolean; href: (address: string) => string }
  | { type: 'copy'; label: string; text: (address: string) => string }
  | { type: 'steps'; items: string[] };

export interface Product {
  id: string;
  label: string;
  path: Step[];
}

const claudeOpen: Step = { type: 'open', label: 'Copy address and open Claude', copy: true, href: () => 'https://claude.ai/customize/connectors' };
const claudeSteps: Step = { type: 'steps', items: ['Press Add', 'Choose Add custom connector', 'Paste the address', 'In a chat press the plus button, then Connectors, then turn agent-ctx on'] };

export const PRODUCTS: Product[] = [
  { id: 'claude', label: 'Claude', path: [claudeOpen, claudeSteps] },
  {
    id: 'claude-code',
    label: 'Claude Code',
    path: [claudeOpen, claudeSteps, { type: 'copy', label: 'Then type this in Claude Code', text: () => `/plugin install agent-ctx --marketplace ${REPO}` }],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    path: [{ type: 'open', label: 'Add to Cursor', copy: false, href: (a) => `cursor://anysphere.cursor-deeplink/mcp/install?name=agent-ctx&config=${encodeURIComponent(btoa(JSON.stringify({ url: a })))}` }],
  },
  {
    id: 'vscode',
    label: 'VS Code',
    path: [{ type: 'open', label: 'Add to VS Code', copy: false, href: (a) => `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'agent-ctx', type: 'http', url: a }))}` }],
  },
  {
    id: 'codex',
    label: 'Codex',
    path: [
      { type: 'copy', label: 'Type this in a terminal', text: (a) => `codex mcp add agent-ctx --url ${a}` },
      { type: 'copy', label: 'Then sign in', text: () => 'codex mcp login agent-ctx' },
    ],
  },
  {
    id: 'grok',
    label: 'Grok',
    path: [
      { type: 'open', label: 'Copy address and open Grok', copy: true, href: () => 'https://grok.com/connectors' },
      { type: 'steps', items: ['Press New Connector', 'Choose Custom', 'Paste the address'] },
    ],
  },
  { id: 'amp', label: 'Amp', path: [{ type: 'copy', label: 'Type this in a terminal', text: (a) => `amp mcp remote --personal add agent-ctx ${a}` }] },
  { id: 'gemini', label: 'Gemini CLI', path: [{ type: 'copy', label: 'Type this in a terminal', text: (a) => `gemini mcp add --transport http agent-ctx ${a}` }] },
  {
    id: 'antigravity',
    label: 'Antigravity',
    path: [{ type: 'copy', label: 'Add this to ~/.gemini/config/mcp_config.json', text: (a) => JSON.stringify({ mcpServers: { 'agent-ctx': { serverUrl: a } } }, null, 2) }],
  },
];

export function address(origin = location.origin): string {
  return `${origin}/mcp`;
}
