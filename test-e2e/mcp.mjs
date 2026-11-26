import { RESOURCE } from './oauth.mjs';

let id = 0;

async function rpc(token, session, body) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' };
  if (session) headers['Mcp-Session-Id'] = session;
  const r = await fetch(RESOURCE, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  const data = text.startsWith('{') ? text : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop() ?? '';
  return { status: r.status, session: r.headers.get('Mcp-Session-Id') ?? session, json: data ? JSON.parse(data) : null };
}

export async function open(token) {
  const init = await rpc(token, null, { jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e-probe', version: '1.0.0' } } });
  if (init.status !== 200) throw new Error(`initialize gave ${init.status}`);
  await rpc(token, init.session, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    async call(name, args) {
      const r = await rpc(token, init.session, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
      const res = r.json?.result ?? {};
      return { text: (res.content ?? []).map((c) => c.text ?? '').join(''), isError: !!res.isError, error: r.json?.error };
    },
    async list() {
      const r = await rpc(token, init.session, { jsonrpc: '2.0', id: ++id, method: 'tools/list', params: {} });
      return r.json?.result?.tools ?? [];
    },
  };
}
