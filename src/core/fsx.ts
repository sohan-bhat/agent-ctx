import fs from 'node:fs';
import path from 'node:path';
import { shares } from './limits.ts';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function atomicWrite(file: string, data: string | Buffer): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw e;
  }
}

export function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function readJson<T>(file: string): T | null {
  const t = readText(file);
  if (t == null) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

export function readJsonl<T>(file: string): T[] {
  const t = readText(file);
  if (!t) return [];
  const out: T[] = [];
  for (const line of t.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {}
  }
  return out;
}

export function writeJsonl(file: string, rows: unknown[]): void {
  atomicWrite(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

export function logError(logFile: string, where: string, err: unknown): void {
  try {
    ensureDir(path.dirname(logFile));
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const line = `${new Date().toISOString()} ${where} ${msg.replace(/\s+/g, ' ').slice(0, 500)}\n`;
    fs.appendFileSync(logFile, line);
    cutFile(logFile, shares().log);
  } catch {}
}

export function cutFile(file: string, max: number): boolean {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return false;
  }
  if (size <= max) return false;
  const keep = Math.floor(max / 2);
  const buf = Buffer.alloc(keep);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, keep, size - keep);
  } finally {
    fs.closeSync(fd);
  }
  const nl = buf.indexOf(10);
  atomicWrite(file, nl >= 0 && nl < buf.length - 1 ? buf.subarray(nl + 1) : buf);
  return true;
}
