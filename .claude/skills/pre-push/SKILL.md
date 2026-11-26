---
name: pre-push
description: Run the full check set of agent-ctx before a push. Use after any change to core, service, web or plugins, and always before pushing to main.
---

# Pre-push checks

Run from the repository root, in this order, and stop at the first failure.

1. `npm run typecheck` and `npm test`. Core, importer and plugin tests.
2. `npm --prefix service run typecheck` and `npm --prefix service test`. The Worker in the Vitest plugin.
3. `node test-e2e/real.mjs`. Starts the real local runtime, signs two agents in and reads a checkpoint back. The unit suite cannot show that the Worker starts.
4. `npm --prefix web run build`, then `node web/e2e/run.mjs` and `node web/e2e/more.mjs`. The page against mock data, with the accessibility and keyboard checks.
5. `node web/e2e/consent.mjs`. A real browser through the sign in page for agents. Run after any change to service/src/auth.ts.
6. `node web/e2e/real.mjs`. The page against the real local service.
7. After a change to recall ranking, `npm run precision`, and report all twelve numbers.

Repeat steps 4 to 6 with `ENGINE=webkit` when the page or the sign in pages changed.

Set `WRANGLER_LOG_PATH` to a temp folder, `DISABLE_TELEMETRY=1` and `WRANGLER_SEND_METRICS=false` for every step that starts the service.

A fake key or webhook address in a test is built by joining string pieces. GitHub blocks a push that holds a lookalike.
