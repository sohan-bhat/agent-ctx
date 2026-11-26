# Sign in by vendor

How each agent product signs in to agent-ctx, as each vendor published it on 2026-11-26. The four metadata documents are saved unchanged in service/test/fixtures/vendors, and service/test/vendors.test.ts runs every row against them. PORT stands for any port the product picks.

| Product | How the product identifies itself | Redirect form | Result |
|---|---|---|---|
| Claude Code | Metadata document https://claude.ai/oauth/claude-code-client-metadata in claude-code.2026-11-26.json | http://localhost:PORT/callback and http://127.0.0.1:PORT/callback | Signs in as Claude Code with the loopback warning. Token with method none. Tools load in both protocol eras |
| Codex | Metadata document https://chatgpt.com/oauth/codex/client.json in codex.2026-11-26.json | http://127.0.0.1:PORT/callback and http://localhost:PORT/callback | Signs in as Codex with the loopback warning. Token with method none. Tools load in both protocol eras. A callback path the document does not list gets a plain page that reads Invalid redirect URI |
| ChatGPT | Metadata document https://chatgpt.com/oauth/client.json in chatgpt.2026-11-26.json | https://chatgpt.com/connector_platform_oauth_redirect | Signs in as ChatGPT as published. Token with method none or with private_key_jwt signed by a key from its jwks_uri. A broken assertion gets 401. Tools load in both protocol eras |
| Antigravity | Metadata document https://antigravity.google/oauth/client-metadata.json in antigravity.2026-11-26.json | https://antigravity.google/oauth-callback | Signs in as Antigravity. Token with method none. Tools load in both protocol eras |
| Claude apps | Registers itself | https://claude.ai/api/mcp/auth_callback | Signs in as Claude |
| Cursor web and cloud agents | Registers itself with both Cursor callbacks | https://www.cursor.com/agents/mcp/oauth/callback | Signs in as Cursor |
| Cursor desktop | Registers itself with both Cursor callbacks | http://localhost:8787/callback | Signs in as unverified Cursor with the loopback warning, since any app on the computer can listen there |
| Cursor older versions | Registers itself with cursor://anysphere.cursor-mcp/oauth/callback | cursor://anysphere.cursor-mcp/oauth/callback | No sign in. The sign in library sends codes only to https or loopback addresses, so the person sees a plain page that reads Invalid redirect URI. Current Cursor documents no custom scheme |
| VS Code desktop | Registers itself | http://127.0.0.1:33418 | Signs in under the word unverified and its own name, with the loopback warning |
| VS Code web | Registers itself | https://vscode.dev/redirect | Signs in as VS Code |
| Gemini CLI | Registers itself | http://localhost:PORT/oauth/callback | Signs in under the word unverified and its own name, with the loopback warning |
| Amp | Registers itself | http://localhost:8976/oauth/callback | Signs in under the word unverified and its own name, with the loopback warning |

The consent page allows its form to send the browser on to the origin of the matched redirect address and to no other place. Every row above passes that check.
