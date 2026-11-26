import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const topCache = new Map<string, string | null>();
const rootCache = new Map<string, string | null>();
const home = path.resolve(os.homedir());

const MARKERS = [
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'setup.py',
  'go.mod',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Package.swift',
  'deno.json',
  'composer.json',
  'mix.exs',
  'CMakeLists.txt',
];

function hasMarker(dir: string): boolean {
  for (const m of MARKERS) if (exists(path.join(dir, m))) return true;
  return false;
}

export function markerRoot(dir: string): string | null {
  const visited: string[] = [];
  let d = path.resolve(dir);
  let found: string | null = null;
  for (;;) {
    const c = rootCache.get(d);
    if (c !== undefined) {
      found = c;
      break;
    }
    visited.push(d);
    if (d === home || d === '/') break;
    if (hasMarker(d)) {
      found = d;
      break;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  for (const v of visited) rootCache.set(v, found);
  return found;
}

export function gitTop(dir: string): string | null {
  const start = path.resolve(dir);
  const visited: string[] = [];
  let d = start;
  let found: string | null = null;
  for (;;) {
    const c = topCache.get(d);
    if (c !== undefined) {
      found = c;
      break;
    }
    visited.push(d);
    if (d !== home && d !== '/' && exists(path.join(d, '.git'))) {
      found = d;
      break;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  for (const v of visited) topCache.set(v, found);
  return found;
}

function exists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

export interface Place {
  path: string;
  git: boolean;
}

export function placeOfDir(cwd: string): Place {
  const top = gitTop(cwd);
  if (top) return { path: top, git: true };
  const root = markerRoot(cwd);
  return { path: root ?? path.resolve(cwd), git: false };
}

const CONTAINERS = new Set(
  'code projects project repos repositories repo work dev developer development workspace workspaces sites apps packages documents desktop downloads github gitlab git ml labs lab experiments sandbox playground clients oss personal school archive extras practice'.split(' '),
);

const GENERIC = new Set(
  'src source lib app web test tests spec docs doc public components scripts pages assets styles server client bin cmd internal pkg include examples static config'.split(' '),
);

export function guessRoot(file: string, base: string): string {
  const rel = path.relative(base, file).split('/').filter(Boolean);
  if (rel.length <= 1 || rel[0] === '..') return base;
  let i = 0;
  while (i < rel.length - 2 && CONTAINERS.has(rel[i].toLowerCase())) i++;
  if (GENERIC.has(rel[i].toLowerCase())) return path.join(base, ...rel.slice(0, i));
  return path.join(base, ...rel.slice(0, i + 1));
}

export function placeOfFile(file: string, cwd: string | undefined): Place {
  const dir = path.dirname(file);
  const top = gitTop(dir);
  if (top) return { path: top, git: true };
  const root = markerRoot(dir);
  if (root) return { path: root, git: false };
  if (cwd && cwd !== '/' && file.startsWith(cwd + '/')) {
    const c = placeOfDir(cwd);
    if (c.git || c.path !== path.resolve(cwd)) return c;
    const container = c.path === home || CONTAINERS.has(path.basename(c.path).toLowerCase());
    return { path: container ? guessRoot(file, c.path) : c.path, git: false };
  }
  if (file.startsWith(home + '/')) return { path: guessRoot(file, home), git: false };
  return { path: dir, git: false };
}

function gitDir(top: string): string | null {
  const g = path.join(top, '.git');
  try {
    const st = fs.statSync(g);
    if (st.isDirectory()) return g;
    const t = fs.readFileSync(g, 'utf8');
    const m = t.match(/gitdir:\s*(.+)/);
    if (!m) return null;
    const wt = path.resolve(top, m[1].trim());
    try {
      const common = fs.readFileSync(path.join(wt, 'commondir'), 'utf8').trim();
      return path.resolve(wt, common);
    } catch {
      return wt;
    }
  } catch {
    return null;
  }
}

export function remoteOf(top: string): string | null {
  const gd = gitDir(top);
  if (!gd) return null;
  let cfg: string;
  try {
    cfg = fs.readFileSync(path.join(gd, 'config'), 'utf8');
  } catch {
    return null;
  }
  const sections = cfg.split(/^\[/m);
  let url: string | null = null;
  for (const s of sections) {
    const head = s.match(/^remote\s+"([^"]+)"\]/);
    if (!head) continue;
    const u = s.match(/^\s*url\s*=\s*(.+)$/m);
    if (!u) continue;
    if (head[1] === 'origin' || url == null) url = u[1].trim();
    if (head[1] === 'origin') break;
  }
  return url ? remoteName(url) : null;
}

export function remoteName(url: string): string | null {
  const u = url.replace(/\.git\/?$/, '').replace(/\/+$/, '');
  const m = u.match(/[:/]([^/:]+)\/([^/:]+)$/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`.toLowerCase();
}

export function branchOf(top: string): string | null {
  const g = path.join(top, '.git');
  let head: string;
  try {
    const st = fs.statSync(g);
    if (st.isDirectory()) head = fs.readFileSync(path.join(g, 'HEAD'), 'utf8');
    else {
      const m = fs.readFileSync(g, 'utf8').match(/gitdir:\s*(.+)/);
      if (!m) return null;
      head = fs.readFileSync(path.join(path.resolve(top, m[1].trim()), 'HEAD'), 'utf8');
    }
  } catch {
    return null;
  }
  const m = head.match(/ref:\s*refs\/heads\/(.+)/);
  return m ? m[1].trim() : null;
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'target',
  'out',
  'coverage',
  'vendor',
  '__pycache__',
  'venv',
  '.venv',
]);

export function recentFiles(root: string, limit = 12, maxEntries = 3000, maxDepth = 3): string[] {
  const found: { p: string; m: number }[] = [];
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (seen >= maxEntries) return;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (seen >= maxEntries) return;
      seen++;
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(e.name)) walk(p, depth + 1);
      } else if (e.isFile()) {
        try {
          found.push({ p, m: fs.statSync(p).mtimeMs });
        } catch {}
      }
    }
  };
  walk(root, 0);
  found.sort((a, b) => b.m - a.m);
  return found.slice(0, limit).map((f) => f.p);
}

export function clearPlaceCache(): void {
  topCache.clear();
  rootCache.clear();
}
