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

// Whether a plan is bookable at all. The booking routes check this before
// rendering: a status set from inside a component lands too late to reach the
// response, so the 404 has to be decided at the page level.
export async function planExists(db: any, planId: string | number): Promise<boolean> {
  if (!db) return true;   // no DB binding (local dev) — the page falls back to sample plans
  try {
    const row = await db.prepare('SELECT 1 AS ok FROM plans WHERE id = ?').bind(planId).first();
    return !!row;
  } catch {
    return true;          // a query failure is not a missing plan; let the page render its own error
  }
}

// Whether a hotel should be reachable by URL at all. Demo listings stay
// visible on purpose; inactive ones must 404. Decided by the route because a
// status set from inside a component lands after the response is settled.
export async function hotelIsVisible(db: any, slug: string): Promise<boolean> {
  if (!db) return true;   // no DB binding (local dev) — the page falls back to sample hotels
  try {
    const row: any = await db.prepare('SELECT status, is_active FROM hotels WHERE slug = ?').bind(slug).first();
    if (!row) return false;
    return !(row.status === 'inactive' || (!row.status && !row.is_active));
  } catch {
    return true;
  }
}
