import test from 'node:test';
import assert from 'node:assert/strict';
import { guessRoot, remoteName } from '../src/place.ts';

test('guessRoot skips container folders and stops above generic ones', () => {
  assert.equal(guessRoot('/h/code/projects/foo/src/a.ts', '/h/code'), '/h/code/projects/foo');
  assert.equal(guessRoot('/h/code/projects/foo/src/a.ts', '/h'), '/h/code/projects/foo');
  assert.equal(guessRoot('/h/notes/src/a.ts', '/h/notes'), '/h/notes');
  assert.equal(guessRoot('/h/notes/a.md', '/h/notes'), '/h/notes');
  assert.equal(guessRoot('/h/code/projects/a.md', '/h/code'), '/h/code/projects');
});

test('remote names come out as owner and repo', () => {
  assert.equal(remoteName('git@github.com:Someone/Thing.git'), 'someone/thing');
  assert.equal(remoteName('https://github.com/someone/thing'), 'someone/thing');
  assert.equal(remoteName('https://gitlab.example.com/group/sub/thing.git/'), 'sub/thing');
});

test('a file under a plain working folder stays with that folder', async () => {
  const { placeOfFile } = await import('../src/place.ts');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { scratch } = await import('./synth.ts');
  const root = scratch('place');
  const notes = path.join(root, 'notes');
  const code = path.join(root, 'code');
  fs.mkdirSync(notes, { recursive: true });
  fs.mkdirSync(code, { recursive: true });
  assert.equal(placeOfFile(path.join(notes, 'journal', '2026', 'a.md'), notes).path, notes);
  assert.equal(placeOfFile(path.join(code, 'projects', 'foo', 'src', 'a.ts'), code).path, path.join(code, 'projects', 'foo'));
});
