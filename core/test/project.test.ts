import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRemote, folderName, projectName, resolveProject, type Known } from '../src/project.ts';

const none: Known = { paths: {}, aliases: {}, repos: [] };

test('the three example remotes all clean to host, owner and name', () => {
  assert.equal(cleanRemote('git@github.com:Owner/Name.git'), 'github.com/owner/name');
  assert.equal(cleanRemote('https://user:tok@github.com/Owner/Name.git/'), 'github.com/owner/name');
  assert.equal(cleanRemote('ssh://git@github.com:22/Owner/Name'), 'github.com/owner/name');
});

test('a GitLab subgroup remote keeps all three path parts', () => {
  assert.equal(cleanRemote('https://gitlab.com/Kiln-Group/Firmware/Ramp.git'), 'gitlab.com/kiln-group/firmware/ramp');
  assert.equal(cleanRemote('git@gitlab.com:kiln-group/firmware/ramp.git'), 'gitlab.com/kiln-group/firmware/ramp');
});

test('a remote with a port drops the port', () => {
  assert.equal(cleanRemote('ssh://git@git.example.org:2222/team/app.git'), 'git.example.org/team/app');
  assert.equal(cleanRemote('https://git.example.org:8443/Team/App'), 'git.example.org/team/app');
});

test('scheme, user, password, .git and trailing slashes never survive', () => {
  assert.equal(cleanRemote('HTTPS://GitHub.com/Owner/Name'), 'github.com/owner/name');
  assert.equal(cleanRemote('git://github.com/owner/name.git'), 'github.com/owner/name');
  assert.equal(cleanRemote('https://x-access-token:abc123@github.com/owner/name.git?ref=main'), 'github.com/owner/name');
  assert.equal(cleanRemote('github.com/owner/name/'), 'github.com/owner/name');
});

test('empty input, local paths and strings with no host give null', () => {
  for (const s of ['', '   ', '/srv/git/name.git', './name', '../name', '~/code/name', 'C:\\code\\name', 'file:///srv/git/name.git', 'owner/name', 'name', 'https://github.com', 'folder:name']) {
    assert.equal(cleanRemote(s), null, s);
  }
});

test('folderName is the last segment of a posix or Windows path, lower case', () => {
  assert.equal(folderName('/home/dev/code/Weather-Station'), 'weather-station');
  assert.equal(folderName('/home/dev/code/app/'), 'app');
  assert.equal(folderName('C:\\Users\\dev\\Code\\RecipeBox'), 'recipebox');
  assert.equal(folderName('D:/work/Mixed\\Path'), 'path');
  assert.equal(folderName(''), '');
  assert.equal(folderName('C:\\'), '');
});

test('projectName gives the last segment of a repo key or the folder name', () => {
  assert.equal(projectName('github.com/owner/name'), 'name');
  assert.equal(projectName('gitlab.com/a/b/c'), 'c');
  assert.equal(projectName('folder:notes'), 'notes');
});

test('step one, a repo that cleans wins and teaches the path and the alias', () => {
  const known: Known = { paths: { '/w/app': 'github.com/x/other' }, aliases: { app: 'github.com/x/other' }, repos: ['github.com/x/other'] };
  assert.deepEqual(resolveProject({ repo: 'git@github.com:Acme/App.git', folder: '/w/App' }, known), {
    key: 'github.com/acme/app',
    learn: { path: '/w/App', alias: 'app' },
  });
  assert.deepEqual(resolveProject({ repo: 'git@github.com:Acme/App.git' }, known), { key: 'github.com/acme/app' });
});

test('step two, the exact folder path seen before', () => {
  const known: Known = { paths: { '/w/site': 'github.com/acme/recipes' }, aliases: { site: 'github.com/acme/other' }, repos: [] };
  assert.deepEqual(resolveProject({ folder: '/w/site' }, known), { key: 'github.com/acme/recipes' });
  assert.deepEqual(resolveProject({ repo: 'not a remote', folder: '/w/site' }, known), { key: 'github.com/acme/recipes' });
});

test('step three, a folder name tied to a repo', () => {
  const known: Known = { paths: {}, aliases: { site: 'github.com/acme/recipes' }, repos: ['github.com/zed/site'] };
  assert.deepEqual(resolveProject({ folder: '/elsewhere/Site' }, known), { key: 'github.com/acme/recipes' });
});

test('step four, a folder name equal to exactly one repo name', () => {
  const known: Known = { paths: {}, aliases: {}, repos: ['github.com/acme/recipes', 'github.com/acme/chess'] };
  assert.deepEqual(resolveProject({ folder: '/w/chess' }, known), { key: 'github.com/acme/chess' });
});

test('two known repos that share a last segment give a new folder project', () => {
  const known: Known = { paths: {}, aliases: {}, repos: ['github.com/acme/chess', 'gitlab.com/other/chess'] };
  assert.deepEqual(resolveProject({ folder: '/w/chess' }, known), { key: 'folder:chess' });
});

test('step five, a new project named after the folder, or unknown', () => {
  assert.deepEqual(resolveProject({ folder: '/w/Club-Signup' }, none), { key: 'folder:club-signup' });
  assert.deepEqual(resolveProject({}, none), { key: 'folder:unknown' });
  assert.deepEqual(resolveProject({ repo: '/local/path' }, none), { key: 'folder:unknown' });
});

test('keys that look like object members are not taken from the prototype', () => {
  assert.deepEqual(resolveProject({ folder: '/w/constructor' }, none), { key: 'folder:constructor' });
  assert.deepEqual(resolveProject({ folder: 'toString' }, none), { key: 'folder:tostring' });
});
