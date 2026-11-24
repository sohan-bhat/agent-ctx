import fs from 'node:fs';
import path from 'node:path';

export interface LockInfo {
  pid: number;
  at: number;
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readLock(dir: string): LockInfo | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

export function tryLock(dir: string, staleMs: number): boolean {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, at: Date.now() }));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const info = readLock(dir);
      let stat: fs.Stats | null = null;
      try {
        stat = fs.statSync(dir);
      } catch {
        continue;
      }
      const at = info?.at ?? stat.mtimeMs;
      const stale = (info && !alive(info.pid)) || Date.now() - at > staleMs || (!info && Date.now() - stat.mtimeMs > 2000);
      if (!stale) return false;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }
  return false;
}

export function releaseLock(dir: string): void {
  const info = readLock(dir);
  if (info && info.pid !== process.pid) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

export async function waitLock(dir: string, staleMs: number, waitMs: number): Promise<boolean> {
  const end = Date.now() + waitMs;
  for (;;) {
    if (tryLock(dir, staleMs)) return true;
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
}

export function withQuickLock<T>(dir: string, fn: () => T, waitMs = 40): T | null {
  const end = Date.now() + waitMs;
  for (;;) {
    if (tryLock(dir, 5000)) break;
    if (Date.now() >= end) return null;
    const t = Date.now() + 2;
    while (Date.now() < t) {}
  }
  try {
    return fn();
  } finally {
    releaseLock(dir);
  }
}
