import type { Store } from './store.ts';

export interface Max { perMinute: number; perDay: number; storedPerDay: number; agents: number; inputBytes: number; storeBytes: number }

export const MAX: Max = { perMinute: 60, perDay: 2000, storedPerDay: 500, agents: 20, inputBytes: 8192, storeBytes: 10 * 1024 * 1024 };

export const SAY = {
  minute: 'Too many calls this minute. Wait a minute and try again.',
  day: 'The limit of 2,000 calls for today is reached. Calls are accepted again tomorrow.',
  stored: '500 items were stored in this account today. More can be stored tomorrow.',
  size: 'This text is too large to store. Keep the text under 2 KB.',
  agents: 'This account already has 20 connected agents.',
  full: 'The memory is full. Remove or pin fewer items on the agent-ctx page to store more.',
  clean: 'This text could not be cleaned, so nothing was stored.',
  scope: 'This connection has read access only. Connect again with write access to save.',
  noread: 'This connection has no read access.',
  where: 'Give the repo or the folder of the project for a project rule.',
  projects: 'This account already has 200 projects with saved items. Remove the items of an old project on the agent-ctx page to add a new one.',
  place: 'Pass repo or folder so the text is saved to the right project.',
  placeRead: 'Pass repo or folder to get the handoff and recent work of this project.',
};

export const FLUSH_EVERY = 60000;
export const RESERVE = 5;
const LIVE = 3 * 60000;
const KEY_TTL = 86400000;
const BODY_TTL = 10 * 60000;
const BODY_MARKS = 64;
const KEY_MARKS = 256;

export interface Mark { id: string; at: number; text: string }

export interface Hot {
  minute: number;
  minuteN: number;
  day: string;
  dayN: number;
  storedDay: string;
  storedN: number;
  bytes: number;
  extra: number;
  folded: number;
  maintained: number;
  paused: { reason: string; at: number } | null;
  live: [string, string, number][];
  marks: [string, string, number, string][];
  savedAt: number;
}

function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function blank(): Hot {
  return { minute: 0, minuteN: 0, day: '', dayN: 0, storedDay: '', storedN: 0, bytes: 0, extra: 0, folded: -1, maintained: 0, paused: null, live: [], marks: [], savedAt: 0 };
}

export class Limits {
  max: Max = { ...MAX };
  reserve = RESERVE;
  private store: Store;
  private hot: Hot | null = null;
  private dirty = false;
  private paid: { day: string; dayN: number; minute: number; minuteN: number } | null = null;

  constructor(store: Store) {
    this.store = store;
  }

  state(): Hot {
    if (!this.hot) this.hot = { ...blank(), ...this.store.meta<Partial<Hot>>('hot', {}) };
    return this.hot;
  }

  reset(): void {
    this.hot = blank();
    this.dirty = false;
    this.paid = null;
  }

  private roll(now: number): Hot {
    const h = this.state();
    const minute = Math.floor(now / 60000);
    const day = dayOf(now);
    if (h.minute !== minute) {
      h.minute = minute;
      h.minuteN = 0;
    }
    if (h.day !== day) {
      h.day = day;
      h.dayN = 0;
    }
    if (h.storedDay !== day) {
      h.storedDay = day;
      h.storedN = 0;
    }
    return h;
  }

  touch(): void {
    this.dirty = true;
  }

  flush(now: number, force = false): void {
    const h = this.state();
    if (!this.dirty) return;
    if (!force && now - h.savedAt < FLUSH_EVERY) return;
    h.live = h.live.filter(([, , last]) => now - last < LIVE);
    h.marks = h.marks.filter(([m, , at]) => now - at < (m.startsWith('key:') ? KEY_TTL : BODY_TTL));
    h.savedAt = now;
    const paid = { day: h.day, dayN: h.dayN + this.reserve, minute: h.minute, minuteN: h.minuteN + this.reserve };
    this.store.setMeta('hot', { ...h, ...paid });
    this.paid = paid;
    this.dirty = false;
  }

  call(now: number): { stop: string | null; persist: boolean } {
    const h = this.roll(now);
    if (h.minuteN >= this.max.perMinute) return { stop: SAY.minute, persist: false };
    if (h.dayN >= this.max.perDay) return { stop: SAY.day, persist: false };
    h.minuteN++;
    h.dayN++;
    this.dirty = true;
    const p = this.paid;
    const persist = !p || p.day !== h.day || p.minute !== h.minute || h.dayN > p.dayN || h.minuteN > p.minuteN;
    if (persist) this.flush(now, true);
    return { stop: null, persist };
  }

