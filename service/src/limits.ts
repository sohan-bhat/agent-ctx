import type { Store } from './store.ts';

export interface Max { perMinute: number; perDay: number; storedPerDay: number; agents: number; inputBytes: number; storeBytes: number }

export const MAX: Max = { perMinute: 60, perDay: 2000, storedPerDay: 500, agents: 20, inputBytes: 8192, storeBytes: 10 * 1024 * 1024 };

export const SAY = {
  minute: 'Too many calls this minute. Wait a minute and try again.',
  day: 'This account reached its 2,000 calls for today. Calls work again tomorrow.',
  stored: 'This account stored 500 items today. More can be stored tomorrow.',
  size: 'This text is too large to store. Keep it under 2 KB.',
  agents: 'This account already has 20 connected agents.',
  full: 'The memory is full. Remove or pin fewer items on the agent-ctx page to store more.',
  clean: 'This text could not be cleaned, so nothing was stored.',
  scope: 'This connection may only read. Connect again with write access to save.',
  noread: 'This connection has no read access.',
  where: 'A project rule needs the repo or the folder of that project.',
  place: 'Pass repo or folder so this is saved to the right project.',
  placeRead: 'Pass repo or folder to get the handoff and recent work of this project.',
};

export const FLUSH_EVERY = 60000;
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
  return { minute: 0, minuteN: 0, day: '', dayN: 0, storedDay: '', storedN: 0, bytes: 0, folded: -1, maintained: 0, paused: null, live: [], marks: [], savedAt: 0 };
}

export class Limits {
  max: Max = { ...MAX };
  private store: Store;
  private hot: Hot | null = null;
  private dirty = false;

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
    this.store.setMeta('hot', h);
    this.dirty = false;
  }

  call(now: number): string | null {
    const h = this.roll(now);
    if (h.minuteN >= this.max.perMinute) return SAY.minute;
    if (h.dayN >= this.max.perDay) return SAY.day;
    h.minuteN++;
    h.dayN++;
    this.dirty = true;
    return null;
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
