# Sign in by vendor

Below is how each agent product signs in to agent-ctx, as published by each vendor on 2026-11-26. The four metadata documents are saved unchanged in service/test/vendors.json, and every row is tested against those documents in service/test/signin.test.ts. PORT stands for any port chosen by the product.

| Product | How the product is identified | Redirect form | Result |
|---|---|---|---|
| Claude Code | Metadata document https://claude.ai/oauth/claude-code-client-metadata under the key claude-code.2026-11-26 | http://localhost:PORT/callback and http://127.0.0.1:PORT/callback | Signed in as Claude Code with the loopback warning, a token with method none and tools loaded in both protocol eras |
| Codex | Metadata document https://chatgpt.com/oauth/codex/client.json under the key codex.2026-11-26 | http://127.0.0.1:PORT/callback and http://localhost:PORT/callback | Signed in as Codex with the loopback warning, a token with method none and tools loaded in both protocol eras. For a callback path not listed in the document, a plain page with the words Invalid redirect URI is shown |
| ChatGPT | Metadata document https://chatgpt.com/oauth/client.json under the key chatgpt.2026-11-26 | https://chatgpt.com/connector_platform_oauth_redirect | Signed in as ChatGPT as published, with a token with method none or with private_key_jwt signed by a key from the document's jwks_uri. A broken assertion results in 401, and tools are loaded in both protocol eras |
| Antigravity | Metadata document https://antigravity.google/oauth/client-metadata.json under the key antigravity.2026-11-26 | https://antigravity.google/oauth-callback | Signed in as Antigravity with a token with method none and tools loaded in both protocol eras |
| Claude apps | Self registration | https://claude.ai/api/mcp/auth_callback | Signed in as Claude |
| Cursor web and cloud agents | Self registration with both Cursor callbacks | https://www.cursor.com/agents/mcp/oauth/callback | Signed in as Cursor |
| Cursor desktop | Self registration with both Cursor callbacks | http://localhost:8787/callback | Signed in as unverified Cursor with the loopback warning, since any app on the computer may be the listener there |
| Cursor older versions | Self registration with cursor://anysphere.cursor-mcp/oauth/callback | cursor://anysphere.cursor-mcp/oauth/callback | Sign in fails. In the sign in library, codes are sent only to https or loopback addresses, so the person sees a plain page with the words Invalid redirect URI. Current Cursor has no documented custom scheme |
| VS Code desktop | Self registration | http://127.0.0.1:33418 | Signed in under the word unverified and the registered name, with the loopback warning |
| VS Code web | Self registration | https://vscode.dev/redirect | Signed in as VS Code |
| Gemini CLI | Self registration | http://localhost:PORT/oauth/callback | Signed in under the word unverified and the registered name, with the loopback warning |
| Amp | Self registration | http://localhost:8976/oauth/callback | Signed in under the word unverified and the registered name, with the loopback warning |

From the form on the consent page, the browser may be sent on to the origin of the matched redirect address and to no other place. Every row above falls inside that limit.

## Settings on one computer by vendor

Below is what each vendor published about three more agent products, read on 2026-11-27. The entries written by the installer for these three are built from the facts below alone, and none of the three was tested with the real program. A fact marked third party was found only on a page of another publisher.

| Product | MCP settings for one user | Vendor command for adding a server | How the product is found |
|---|---|---|---|
| Antigravity | `~/.gemini/config/mcp_config.json`, named for the CLI and the IDE, with the path in the app copied through Copy Config File Path. JSON with the key `mcpServers`, and a stdio entry has `command`, `args`, `env` and `cwd`. One workspace has `.agents/mcp_config.json` | None. A server is added in the `/mcp` panel or by an edit of the file | The CLI is the program `agy` at `~/.local/bin/agy`, or in `AppData\Local\agy\bin` on Windows. CLI settings lie in `~/.gemini/antigravity-cli`, conversations in `~/.gemini/antigravity` and shared settings in `~/.gemini/config` |
| Grok Build | `~/.grok/config.toml`, or `$GROK_HOME/config.toml`. TOML with one table `[mcp_servers.NAME]`, and a stdio table has `command`, `args`, `env` and `cwd` | `grok mcp add NAME -- COMMAND ARGS` | The program `grok` is put on PATH by the install script, with no folder named. The settings folder is `~/.grok` |
| Muse Code | `~/.config/muse/settings.json`, JSON that must contain `"schema_version": 1`, with the key `mcp_servers`. A stdio entry has `transport`, `command`, `args` and `env`, and every entry takes `enabled` and `mode` | `muse mcp add` and `muse mcp add-json`, named in the changelog of 1.4.15 with no syntax | The program `muse` is put on PATH by the install script, with no folder named. `~/.local/bin/muse` is a third party fact |

