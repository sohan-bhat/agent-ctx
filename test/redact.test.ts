import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, DROPPED } from '../src/core/redact.ts';

const fakes: Record<string, string> = {
  anthropic: 'sk-ant-api03-' + 'Q'.repeat(10) + 'abc123DEF456ghi789',
  openai: 'sk-proj-' + 'AbCdEf0123456789'.repeat(2),
  stripe: 'sk_live_' + '51Hx9aBcDeFgHiJkLmNoPq',
  github: 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  githubPat: 'github_pat_' + '11ABCDEFG0123456789_abcdefghijklmnop',
  slack: 'xoxb-' + '1234567890-abcdefghij',
  aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
  google: 'AIza' + 'SyA1234567890abcdefghijklmnopqrstu',
  npm: 'npm_' + 'abcdefghijklmnopqrstuvwxyz0123456789',
  jwt: 'eyJhbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  hexToken: 'f3a9c2' + 'e8b1d4'.repeat(6),
};

test('drops every key shape', () => {
  for (const [name, key] of Object.entries(fakes)) {
    const out = redact(`use this ${key} for the call`);
    assert.ok(!out.includes(key), `${name} leaked`);
    assert.ok(out.includes(DROPPED), `${name} not marked`);
  }
});

test('drops keyed values', () => {
  for (const s of ['password=hunter2hunter2', 'API_KEY: "zq81Lm0pQr"', 'Authorization: Bearer abc.def.ghijkl', 'token = 9f8e7d6c5b4a', 'client_secret=Xy12Zz98Qq']) {
    const out = redact(s);
    assert.ok(out.includes(DROPPED), s);
  }
});

test('drops private keys and url credentials', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAx\n-----END RSA PRIVATE KEY-----';
  assert.equal(redact(pem), DROPPED);
  const url = 'clone https://user:s3cretpass@example.com/repo.git';
  assert.ok(!redact(url).includes('s3cretpass'));
});

test('keeps ordinary text, paths and names', () => {
  const plain = [
    'fix the token refresh bug in src/auth/refreshToken.ts',
    'the password field should be hidden on the login form',
    'move /home/someone/code/projects/very-long-project-name/src/components/SessionList.tsx',
    'run npm test and then push the branch feature/compaction-markers',
    'use BM25 over titles summaries prompts and file names',
  ];
  for (const p of plain) assert.equal(redact(p), p);
});
