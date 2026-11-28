# AGENTS.md

This file is guidance for agents and people who change this repository.

## What agent-ctx is

agent-ctx is one memory on a person's computer, shared by agent products of different vendors. A hosted mode with one private store per person is optional and lies under service.

    core            shared TypeScript with no runtime dependencies
    local           the program for one computer, with one SQLite file under the home folder
    plugins         the Claude Code plugin, with the two built program files in plugins/claude-code/scripts
    .claude-plugin  the marketplace entry for the Claude Code plugin
    service         the optional Cloudflare Worker, with the runtime scripts in service/e2e and the JSON only plugins of the hosted mode in service/plugins
    web             the page, in a hosted form and in a local form for `agent-ctx page`
    docs            format.md, cost.md and vendors.md

## Rules

- Use npm only, with Node 22.16 or newer. Bun at one pinned version is used only in .github/workflows/release.yml, where the built file is compiled into one program.
- Write no code comments.
- Begin every fix with a test that fails, and give every new test one mutation under which that test fails.
- A fake key or webhook address in a test is built by joining string pieces, because a push that contains a lookalike is blocked by GitHub.
- Export only the handler and the object classes from the entry file service/src/index.ts. Every other export is read as a handler by the runtime and the Worker does not start.
- No rule is made active by anything a model can send. One sign in is shared by a hook and a model, so text from a hook counts as written by an agent.
- On one computer a rule is accepted only by a person, with `agent-ctx rules accept ID` at a terminal or with Accept on the page of `agent-ctx page`. Both ways are out of reach for every hook and every tool call, and no tool and no hook knows the port or the token of that page.
- The person id is taken only from the verified token or the signed cookie.
- Redaction is applied to the whole text before any cut, and every call over 8 KB is refused before any pattern is run.
- A plugin under service/plugins contains JSON only. The local plugin contains the built files of plugins/claude-code/scripts and no other script.
- The program has two forms. The script form is the built files run by Node, and the self contained form is one compiled program with no Node, in which `PROGRAM` of local/src/db.ts is the path of the running file.
- A bare `agent-ctx` command is never printed. The command in every printed text is built by `typed` in local/src/db.ts.
- A release is made from a tag of the form v1.2.3 that equals the version in package.json.
- A hook is one short run of hook.mjs with no MCP library, or one run of the program with the word hook in the self contained form. Every run ends with exit 0 and an empty stderr, and the wait for the memory file ends after one second.
- With a mirror on, one `agent-ctx sync` is started as a detached process on SessionStart and on Stop, at most once per 60 seconds, and the hook run ends at once. No other program is started from hook.mjs.
- The memory file is never placed in a mirror. Every record read from a mirror counts as text written by an agent, so a rule from a mirror arrives as pending.
- HOME and AGENT_CTX_HOME are set to a temp folder in every test and proof, with one exception. Proofs 2, 3 and 4 of local/e2e.mjs start the real Claude Code program with the real HOME, where the sign in of that program is kept, and with AGENT_CTX_HOME in a temp folder. No `claude` command found on PATH is started by a test.
- Never open or print the queries of core/test/corpus3.ts and core/test/corpus4.ts. Those sets stay blind, so recall settings are chosen on corpus2.ts alone.
- A commit message is one line of at most six words.
- The memory rules are in service/src/engine.ts and the tool definitions in service/src/mcp.ts. Both files are shared by the Worker and the local program, so no import from Cloudflare is allowed in either file.
- After any change under core/src, service/src or local/src, run `npm run build` and commit plugins/claude-code/scripts. The root test stays red while a committed file there differs from a fresh build.

## Before a push

    npm run typecheck
    npm test
    node local/e2e.mjs 1 5 6 speed mirror
    npm --prefix service run typecheck
    npm --prefix service test
    node service/e2e/real.mjs
    npm --prefix service run conformance
    npm --prefix web run build
    node web/e2e/run.mjs
    node web/e2e/consent.mjs
    node web/e2e/real.mjs
    npm --prefix web run build:local
    node web/e2e/local.mjs

Run `node local/e2e.mjs` with no argument before a release. In proofs 2, 3 and 4 the real Claude Code program is started with haiku, at a cost of a few cents.

The conformance step consists of the official MCP conformance suite, with both requirement sets 2025-11-25 and 2026-07-28 and the authorization server scenarios, run against the real local runtime. Every possible failure of this step is listed with a reason in service/conformance-baseline.yml. Never add a real fault there.

Passing unit suites are no proof that the Worker starts or that sign in can be finished in a browser. The real local runtime is started with service/e2e/real.mjs, and a real browser is taken through the sign in page for agents with web/e2e/consent.mjs. Run both scripts after any change to service/src.

For WebKit and Firefox set ENGINE to webkit or firefox before the web scripts.
