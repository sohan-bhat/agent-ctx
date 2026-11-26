import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, DROPPED } from '../src/redact.ts';

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

const leaks: [string, string][] = [
  ['Authorization: Bearer ya29.a0AfH6SMBx3kQz_9vLmN-pQrStUvWxYz0123456789abcdefGHIJ', 'a0AfH6SMBx3kQz'],
  ['curl -H "Authorization: Bearer 8f3kZp_Lq2-Wm9xT.Vn4cRb7Ys1Ae6Ud0Hg5Jk"', '8f3kZp_Lq2'],
  ['Authorization: Basic YWRtaW46aHVudGVyMjAyNg==', 'YWRtaW46aHVudGVy'],
  ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI'],
  ['DB_PASSWORD=Tr0ub4dor&3horse', 'Tr0ub4dor'],
  ['POSTGRES_PASSWORD=correcthorsebattery', 'correcthorse'],
  ['SECRET_KEY=django-insecure-7x!k2m@p9q#w4e', 'django-insecure'],
  ['JWT_SECRET=mysupersecretsigningvalue', 'mysupersecret'],
  ['export STRIPE_WEBHOOK_SECRET=whsec_abcDEFghiJKLmnoPQRstuVWX', 'whsec_abc'],
  ['post to https://hooks.slack.com/' + 'services/T0FAKE000/B0FAKE000/abcdefghijklmnopqrstuvwx now', 'abcdefghijklmnopqrstuvwx'],
  ['https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd', 'AbCdEfGhIjKlMnOp'],
  ['DefaultEndpointsProtocol=https;AccountName=fakeacct;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;EndpointSuffix=core.windows.net', 'Eby8vdM02x'],
  ['https://fakeacct.blob.core.windows.net/c/f.txt?sv=2022-11-02&sig=AbCdEf1234567890GhIjKlMnOp%2Bqrs%3D', 'AbCdEf1234567890'],
  ['npm_' + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ012', 'aBcDeFgHiJkL'],
  ['glpat-' + 'aBcDeFgHiJkLmNo', 'aBcDeFgHiJkLmNo'],
  ['token=' + 'kT4mX9qWv2LpR7sY1nB6' + '/' + 'dE3fG8hJ0kL5mN', 'kT4mX9qWv2'],
];

test('drops the token behind an auth scheme, env style names, webhooks and cloud keys', () => {
  for (const [input, secret] of leaks) {
    const out = redact(input);
    assert.ok(!out.includes(secret), `${input} became ${out}`);
    assert.ok(out.includes(DROPPED), input);
  }
});

test('keeps the header and the name when the value goes', () => {
  assert.equal(redact('Authorization: Bearer ya29.a0AfH6SMBx3kQz_9vLmN-pQrStUvWxYz0123'), `Authorization: Bearer ${DROPPED}`);
  assert.equal(redact('DB_PASSWORD=Tr0ub4dor&3horse'), `DB_PASSWORD=${DROPPED}`);
  assert.equal(redact('"apiKey": "zq81Lm0pQr77"'), `"apiKey": "${DROPPED}"`);
});

test('redacting twice changes nothing more', () => {
  for (const [input] of leaks) assert.equal(redact(redact(input)), redact(input), input);
});

test('ordinary sentences with token, key, secret and password stay untouched', () => {
  const plain = [
    'API key rotation is planned for next week',
    'store the secret in the vault and never in the repo',
    'max_tokens: 4096',
    'token_count: 123456',
    'password_field: hidden',
    'secret_name: production',
    'the key is to keep the cache warm',
    'Authorization header with a bearer token is required',
    'use Basic authentication only in local tests',
    'Bearer authentication is set up in the gateway',
    'packages/app2/src/v3/components/Button123.tsx',
    'com.example.myApplication.MainActivity2',
    'https://example.com/docs/v2/getting-started/Install2024.html',
    'see the Slack channel hooks for deploy notes',
    'renamed DB_PASSWORD to DB_PASS in the env file',
  ];
  for (const p of plain) assert.equal(redact(p), p);
});

test('a bare key with slashes or dots is dropped while paths and package names stay', () => {
  for (const key of ['wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', '8f3kZp_Lq2-Wm9xT.Vn4cRb7Ys1Ae6Ud0Hg5Jk']) {
    const out = redact(`copy ${key} into the vault`);
    assert.equal(out, `copy ${DROPPED} into the vault`);
  }
  for (const s of ['src/features/onboarding/StepTwoWelcomeScreen.tsx', 'com.example.myApplication.MainActivity2', 'build/output/Release2024/AppBundle.zip']) assert.equal(redact(s), s);
});
