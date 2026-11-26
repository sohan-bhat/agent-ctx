export function since(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const STAMP = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const clock = (t: number) => CLOCK.format(t);
export const day = (t: number) => DAY.format(t);
export const stamp = (t: number) => STAMP.format(t);

const MB = [0, 1, 2].map((d) => new Intl.NumberFormat(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));

export function megabytes(bytes: number): string {
  const v = bytes / (1024 * 1024);
  return (v >= 10 ? MB[0] : v >= 0.1 || v === 0 ? MB[1] : MB[2]).format(v);
}

const COUNT = new Intl.NumberFormat();
export const count = (n: number) => COUNT.format(n);
