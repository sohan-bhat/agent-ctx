export const REGISTER_ROUTE = '/oauth/register';
export const TOKEN_ROUTE = '/oauth/token';
export const SIGN_IN_ROUTES = new Set(['/authorize', '/login', '/login/callback', '/login/dev']);
export const CLIENT_TTL = 30 * 86400;
export const REGISTRATIONS_PER_DAY = 150;
export const SLOW_DOWN = 'Too many requests from this address. Wait a minute and try again.';
export const REGISTRATIONS_FULL = 'New sign ins from apps that register themselves are paused until tomorrow. Apps with a published identity, such as Claude Code and Codex, still sign in.';

export function limiterFor(e: Env, path: string): RateLimit | null {
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