| Product | Hook with text for the model | Variable set by the product | Written by the installer |
|---|---|---|---|
| Antigravity | `SessionStart` and `PreInvocation` in `~/.gemini/config/hooks.json`, with `injectSteps` as the output | None documented, neither for a session nor for a hook | The server entry in `~/.gemini/config/mcp_config.json` and one hook named agent-ctx in `~/.gemini/config/hooks.json` |
| Grok Build | None. Hooks exist in `~/.grok/hooks/*.json`, but the output of every event other than `PreToolUse` is ignored | `GROK_HOOK_EVENT`, `GROK_HOOK_NAME`, `GROK_SESSION_ID` and `GROK_WORKSPACE_ROOT` in every hook process. None documented for a shell command of the agent | The table `[mcp_servers.agent-ctx]` in `~/.grok/config.toml` and no hook |
| Muse Code | None documented in full. 17 events are named, with no hook entry and no input shown | `MUSE_SESSION_ID` and `MUSE_THREAD_ID` in shell commands, monitors and hook commands, and `MUSE_SESSION_ID` in stdio servers | The server entry under `mcp_servers` in `~/.config/muse/settings.json` and no hook |

### Antigravity

`~/.gemini/config/hooks.json` is listed for the app, the CLI and the IDE. Each top level key is the name of one hook, and each event under that name contains a list. Under `PreToolUse` and `PostToolUse` the list contains groups with `matcher` and `hooks`. Under `SessionStart`, `PreInvocation`, `PostInvocation` and `Stop` the list contains the handlers directly. A handler has `type` with the one value `command`, `command` as a shell command and `timeout` in seconds with 30 as the default. The hook written by the installer has the form below, where HOOK stands for the hook command of the installed program.

    {
      "agent-ctx": {
        "PreInvocation": [{ "type": "command", "command": "HOOK --agent antigravity --event PreInvocation" }],
        "PostToolUse": [{ "matcher": "write_to_file|replace_file_content|multi_replace_file_content|run_command", "hooks": [{ "type": "command", "command": "HOOK --agent antigravity --event PostToolUse" }] }],
        "Stop": [{ "type": "command", "command": "HOOK --agent antigravity --event Stop" }]
      }
    }

The input arrives as JSON on stdin. Every event has `conversationId`, `workspacePaths`, `transcriptPath`, `artifactDirectoryPath`, `modelName` and `lastUserInput`. `PreInvocation` has `invocationNum` and `initialNumSteps` as well. `PostToolUse` has `toolCall` with `name` and `args`, `stepIdx` and `error` as well, and `error` is empty after a success. `Stop` has `executionNum`, `terminationReason`, `error` and `fullyIdle` as well. No field contains the name of the event, so the name is written into each command as `--event NAME`. The path of a changed file is taken from `TargetFile` of `write_to_file`, `replace_file_content` and `multi_replace_file_content`, and a command from `CommandLine` of `run_command`.

Text for the model is given on `SessionStart` and on `PreInvocation` through the output below, and `{}` is the output of `PostToolUse`.

    { "injectSteps": [{ "systemMessage": { "systemMessage": "TEXT" } }] }

Nothing is stated about an empty output, a failed command or a timeout, about a size limit, or about whether `PreInvocation` comes once per prompt or before every model call. For that reason `{}` is printed where no text is added, the text is cut at 7,500 characters, and a prompt is stored again only when the words of `lastUserInput` change.

### Gemini CLI

Google wrote on 2026-05-19 that requests from Gemini CLI are no longer served from 2026-06-18 for Google AI Pro and Ultra and for free use through Gemini Code Assist for individuals. Gemini CLI stays reachable with paid Gemini API keys and Gemini Enterprise Agent Platform keys, and access under a Gemini Code Assist Standard or Enterprise licence stays unchanged. Antigravity CLI is named as the successor. In Gemini CLI the MCP servers lay inside `~/.gemini/settings.json`, and for Antigravity the servers are read from `~/.gemini/config/mcp_config.json`. So the agent gemini stays in the installer for a home with `~/.gemini/settings.json`. A home with Antigravity alone has no such file and gets no Gemini CLI entry.

