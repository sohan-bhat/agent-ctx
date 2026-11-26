# AGENTS.md

This file is guidance for agents and people who change this repository.

## What agent-ctx is

agent-ctx is one hosted memory shared by agent products of different vendors.

    core       shared TypeScript with no runtime dependencies
    service    the Cloudflare Worker, one private store per person
    web        the page
    plugins    JSON only plugins, sources in plugins/src, stamped by scripts/stamp.mjs
    docs       format.md and cost.md

## Rules

- Use npm only, with Node 22 or newer.
- Write no code comments.
- Begin every fix with a test that fails, and give every new test one mutation under which that test fails.
- A fake key or webhook address in a test is built by joining string pieces, because a push that contains a lookalike is blocked by GitHub.
- Export only the handler and the object classes from the entry file service/src/index.ts, because every other export is read as a handler by the runtime and the Worker then does not start.
- A rule is never made active by anything a model can send. One sign in is shared by a hook and a model, so text from a hook is treated as written by an agent.
- The person id is taken only from the verified token or the signed cookie.
- Redaction is applied to the whole text before any cut, and every call over 8 KB is refused before any pattern is run.
- A plugin contains JSON only, and no script is ever placed on a person's machine.
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

The conformance step consists of the official MCP conformance suite, with both requirement sets 2025-11-25 and 2026-07-28 and the authorization server scenarios, run against the real local runtime. Every failure that may appear in this step is listed with a reason in service/conformance-baseline.yml. Never add a real fault to that file.

Passing unit suites are no proof that the Worker starts or that sign in can be finished in a browser. With the script test-e2e/real.mjs the real local runtime is started, and with web/e2e/consent.mjs a real browser is taken through the sign in page for agents. Run both scripts after any change to service/src.

For WebKit and Firefox set ENGINE to webkit or firefox before the web scripts.
