export const WORKER_LIMIT_MS = 30000;
export const MB = 1_000_000;
export const DEFAULT_BUDGET_MB = 50;
export const LOG_MAX = 256 * 1024;

export function budgetBytes(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.CLAUDE_CTX_BUDGET_MB);
  return Math.round((v > 0 ? v : DEFAULT_BUDGET_MB) * MB);
}

export function shares(budget: number = budgetBytes()): { log: number; cards: number; sessions: number } {
  return {
    log: Math.min(LOG_MAX, Math.floor(budget * 0.02)),
    cards: Math.floor(budget * 0.3),
    sessions: Math.floor(budget * 0.3),
  };
}
