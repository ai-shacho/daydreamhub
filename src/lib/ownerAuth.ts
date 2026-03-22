async function verifyJWT(token: string, secret: string): Promise<Record<string, any> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigInput = `${parts[0]}.${parts[1]}`;
    const sigBytes = Uint8Array.from(
      atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(sigInput));
    if (!valid) return null;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

export async function verifyOwner(request: Request, jwtSecret: string) {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)ddh_token=([^;]+)/);
  if (!match) return null;

  const token = match[1];
  const secret = (jwtSecret && jwtSecret !== 'dev-secret') ? jwtSecret : 'ddh-secret-2025';
  return await verifyJWT(token, secret);
}

export async function getOwnerHotelIds(db: any, owner: any) {
  if (owner.role === "staff") {
    const res = await db.prepare(
      "SELECT hotel_id as id FROM hotel_staff WHERE user_id = ?"
    ).bind(owner.sub).all();
    return (res?.results || []).map((h: any) => h.id);
  }
  const res = await db.prepare(
    "SELECT id FROM hotels WHERE email = ? AND is_active = 1"
  ).bind(owner.email).all();
  return (res?.results || []).map((h: any) => h.id);
}
