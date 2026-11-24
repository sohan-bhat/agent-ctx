export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 90) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = h / 24;
  if (d < 14) return `${Math.round(d)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
}

export function shortPath(p: string): string {
  const parts = p.split('/');
  if (parts.length <= 4) return p;
  return `${parts[0] || ''}/…/${parts.slice(-2).join('/')}`.replace(/^\/…/, '…');
}

export function base(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function rel(p: string, root?: string): string {
  if (root && p.startsWith(root + '/')) return p.slice(root.length + 1);
  const home = root?.match(/^\/(?:Users|home)\/[^/]+/)?.[0];
  if (home && p.startsWith(home + '/')) return '~' + p.slice(home.length);
  return p;
}

export function mb(bytes: number): string {
  const v = bytes / 1_000_000;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} MB`;
}

export function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
