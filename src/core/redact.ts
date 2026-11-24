const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant|svcacct)[-_][A-Za-z0-9_-]{12,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/g,
];

const KEYED = /\b(bearer|authorization|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|pwd|private[_-]?key)\b(["'`]?\s*[:=]\s*["'`]?|\s+)([^\s"'`,;]{6,})/gi;

const OPAQUE = /(?<![A-Za-z0-9/_.-])[A-Za-z0-9+_=-]{32,}(?![A-Za-z0-9/_.-])/g;

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

export const DROPPED = '[secret dropped]';

export function redact(text: string): string {
  if (!text) return text;
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, DROPPED);
  out = out.replace(KEYED, (_m, key: string, sep: string, val: string) => {
    if (/^(?:the|a|an|is|was|for|and|to|of|in|on|with|from|that|this|it)$/i.test(val)) return _m;
    if (sep.trim() === '' && !/^bearer$|^authorization$/i.test(key) && !looksOpaque(val)) return _m;
    return `${key}${sep}${DROPPED}`;
  });
  out = out.replace(OPAQUE, (m) => (looksOpaque(m) ? DROPPED : m));
  return out;
}

export function hasSecret(text: string): boolean {
  return redact(text) !== text;
}
