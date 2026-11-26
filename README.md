# agent-ctx

agent-ctx is shared memory across agents from different vendors.

The hosted service is in development and the licence is MIT.

## Layout

    core            shared TypeScript with no runtime dependencies
    service         the Cloudflare Worker, one private store per person
    web             the page
    plugins         JSON only plugins for Claude Code and Codex
    .claude-plugin  the marketplace entry for the Claude Code plugin
    docs            format.md, cost.md and vendors.md

## Run locally

You need Node 22 or newer.

    npm test

    npm --prefix service ci
    npm --prefix service test
    cp service/.dev.vars.example service/.dev.vars
    npm --prefix web ci
    npm --prefix web run build
    npm --prefix service run dev -- --var DEV_LOGIN:1

Set COOKIE_KEY in service/.dev.vars to 64 hex characters before the last command. The page is then served at http://localhost:8790 and agents connect to http://localhost:8790/mcp.
