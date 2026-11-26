import vendors from './vendors.json';

export const CIMD_URL = 'https://agent.example/oauth/client.json';
export const CLAUDE_CODE_URL = 'https://claude.ai/oauth/claude-code-client-metadata';

async function s256(v: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  let s = '';
  for (const b of d) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' } });
}

export function outbound(o: { clientId: string; clientSecret: string }) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.href === CIMD_URL) {
      return json({ client_id: CIMD_URL, client_name: 'Example Agent', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    }
    if (url.host === 'github.com' && url.pathname === '/login/oauth/access_token' && request.method === 'POST') {
      const form = new URLSearchParams(await request.text());
      if (request.headers.get('accept') !== 'application/json' || !request.headers.get('user-agent')) return json({ error: 'bad_request' });
      if (form.get('client_id') !== o.clientId || form.get('client_secret') !== o.clientSecret) return json({ error: 'incorrect_client_credentials' });
      const parts = (form.get('code') ?? '').split('.');
      if (parts[0] !== 'ok' || parts.length !== 4) return json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
      const verifier = form.get('code_verifier') ?? '';
      if (!verifier || (await s256(verifier)) !== parts[3]) return json({ error: 'bad_verification_code', error_description: 'PKCE failed.' });
      return json({ access_token: `gho_fake_${parts[1]}_${parts[2]}`, token_type: 'bearer', scope: '' });
    }
    if (url.host === 'api.github.com' && url.pathname === '/user') {
      if (!request.headers.get('user-agent')) return json({ message: 'Request forbidden by administrative rules.' }, 403);
      const m = /^Bearer gho_fake_(\d+)_([A-Za-z0-9-]+)$/.exec(request.headers.get('authorization') ?? '');
      if (!m) return json({ message: 'Bad credentials' }, 401);
      return json({ id: Number(m[1]), login: m[2] });
    }
    return new Response('not found', { status: 404 });
  };
}

export const SIGNER = 'https://assertion.invalid/sign';

export interface VendorDoc { key: string; text: string; doc: Record<string, unknown> }

export function vendorDocs(): Map<string, VendorDoc> {
  const out = new Map<string, VendorDoc>();
  for (const [key, text] of Object.entries(vendors as Record<string, string>)) {
    const doc = JSON.parse(text) as Record<string, unknown>;
    if (typeof doc.client_id === 'string') out.set(doc.client_id, { key, text, doc });
  }
  return out;
}

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let s = '';
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function vendorOutbound() {
  const docs = vendorDocs();
  const kid = crypto.randomUUID();
  const keys = crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
  const jwksUris = new Set([...docs.values()].map((d) => d.doc.jwks_uri).filter((u): u is string => typeof u === 'string'));
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    const hit = docs.get(url.href);
    if (hit) return new Response(hit.text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' } });
    if (jwksUris.has(url.href)) {
      const jwk = (await crypto.subtle.exportKey('jwk', (await keys).publicKey)) as JsonWebKey;
      return Response.json({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] });
    }
    if (url.href === SIGNER && request.method === 'POST') {
      const claims = (await request.json()) as { client_id: string; aud: string };
      const now = Math.floor(Date.now() / 1000);
      const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
      const body = b64url(JSON.stringify({ iss: claims.client_id, sub: claims.client_id, aud: claims.aud, jti: crypto.randomUUID(), iat: now, exp: now + 120 }));
      const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', (await keys).privateKey, new TextEncoder().encode(`${head}.${body}`)));
      return Response.json({ assertion: `${head}.${body}.${b64url(signature)}` });
    }
    return null;
  };
}
