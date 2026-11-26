# AGENTS.md

Guidance for agents and people who change this repository.

## What this is

agent-ctx is one hosted memory shared by agent products of different vendors.

    core       shared TypeScript with no runtime dependencies
    service    the Cloudflare Worker, one private store per person
    web        the page
    plugins    JSON only plugins, sources in plugins/src, stamped by scripts/stamp.mjs
    importer   reader for Claude Code transcripts
    docs       format.md and cost.md

## Rules

- npm only. Node 22 or newer.
- No code comments.
- Every fix starts with a test that fails. Every new test gets one mutation that makes the test fail.
- A fake key or webhook address in a test is built by joining string pieces. GitHub blocks a push that holds a lookalike.
- The entry file service/src/index.ts exports only the handler and the object classes. The runtime reads every other export as a handler and the Worker does not start.
- Nothing a model can send makes a rule active. A hook and a model share one sign in, so text from a hook counts as written by an agent.
- The person id comes only from the verified token or the signed cookie.
- Redaction runs on the whole text before any cut. Every call is refused over 8 KB before any pattern runs.
- A plugin holds JSON only. No script reaches a person's machine.
- Never open or print the queries of core/test/corpus3.ts and core/test/corpus4.ts. Those sets stay blind, so recall settings are chosen on corpus2.ts alone.
- A commit message is one line of at most six words.

## Before a push

    npm run typecheck
    npm test
    npm --prefix service run typecheck
    npm --prefix service test
    node test-e2e/real.mjs
    npm --prefix service run conformance
    npm --prefix web run build
    node web/e2e/run.mjs
    node web/e2e/more.mjs
    node web/e2e/consent.mjs
    node web/e2e/real.mjs

The conformance step runs the official MCP conformance suite, both requirement sets 2025-11-25 and 2026-07-28 and the authorization server scenarios, against the real local runtime. Every failure it may show is listed with a reason in service/conformance-baseline.yml. Never add a real fault there.

The unit suites do not prove that the Worker starts or that a browser can finish sign in. The script test-e2e/real.mjs starts the real local runtime, and web/e2e/consent.mjs takes a real browser through the sign in page for agents. Run both after any change to service/src.

For WebKit and Firefox set ENGINE to webkit or firefox before the web scripts.
