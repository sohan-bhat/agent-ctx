# claude-ctx

Memory across folders for Claude Code sessions.

## Install

    git clone https://github.com/sohan-bhat/claude-ctx
    cd claude-ctx
    npm install
    npm run build
    npm link
    claude-ctx install

## Use

    claude-ctx             opens the page
    claude-ctx status      hooks, store size, last hook
    claude-ctx uninstall   takes the hooks out

## Other agents

    claude mcp add --scope user claude-ctx -- claude-ctx mcp
    {"mcpServers": {"claude-ctx": {"command": "claude-ctx", "args": ["mcp"]}}}

The first line gives Claude Code the search, recent and session tools, the second goes in claude_desktop_config.json, and claude-ctx mcp --help prints both with full paths.

Node 22 or newer. MIT.
