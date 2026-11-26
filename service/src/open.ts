export const REGISTER_ROUTE = '/oauth/register';
export const TOKEN_ROUTE = '/oauth/token';
export const SIGN_IN_ROUTES = new Set(['/authorize', '/login', '/login/callback', '/login/dev']);
export const CLIENT_TTL = 30 * 86400;
export const REGISTRATIONS_PER_DAY = 300;
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