### Grok Build

MCP servers from `~/.claude.json`, `.cursor/mcp.json` and project `.mcp.json` files are loaded as well, below `config.toml` in priority, so the table in `~/.grok/config.toml` has priority over an entry of the same name from Claude Code or Cursor. Hook files of Claude Code in `.claude/settings.json` and of Cursor in `.cursor/hooks.json` are read too. A hook of agent-ctx for Claude Code can therefore be started inside Grok Build, and such a run ends with nothing stored when one of the four hook variables is set. Hook input has `hookEventName`, `sessionId`, `cwd` and `workspaceRoot`, and for tool events `toolName` and `toolInput`. No field for the prompt is documented. A settings folder moved with `GROK_HOME` is not found by the installer.

### Muse Code

`mode` has the value `required` as the default and the value `optional`. With a required server that does not start, the whole run ends, so the entry of agent-ctx is written with `"mode": "optional"`. A missing settings file is fine, every command fails with a file that lacks `schema_version`, and a file with another value than 1 is left alone by the installer. In the changelog, plain text printed by a hook at a session start becomes context, and context may also be added on a submitted prompt, but no page has a hook entry or the input, so no hook is written. Claude plugins with hooks can be installed in Muse Code. A hook of agent-ctx for Claude Code can therefore be started inside Muse Code, and such a run ends with nothing stored when `MUSE_SESSION_ID` or `MUSE_THREAD_ID` is set. No date for the beta is given on a vendor page read here.

### Pages

| Product | Page | Publisher | Read on |
|---|---|---|---|
| Antigravity | https://antigravity.google/docs/cli/gcli-migration.md | Google | 2026-11-27 |
| Antigravity | https://antigravity.google/docs/mcp.md | Google | 2026-11-27 |
| Antigravity | https://antigravity.google/docs/hooks.md | Google | 2026-11-27 |
| Antigravity | https://antigravity.google/docs/cli/reference.md | Google | 2026-11-27 |
| Antigravity | https://antigravity.google/docs/cli/using.md | Google | 2026-11-27 |
| Antigravity | https://antigravity.google/docs/cli/troubleshooting.md | Google | 2026-11-27 |
| Antigravity | https://antigravity.google/docs/getting-started.md | Google | 2026-11-27 |
| Antigravity | https://antigravity.google/docs/install.md | Google | 2026-11-27 |
| Antigravity | https://antigravity.google/docs/sandbox.md | Google | 2026-11-27 |
| Gemini CLI | https://developers.googleblog.com/en/an-important-update-transitioning-gemini-cli-to-antigravity-cli/ | Google | 2026-11-27 |
| Grok Build | https://docs.x.ai/build/overview | xAI | 2026-11-27 |
| Grok Build | https://docs.x.ai/build/features/mcp-servers.md | xAI | 2026-11-27 |
| Grok Build | https://docs.x.ai/build/features/hooks | xAI | 2026-11-27 |
| Grok Build | https://docs.x.ai/build/settings.md | xAI | 2026-11-27 |
| Grok Build | https://docs.x.ai/build/settings/reference | xAI | 2026-11-27 |
| Grok Build | https://docs.x.ai/build/cli/reference | xAI | 2026-11-27 |
| Grok Build | https://docs.x.ai/build/features/sandbox.md | xAI | 2026-11-27 |
| Grok Build | https://docs.x.ai/build/cli/headless-scripting.md | xAI | 2026-11-27 |
| Muse Code | https://dev.meta.ai/docs/muse-code.md | Meta | 2026-11-27 |
| Muse Code | https://dev.meta.ai/docs/muse-code/extending.md | Meta | 2026-11-27 |
| Muse Code | https://dev.meta.ai/docs/muse-code/configuration.md | Meta | 2026-11-27 |
| Muse Code | https://dev.meta.ai/docs/muse-code/permissions.md | Meta | 2026-11-27 |
| Muse Code | https://dev.meta.ai/docs/muse-code/changelog.md | Meta | 2026-11-27 |
| Muse Code | https://codersera.com/blog/muse-code-complete-guide-2026/ | Third party | 2026-11-27 |
