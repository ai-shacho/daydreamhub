// The signed-in guest behind a request, shared by the English and Japanese
// booking routes so neither has to carry its own copy of the token check.

async function verifyJWT(token: string, secret: string): Promise<Record<string, any> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(
      atob(signature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(`${header}.${body}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export type GuestSession = { name: string; email: string; phone: string };

// Returns null when there is no valid session — the caller decides where to
// send them, since the login redirect differs per locale.
export async function getGuestSession(request: Request, env: any): Promise<GuestSession | null> {
  const jwtSecret = env?.JWT_SECRET || 'ddh-secret-2025';
  const cookieHeader = request.headers.get('cookie') || '';
  const tokenMatch = cookieHeader.match(/ddh_token=([^;]+)/);
  const payload = tokenMatch ? await verifyJWT(tokenMatch[1], jwtSecret) : null;
  if (!payload) return null;

  let phone = '';
  const db = env?.DB;
  if (db && payload.sub) {
    try {
      const userRow = await db.prepare('SELECT phone FROM users WHERE id = ?').bind(payload.sub).first();
      phone = (userRow as any)?.phone || '';
    } catch {}
  }
  return { name: payload.name || '', email: payload.email || '', phone };
}
