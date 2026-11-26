import os from 'node:os';
import path from 'node:path';

export function claudeDir(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.CLAUDE_CONFIG_DIR;
  return v ? path.resolve(v) : path.join(os.homedir(), '.claude');
}

export function projectsDir(dir: string = claudeDir()): string {
  return path.join(dir, 'projects');
}

let tmpRoots: string[] | null = null;
let tmpKey = '';

function scratchRoots(): string[] {
  const env = process.env.AGENT_CTX_SCRATCH ?? '';
  if (tmpRoots && env === tmpKey) return tmpRoots;
  tmpKey = env;
  if (env) {
    tmpRoots = env.split(':').filter(Boolean).map((r) => (r.endsWith('/') ? r : r + '/'));
    return tmpRoots;
  }
  const roots = new Set<string>(['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/']);
  try {
    roots.add(path.resolve(os.tmpdir()) + '/');
  } catch {}
  tmpRoots = [...roots];
  return tmpRoots;
}

export function isScratchPath(p: string, claude: string = claudeDir()): boolean {
  if (p.startsWith(claude + '/')) return true;
  return scratchRoots().some((r) => p.startsWith(r));
}
