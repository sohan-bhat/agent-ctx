import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VENDOR_DIR = fileURLToPath(new URL('./test/fixtures/vendors/', import.meta.url));
export const SIGNER = 'https://assertion.invalid/sign';

export interface VendorDoc { file: string; text: string; doc: Record<string, unknown> }

export function vendorDocs(dir = VENDOR_DIR): Map<string, VendorDoc> {
  const out = new Map<string, VendorDoc>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const text = readFileSync(join(dir, file), 'utf8');
    const doc = JSON.parse(text) as Record<string, unknown>;
    if (typeof doc.client_id === 'string') out.set(doc.client_id, { file, text, doc });
  }
  return out;
}

function b64url(b: Buffer | string): string {
  return Buffer.from(b).toString('base64url');
}

export function vendorOutbound(dir = VENDOR_DIR) {
  const docs = vendorDocs(dir);
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  const jwksUris = new Set([...docs.values()].map((d) => d.doc.jwks_uri).filter((u): u is string => typeof u === 'string'));
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    const hit = docs.get(url.href);
    if (hit) return new Response(hit.text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' } });
    if (jwksUris.has(url.href)) return Response.json({ keys: [jwk] });
    if (url.href === SIGNER && request.method === 'POST') {
      const claims = (await request.json()) as { client_id: string; aud: string };
      const now = Math.floor(Date.now() / 1000);
      const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
      const body = b64url(JSON.stringify({ iss: claims.client_id, sub: claims.client_id, aud: claims.aud, jti: randomUUID(), iat: now, exp: now + 120 }));
      const signature = b64url(sign('sha256', Buffer.from(`${head}.${body}`), privateKey));
      return Response.json({ assertion: `${head}.${body}.${signature}` });
    }
    return null;
  };
}
