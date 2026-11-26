# Sign in by vendor

Below is how each agent product signs in to agent-ctx, as published by each vendor on 2026-11-26. The four metadata documents are saved unchanged in service/test/fixtures/vendors, and every row is tested against those documents in service/test/vendors.test.ts. PORT stands for any port chosen by the product.

| Product | How the product is identified | Redirect form | Result |
|---|---|---|---|
| Claude Code | Metadata document https://claude.ai/oauth/claude-code-client-metadata in claude-code.2026-11-26.json | http://localhost:PORT/callback and http://127.0.0.1:PORT/callback | Signed in as Claude Code with the loopback warning, a token with method none and tools loaded in both protocol eras |
| Codex | Metadata document https://chatgpt.com/oauth/codex/client.json in codex.2026-11-26.json | http://127.0.0.1:PORT/callback and http://localhost:PORT/callback | Signed in as Codex with the loopback warning, a token with method none and tools loaded in both protocol eras. For a callback path not listed in the document, a plain page with the words Invalid redirect URI is shown |
| ChatGPT | Metadata document https://chatgpt.com/oauth/client.json in chatgpt.2026-11-26.json | https://chatgpt.com/connector_platform_oauth_redirect | Signed in as ChatGPT as published, with a token with method none or with private_key_jwt signed by a key from the document's jwks_uri. A broken assertion results in 401, and tools are loaded in both protocol eras |
| Antigravity | Metadata document https://antigravity.google/oauth/client-metadata.json in antigravity.2026-11-26.json | https://antigravity.google/oauth-callback | Signed in as Antigravity with a token with method none and tools loaded in both protocol eras |
| Claude apps | Self registration | https://claude.ai/api/mcp/auth_callback | Signed in as Claude |
| Cursor web and cloud agents | Self registration with both Cursor callbacks | https://www.cursor.com/agents/mcp/oauth/callback | Signed in as Cursor |
| Cursor desktop | Self registration with both Cursor callbacks | http://localhost:8787/callback | Signed in as unverified Cursor with the loopback warning, since any app on the computer may be the listener there |
| Cursor older versions | Self registration with cursor://anysphere.cursor-mcp/oauth/callback | cursor://anysphere.cursor-mcp/oauth/callback | Sign in fails. In the sign in library, codes are sent only to https or loopback addresses, so the person sees a plain page with the words Invalid redirect URI. Current Cursor has no documented custom scheme |
| VS Code desktop | Self registration | http://127.0.0.1:33418 | Signed in under the word unverified and the registered name, with the loopback warning |
| VS Code web | Self registration | https://vscode.dev/redirect | Signed in as VS Code |
| Gemini CLI | Self registration | http://localhost:PORT/oauth/callback | Signed in under the word unverified and the registered name, with the loopback warning |
| Amp | Self registration | http://localhost:8976/oauth/callback | Signed in under the word unverified and the registered name, with the loopback warning |

From the form on the consent page, the browser may be sent on to the origin of the matched redirect address and to no other place. Every row above falls inside that limit.
