import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
import { scratch, makeRepo, removeScratch, Transcript } from './synth.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface World {
  root: string;
  claude: string;
  code: string;
  repos: Record<string, string>;
}

after(() => removeScratch());

export function world(name: string): World {
  const root = scratch(name);
  const claude = path.join(root, 'claude');
  const code = path.join(root, 'code');
  fs.mkdirSync(claude, { recursive: true });
  fs.mkdirSync(code, { recursive: true });
  return { root, claude, code, repos: {} };
}

export function repo(w: World, name: string, remote?: string): string {
  const dir = makeRepo(path.join(w.code, name), remote);
  w.repos[name] = dir;
  return dir;
}

export { Transcript };
