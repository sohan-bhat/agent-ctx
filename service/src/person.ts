import { DurableObject } from 'cloudflare:workers';
import { buildExport } from './api.ts';
import { Engine, type Caller, type CheckpointArgs, type EventArgs, type HandoffArgs, type ItemView, type Me, type RecallArgs, type Result, type RuleArgs, type Space } from './engine.ts';
import { MAX, type Limits } from './limits.ts';
import type { Store } from './store.ts';

export * from './engine.ts';

export class Person extends DurableObject<Env> {
  store: Store;
  limits: Limits;
  instance = crypto.randomUUID();
  private engine: Engine;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const storage = ctx.storage;
    this.engine = new Engine(
      { exec: (query, ...args) => storage.sql.exec(query, ...args), transactionSync: (fn) => storage.transactionSync(fn), sync: () => storage.sync(), deleteAll: () => storage.deleteAll() },
      () => Date.now(),
      MAX,
      {
        send: (text) => {
          for (const ws of ctx.getWebSockets()) {
            try {
              ws.send(text);
            } catch {
              continue;
            }
          }
        },
        close: () => {
          for (const ws of ctx.getWebSockets()) {
            try {
              ws.close(1000, 'reset');
            } catch {
              continue;
            }
          }
        },
        address: () => {
          try {
            return `${new URL(env.MCP_RESOURCE).origin}/`;
          } catch {
            return null;
          }
        },
      },
    );
    this.store = this.engine.store;
    this.limits = this.engine.limits;
    ctx.blockConcurrencyWhile(async () => this.engine.boot());
  }

  get lastRows(): { read: number; written: number } {
    return this.engine.lastRows;
  }

  get bootRows(): { read: number; written: number } {
    return this.engine.bootRows;
  }

  async recall(c: Caller, a: RecallArgs, tool = false): Promise<Result> {
    return this.engine.recall(c, a, tool);
  }

  async checkpoint(c: Caller, a: CheckpointArgs): Promise<Result> {
    return this.engine.checkpoint(c, a);
  }

  async handoff(c: Caller, a: HandoffArgs): Promise<Result> {
    return this.engine.handoff(c, a);
  }

  async ruleDraft(c: Caller, a: RuleArgs): Promise<Result & { line?: string; held?: boolean }> {
    return this.engine.ruleDraft(c, a);
  }

  async rule(c: Caller, a: RuleArgs, seen?: string): Promise<Result> {
    return this.engine.rule(c, a, seen);
  }

  async event(c: Caller, a: EventArgs): Promise<Result> {
    return this.engine.event(c, a);
  }

  async me(): Promise<Me> {
    return this.engine.me();
  }

  async space(): Promise<Space> {
    return this.engine.space();
  }

  async pin(id: string, on: boolean): Promise<ItemView | null> {
    return this.engine.pin(id, on);
  }

  async keep(id: string): Promise<ItemView | null> {
    return this.engine.keep(id);
  }

  async putBack(id: string): Promise<ItemView | null> {
    return this.engine.putBack(id);
  }

  async remove(id: string): Promise<boolean> {
    return this.engine.remove(id);
  }

  async addRule(a: { text: string; scope: 'project' | 'all'; project?: string }): Promise<Result> {
    return this.engine.addRule(a);
  }

  async setRule(id: string, status: 'active' | 'off', line?: string): Promise<ItemView | 'changed' | null> {
    return this.engine.setRule(id, status, line);
  }

  async mergeProjects(from: string, into: string): Promise<boolean> {
    return this.engine.mergeProjects(from, into);
  }

  async exportAll(): Promise<Uint8Array> {
    return buildExport(this.engine.exported());
  }

  async generation(): Promise<number> {
    return this.engine.generation();
  }

  async removeAgent(label: string): Promise<boolean> {
    return this.engine.removeAgent(label);
  }

  async wipe(): Promise<void> {
    return this.engine.wipe();
  }

  async rowCount(): Promise<number> {
    return this.engine.rowCount();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response(null, { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send('pong');
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    if (code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code)) ws.close(code, reason);
    else ws.close();
  }
}
