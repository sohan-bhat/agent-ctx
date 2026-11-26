const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant|svcacct)[-_][A-Za-z0-9_-]{12,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{12,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bya29\.[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{20,}/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\bwhsec_[A-Za-z0-9+/=]{16,}/g,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /https?:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9_/-]{8,}/g,
  /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]{5,}\/[A-Za-z0-9_-]{20,}/g,
  /https?:\/\/[a-z0-9-]{1,63}\.webhook\.office\.com\/[^\s"'<>]{20,}/gi,
  /(?<=[?&])sig=[A-Za-z0-9%+/=]{16,}/g,
  /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s:@/]+:[^\s@/]+@/g,
];

export const DROPPED = '[secret dropped]';

const AUTH = /(?<![A-Za-z0-9_-])((?:proxy-)?authorization)(["'`]?\s*(?:[:=]\s*)?["'`]?)(bearer|basic|token|digest|negotiate)(\s+)([^\s"'`,;]+)/gi;

const NAMED = /(?<![A-Za-z0-9_.-])([A-Za-z][A-Za-z0-9_.-]{0,63})(["'`]?[ \t]*[:=][ \t]*["'`]?)([^\s"'`,;]{6,})/g;

const SPACED = /\b(bearer|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|pwd|private[_-]?key)\b(\s+)([^\s"'`,;]{6,})/gi;

const OPAQUE = /(?<![A-Za-z0-9+/=_.-])[A-Za-z0-9+/=_.-]{32,}(?![A-Za-z0-9+/=_.-])/g;

const SECRET_WORDS = ['password', 'passwd', 'pwd', 'pass', 'secret', 'token', 'apikey', 'credential', 'credentials', 'bearer', 'authorization'];
const KEY_KINDS = new Set(['api', 'secret', 'access', 'private', 'account', 'signing', 'master', 'encryption', 'client', 'storage']);
const PLAIN = /^(?:the|a|an|is|was|for|and|to|of|in|on|with|from|that|this|it)$/i;
const SCHEME = /^(?:bearer|basic|token|digest|negotiate)$/i;

function secretName(name: string): boolean {
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_.-]+/)
    .filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  const prev = parts[parts.length - 2] ?? '';
  if (last === 'key') return KEY_KINDS.has(prev);
  if (last.length > 24) return false;
  return SECRET_WORDS.some((w) => last === w || (w.length >= 5 && last.endsWith(w)));
}

function looksOpaque(s: string): boolean {
  const core = s.replace(/=+$/, '');
  if (/^[a-z]+(?:[-_][a-z]+)*$/i.test(core)) return false;
  const digits = (core.match(/[0-9]/g) || []).length;
  const upper = (core.match(/[A-Z]/g) || []).length;
  const lower = (core.match(/[a-z]/g) || []).length;
  const kinds = (digits > 0 ? 1 : 0) + (upper > 0 ? 1 : 0) + (lower > 0 ? 1 : 0);
  if (/^[0-9a-f]+$/i.test(core)) return core.length >= 32;
  return kinds >= 2 && digits >= 3;
}

function kind(c: string): number {
  if (c >= 'a' && c <= 'z') return 0;
  if (c >= 'A' && c <= 'Z') return 1;
  if (c >= '0' && c <= '9') return 2;
  return 3;
}

function looksKeyWithMarks(s: string): boolean {
  if (s.startsWith('/') || s.startsWith('.') || s.includes('//') || /\.[a-z]{1,5}$/.test(s)) return false;
  const upper = (s.match(/[A-Z]/g) || []).length;
  const lower = (s.match(/[a-z]/g) || []).length;
  const digits = (s.match(/[0-9]/g) || []).length;
  if (upper < 3 || lower < 3 || (digits < 1 && !/[+/]/.test(s))) return false;
  const letters = s.replace(/[^A-Za-z0-9]/g, '');
  let turns = 0;
  for (let i = 1; i < letters.length; i++) if (kind(letters[i]) !== kind(letters[i - 1])) turns++;
  return turns / letters.length >= 0.3;
}

function dropped(v: string): boolean {
  return v.startsWith(DROPPED.slice(0, 7));
}

export function redact(text: string): string {
  if (!text) return text;
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, DROPPED);
  out = out.replace(AUTH, (m, key: string, sep: string, scheme: string, ws: string, val: string) => (dropped(val) ? m : `${key}${sep}${scheme}${ws}${DROPPED}`));
  out = out.replace(NAMED, (m, name: string, sep: string, val: string) => {
    if (dropped(val) || PLAIN.test(val) || SCHEME.test(val) || !secretName(name)) return m;
    return `${name}${sep}${DROPPED}`;
  });
  out = out.replace(SPACED, (m, key: string, sep: string, val: string) => {
    if (dropped(val) || PLAIN.test(val)) return m;
    const bearer = /^bearer$/i.test(key);
    if (bearer ? /^[a-z]+$/.test(val) : !looksOpaque(val)) return m;
    return `${key}${sep}${DROPPED}`;
  });
  out = out.replace(OPAQUE, (m) => {
    if (dropped(m)) return m;
    if (/[/.]/.test(m)) return looksKeyWithMarks(m) ? DROPPED : m;
    return looksOpaque(m) ? DROPPED : m;
  });
  return out;
}

export function hasSecret(text: string): boolean {
  return redact(text) !== text;
}
