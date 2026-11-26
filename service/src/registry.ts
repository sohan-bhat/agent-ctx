import { DurableObject } from 'cloudflare:workers';

export class Registry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS days(day TEXT PRIMARY KEY, n INTEGER) WITHOUT ROWID');
    });
  }

  async admit(day: string, max: number): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    const n = (sql.exec<{ n: number }>('SELECT n FROM days WHERE day = ?', day).toArray()[0]?.n ?? 0) as number;
    if (n >= max) return false;
    sql.exec('INSERT INTO days(day, n) VALUES(?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1', day);
    if (n === 0) sql.exec('DELETE FROM days WHERE day < ?', day);
    return true;
  }

  async count(day: string): Promise<number> {
    return (this.ctx.storage.sql.exec<{ n: number }>('SELECT n FROM days WHERE day = ?', day).toArray()[0]?.n ?? 0) as number;
  }
}
