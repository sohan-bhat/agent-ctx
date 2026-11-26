import test from 'node:test';
import assert from 'node:assert/strict';
import { hookOutput, quietPrompt } from '../src/hooks.ts';
import { FIRST_CHARS } from '../src/caps.ts';

test('a short prompt or one that starts with a slash, a bang or a hash is quiet', () => {
  for (const p of ['', 'ok', 'continue pls', '  fourteen chars ', '/compact the session now', '!git status --short here', '# remember to use pnpm here']) assert.equal(quietPrompt(p), true, p);
  for (const p of ['fifteen letters', 'fix the failing login test', 'what does #42 say about caching']) assert.equal(quietPrompt(p), false, p);
});

test('hookOutput gives the JSON hook output for claude-code and codex only', () => {
  const text = 'agent-ctx memory for kiln.\n> "quote" and \\ slash';
  for (const host of ['claude-code', 'codex']) {
    const out = hookOutput(host, 'UserPromptSubmit', text);
    assert.deepEqual(JSON.parse(out), { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } });
  }
  assert.equal(JSON.parse(hookOutput('codex', 'SessionStart', 'x')).hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(hookOutput('cursor', 'UserPromptSubmit', text), '');
  assert.equal(hookOutput('', 'UserPromptSubmit', text), '');
  assert.equal(hookOutput('claude-code', 'UserPromptSubmit', ''), '');
});

test('the added text never passes the first call cap', () => {
  const out = JSON.parse(hookOutput('claude-code', 'UserPromptSubmit', 'word '.repeat(2000)));
  assert.ok(out.hookSpecificOutput.additionalContext.length <= FIRST_CHARS);
});
