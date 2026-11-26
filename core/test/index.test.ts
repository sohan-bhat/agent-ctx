import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

test('the index exports every name the service needs', () => {
  const names = [
    'ITEM_BYTES', 'RESULT_CHARS', 'CALL_CHARS', 'FIRST_CHARS', 'RULE_MIN', 'RULE_MAX', 'RULE_PROMPT_MAX', 'RULES_AUTO_PER_DAY', 'RULES_SHOWN', 'STORE_BYTES', 'FOLD_AT', 'cut', 'bytes',
    'newItem', 'itemText', 'itemBytes', 'fit',
    'cleanRemote', 'folderName', 'resolveProject', 'projectName',
    'sanitize', 'sanitizeItem',
    'eventKey', 'autoCard', 'autoHandoff', 'droppedAt',
    'normalizeWords', 'proveWords', 'decideRule', 'ruleLine',
    'rankItems', 'recent', 'namedProjects',
    'recall', 'HEADER',
    'totalBytes', 'foldCard', 'foldPlan', 'mergeFolded', 'applyPlan', 'underCeiling',
    'redact', 'hasSecret', 'DROPPED', 'tokens',
  ];
  const got = core as Record<string, unknown>;
  for (const name of names) assert.ok(name in got, name);
});
