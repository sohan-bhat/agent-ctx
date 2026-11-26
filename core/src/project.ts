export interface Known { paths: Record<string, string>; aliases: Record<string, string>; repos: string[] }

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;
const SCP = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)([^?#\s]+)/;
const DRIVE = /^[a-z]:(?:[\\/]|$)/i;

function cleanPath(host: string, path: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h || !/^[a-z0-9.-]+$/.test(h)) return null;
  const parts = path
    .split('/')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  if (parts.length && parts[parts.length - 1] === '.git') parts.pop();
  if (!parts.length) return null;
  const last = parts.length - 1;
  parts[last] = parts[last].replace(/\.git$/, '');
  if (!parts[last]) return null;
  return [h, ...parts].join('/');
}

export function cleanRemote(url: string): string | null {
  const s = (url ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  if (s.startsWith('/') || s.startsWith('.') || s.startsWith('~') || s.startsWith('\\') || DRIVE.test(s)) return null;
  if (/^folder:/i.test(s)) return null;
  const m = SCHEME.exec(s);
  if (m) {
    if (m[1].toLowerCase() === 'file') return null;
    const auth = m[2].slice(m[2].lastIndexOf('@') + 1).replace(/:\d*$/, '');
    return cleanPath(auth, m[3]);
  }
  const scp = SCP.exec(s);
  if (scp) return cleanPath(scp[1], scp[2]);
  const slash = s.indexOf('/');
  if (slash > 0) {
    const host = s.slice(0, slash);
    if (host.includes('.') && !host.includes('@') && !host.includes(':')) return cleanPath(host, s.slice(slash).replace(/[?#].*$/, ''));
  }
  return null;
}

export function folderName(path: string): string {
  const parts = (path ?? '')
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  if (/^[a-z]:$/i.test(last)) return '';
  return last.toLowerCase();
}

export function projectName(key: string): string {
  const k = key ?? '';
  if (k.startsWith('folder:')) return k.slice('folder:'.length);
  const parts = k.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export function resolveProject(input: { repo?: string; folder?: string }, known: Known): { key: string; learn?: { path?: string; alias?: string } } {
  const folder = (input.folder ?? '').trim();
  const name = folder ? folderName(folder) : '';
  const repo = input.repo ? cleanRemote(input.repo) : null;
  if (repo) {
    if (!folder) return { key: repo };
    return { key: repo, learn: { path: folder, ...(name ? { alias: name } : {}) } };
  }
  if (folder && Object.hasOwn(known.paths, folder)) return { key: known.paths[folder] };
  if (name && Object.hasOwn(known.aliases, name)) return { key: known.aliases[name] };
  if (name) {
    const same = known.repos.filter((r) => projectName(r) === name);
    if (same.length === 1) return { key: same[0] };
  }
  return { key: name ? `folder:${name}` : 'folder:unknown' };
}
