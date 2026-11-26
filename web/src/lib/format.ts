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

const two = (n: number) => String(n).padStart(2, '0');

export function clock(t: number): string {
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function day(t: number): string {
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')}`;
}

export function stamp(t: number): string {
  return `${day(t)} ${clock(t)}`;
}

export function megabytes(bytes: number): string {
  const v = bytes / (1024 * 1024);
  return v >= 10 ? String(Math.round(v)) : v >= 0.1 || v === 0 ? v.toFixed(1) : v.toFixed(2);
}
