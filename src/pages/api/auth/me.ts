import type { APIRoute } from 'astro';

async function verifyJWT(token: string, secret: string): Promise<Record<string, any> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sigBytes = Uint8Array.from(
      atob(signature.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  try {
    const cookieHeader = request.headers.get('cookie') || '';
    const tokenMatch = cookieHeader.match(/ddh_token=([^;]+)/);
    if (!tokenMatch) {
      return new Response(JSON.stringify({ user: null }), { status: 200, headers: json });
    }
    const env = (locals as any).runtime?.env;
    const secret = env?.JWT_SECRET || 'ddh-secret-2025';
    const payload = await verifyJWT(tokenMatch[1], secret);
    if (!payload) {
      return new Response(JSON.stringify({ user: null }), { status: 200, headers: json });
    }
    return new Response(
      JSON.stringify({ user: { id: payload.sub, email: payload.email, name: payload.name, role: payload.role } }),
      { status: 200, headers: json }
    );
  } catch {
    return new Response(JSON.stringify({ user: null }), { status: 200, headers: json });
  }
};