  canStore(now: number): string | null {
    const h = this.roll(now);
    return h.storedN >= this.max.storedPerDay ? SAY.stored : null;
  }

  stored(now: number): void {
    const h = this.roll(now);
    h.storedN++;
    this.dirty = true;
  }

  today(now: number): { calls: number; stored: number } {
    const h = this.roll(now);
    return { calls: h.dayN, stored: h.storedN };
  }

  refuse(reason: string, now: number): void {
    this.state().paused = { reason, at: now };
    this.dirty = true;
    this.flush(now, true);
  }

  clear(): void {
    const h = this.state();
    if (!h.paused) return;
    h.paused = null;
    this.dirty = true;
  }

  paused(now: number): string | null {
    const p = this.state().paused;
    if (!p || now - p.at > 86400000) return null;
    return `Capture is paused. ${p.reason}`;
  }

  bytes(): number {
    return this.state().bytes;
  }

  setBytes(n: number): void {
    this.state().bytes = Math.max(0, n);
    this.dirty = true;
  }

  extra(): number {
    return this.state().extra ?? 0;
  }

  setExtra(n: number): void {
    this.state().extra = Math.max(0, n);
    this.dirty = true;
  }

  folded(): number {
    return this.state().folded;
  }

  setFolded(n: number): void {
    this.state().folded = n;
    this.dirty = true;
  }

  seen(sid: string, grant: string, now: number): void {
    const h = this.state();
    const at = h.live.findIndex(([s]) => s === sid);
    if (at >= 0) h.live[at] = [sid, grant, now];
    else h.live.push([sid, grant, now]);
    this.dirty = true;
  }

  live(now: number): { sid: string; grant: string; last: number }[] {
    return this.state()
      .live.filter(([, , last]) => now - last < LIVE)
      .map(([sid, grant, last]) => ({ sid, grant, last }));
  }

  mark(name: string): Mark | null {
    const m = this.state().marks.find(([k]) => k === name);
    return m ? { id: m[1], at: m[2], text: m[3] } : null;
  }

  setMark(name: string, mark: Mark): void {
    const h = this.state();
    h.marks = h.marks.filter(([k]) => k !== name);
    h.marks.push([name, mark.id, mark.at, mark.text]);
    const body = h.marks.filter(([k]) => !k.startsWith('key:'));
    const key = h.marks.filter(([k]) => k.startsWith('key:'));
    if (body.length > BODY_MARKS || key.length > KEY_MARKS) h.marks = [...key.slice(-KEY_MARKS), ...body.slice(-BODY_MARKS)];
    this.dirty = true;
  }
}

export const REGISTER_ROUTE = '/oauth/register';
export const TOKEN_ROUTE = '/oauth/token';
export const SIGN_IN_ROUTES = new Set(['/authorize', '/login', '/login/callback', '/login/dev']);
export const CLIENT_TTL = 30 * 86400;
export const REGISTRATIONS_PER_DAY = 150;
export const SLOW_DOWN = 'Too many requests from this address. Wait a minute and try again.';
export const REGISTRATIONS_FULL = 'New sign ins of self registered apps are paused until tomorrow. Sign in stays open for apps with a published identity, such as Claude Code and Codex.';

export function limiterFor<L>(e: { REGISTER_LIMIT: L; TOKEN_LIMIT: L; SIGNIN_LIMIT: L }, path: string): L | null {
  if (path === REGISTER_ROUTE) return e.REGISTER_LIMIT;
  if (path === TOKEN_ROUTE) return e.TOKEN_LIMIT;
  if (SIGN_IN_ROUTES.has(path)) return e.SIGNIN_LIMIT;
  return null;
}

export function registrationCap(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : REGISTRATIONS_PER_DAY;
}

function hextets(part: string): string[] {
  if (!part) return [];
  const out: string[] = [];
  for (const h of part.split(':')) {
    if (h.includes('.')) out.push('0', '0');
    else out.push(h);
  }
  return out;
}

export function addressKey(ip: string | null): string {
  if (!ip) return 'unknown';
  const raw = ip.trim().toLowerCase();
  if (!raw.includes(':')) return raw;
  const halves = raw.split('::');
  if (halves.length > 2) return raw;
  const head = hextets(halves[0]);
  const tail = halves.length === 2 ? hextets(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return raw;
  const full = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (!full.every((h) => /^[0-9a-f]{1,4}$/.test(h))) return raw;
  return `${full.slice(0, 4).map((h) => parseInt(h, 16).toString(16)).join(':')}::/64`;
}
