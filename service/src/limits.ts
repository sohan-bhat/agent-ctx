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
};

interface Counters { minute: number; minuteN: number; day: string; dayN: number; storedDay: string; storedN: number }

function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export class Limits {
  max: Max = { ...MAX };
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  private read(now: number): Counters {
    const c = this.store.meta<Counters>('counters', { minute: 0, minuteN: 0, day: '', dayN: 0, storedDay: '', storedN: 0 });
    const minute = Math.floor(now / 60000);
    const day = dayOf(now);
    if (c.minute !== minute) {
      c.minute = minute;
      c.minuteN = 0;
    }
    if (c.day !== day) {
      c.day = day;
      c.dayN = 0;
    }
    if (c.storedDay !== day) {
      c.storedDay = day;
      c.storedN = 0;
    }
    return c;
  }

  call(now: number): string | null {
    const c = this.read(now);
    if (c.minuteN >= this.max.perMinute) return SAY.minute;
    if (c.dayN >= this.max.perDay) return SAY.day;
    c.minuteN++;
    c.dayN++;
    this.store.setMeta('counters', c);
    return null;
  }

  canStore(now: number): string | null {
    const c = this.read(now);
    return c.storedN >= this.max.storedPerDay ? SAY.stored : null;
  }

  stored(now: number): void {
    const c = this.read(now);
    c.storedN++;
    this.store.setMeta('counters', c);
  }

  today(now: number): { calls: number; stored: number } {
    const c = this.read(now);
    return { calls: c.dayN, stored: c.storedN };
  }

  refuse(reason: string, now: number): void {
    this.store.setMeta('paused', { reason, at: now });
  }

  clear(): void {
    this.store.dropMeta('paused');
  }

  paused(now: number): string | null {
    const p = this.store.meta<{ reason: string; at: number } | null>('paused', null);
    if (!p || now - p.at > 86400000) return null;
    return `Capture is paused. ${p.reason}`;
  }
}
