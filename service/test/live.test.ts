import { describe, expect, it } from 'vitest';
import type { Item } from '../../core/src/index.ts';
import { call, connect, devSignIn, mcp, send } from './helpers.ts';

describe('live updates', () => {
  it('a page socket receives the item message for a checkpoint within one second', async () => {
    const jar = await devSignIn('live-one');
    const a = await mcp((await connect(jar, 'dcr', ['read', 'write'], 'Codex')).access);
    const r = await send('/api/live', { headers: { Cookie: jar.header(), Upgrade: 'websocket' } });
    expect(r.status).toBe(101);
    const ws = r.webSocket!;
    ws.accept();
    const got = new Promise<{ type: string; item: Item }>((resolve) =>
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data as string);
        if (m.type === 'item') resolve(m);
      }),
    );
    const started = Date.now();
    await call(a, 'checkpoint', { folder: '/w/kiln', goal: 'Live block on the page' });
    const msg = await Promise.race([got, new Promise<null>((res) => setTimeout(() => res(null), 1000))]);
    expect(msg).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect((msg!.item.body as { goal: string }).goal).toBe('Live block on the page');
    ws.close();
  });

  it('the socket needs a session and an upgrade', async () => {
    expect((await send('/api/live', { headers: { Upgrade: 'websocket' } })).status).toBe(401);
    const jar = await devSignIn('live-two');
    expect((await send('/api/live', { headers: { Cookie: jar.header() } })).status).toBe(426);
  });
});
