import { tokens } from './text.ts';

const PHRASES: [RegExp, string][] = [
  [/\bsign[\s_-]*in\b/gi, 'signin'],
  [/\blog[\s_-]*in\b/gi, 'login'],
  [/\bsign[\s_-]*up\b/gi, 'signup'],
  [/\b(?:log|sign)[\s_-]*out\b/gi, 'logout'],
  [/\bend[\s_-]+to[\s_-]+end\b/gi, 'e2e'],
  [/\bpull[\s_-]+requests?\b/gi, 'pr'],
  [/\bmerge[\s_-]+requests?\b/gi, 'mr'],
  [/\bweb[\s_-]*sockets?\b/gi, 'websocket'],
  [/\bout[\s_-]+of[\s_-]+memory\b/gi, 'oom'],
  [/\btime[\s_-]*zones?\b/gi, 'timezone'],
  [/\brate[\s_-]+limit(?:s|ed|ing)?\b/gi, 'ratelimit'],
  [/\bapi[\s_-]+keys?\b/gi, 'apikey'],
  [/\benv(?:ironment)?[\s_-]+var(?:iable)?s?\b/gi, 'envvar'],
];

export const GROUPS: string[][] = [
  ['login', 'signin', 'logon', 'auth', 'authentication', 'authenticate'],
  ['signup', 'register', 'registration', 'onboarding'],
  ['logout', 'signout'],
  ['password', 'passphrase', 'passcode'],
  ['token', 'credential', 'credentials', 'apikey', 'secret'],
  ['permission', 'permissions', 'access', 'role', 'roles', 'authorization'],
  ['admin', 'administrator', 'moderator', 'superuser'],
  ['user', 'account', 'profile'],
  ['session', 'cookie'],
  ['picture', 'image', 'photo', 'img', 'thumbnail'],
  ['speed', 'fast', 'slow', 'performance', 'perf', 'latency', 'sluggish'],
  ['crash', 'exception', 'panic', 'segfault'],
  ['timeout', 'hang', 'hangs', 'freeze', 'frozen', 'unresponsive'],
  ['delete', 'erase', 'destroy', 'purge'],
  ['settings', 'config', 'configuration', 'preferences', 'prefs', 'options'],
  ['docs', 'documentation', 'readme', 'guide'],
  ['repo', 'repository', 'monorepo'],
  ['db', 'database', 'datastore'],
  ['deps', 'dependency', 'dependencies', 'package', 'packages', 'library', 'libraries'],
  ['deploy', 'deployment', 'release', 'ship', 'publish', 'rollout'],
  ['rollback', 'downgrade'],
  ['upgrade', 'bump'],
  ['phone', 'mobile', 'smartphone', 'iphone', 'android'],
  ['big', 'large', 'huge', 'bloated', 'oversized'],
  ['email', 'mail', 'mailer', 'smtp'],
  ['notification', 'notify', 'alert', 'warning', 'alarm'],
  ['cache', 'memoize', 'memoization', 'memo'],
  ['thread', 'worker', 'concurrency', 'parallel', 'parallelism'],
  ['memory', 'ram', 'heap', 'oom', 'leak'],
  ['cpu', 'processor'],
  ['storage', 'disk', 'blob'],
  ['backend', 'server'],
  ['endpoint', 'route', 'handler', 'api'],
  ['frontend', 'ui', 'client'],
  ['button', 'btn'],
  ['search', 'find'],
  ['upload', 'attach', 'attachment'],
  ['export', 'download'],
  ['ci', 'pipeline', 'workflow'],
  ['compile', 'compiler', 'bundle', 'bundler'],
  ['lint', 'linter', 'eslint'],
  ['format', 'formatter', 'prettier'],
  ['log', 'logging', 'trace', 'tracing'],
  ['metric', 'metrics', 'telemetry', 'analytics', 'monitoring'],
  ['backup', 'snapshot', 'dump'],
  ['migration', 'migrate', 'schema'],
  ['env', 'environment', 'envvar', 'dotenv'],
  ['container', 'docker', 'dockerfile'],
  ['websocket', 'socket', 'realtime'],
  ['refresh', 'reload'],
  ['queue', 'job', 'cron', 'scheduler'],
  ['timezone', 'tz', 'utc'],
  ['timestamp', 'datetime'],
  ['accessibility', 'a11y', 'screenreader'],
  ['i18n', 'translation', 'localization', 'l10n', 'translate'],
  ['offline', 'pwa', 'serviceworker'],
  ['payment', 'billing', 'checkout', 'invoice'],
  ['chart', 'graph', 'plot'],
  ['ratelimit', 'throttle', 'throttling'],
  ['pr', 'mr'],
  ['e2e', 'playwright', 'cypress'],
];

export function joinPhrases(text: string): string {
  let s = text ?? '';
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  return s;
}

const INDEX = new Map<string, string[]>();
for (const group of GROUPS) {
  const stems = [...new Set(group.flatMap((w) => tokens(joinPhrases(w))))];
  for (const s of stems) {
    const others = stems.filter((x) => x !== s);
    INDEX.set(s, [...new Set([...(INDEX.get(s) ?? []), ...others])]);
  }
}

export function synonymsOf(term: string): string[] {
  return INDEX.get(term) ?? [];
}

export function vocabulary(): string[] {
  return [...INDEX.keys()];
}
