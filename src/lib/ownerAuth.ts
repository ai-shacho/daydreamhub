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

// Get the highest staff_role for a staff user across all their hotel assignments
// Returns 'co_owner' | 'booking_manager' | null
export async function getStaffRole(db: any, userId: number): Promise<string | null> {
  const res = await db.prepare(
    "SELECT staff_role FROM hotel_staff WHERE user_id = ? ORDER BY CASE staff_role WHEN 'co_owner' THEN 0 ELSE 1 END LIMIT 1"
  ).bind(userId).first();
  return res?.staff_role || null;
}

// Check if a staff user can manage staff (only owner or co_owner)
export function canManageStaff(owner: any, staffRole: string | null): boolean {
  if (owner.role === 'owner' || owner.role === 'admin') return true;
  if (owner.role === 'staff' && staffRole === 'co_owner') return true;
  return false;
}

// Check if a staff user can edit hotels (only owner or co_owner)
export function canEditHotels(owner: any, staffRole: string | null): boolean {
  if (owner.role === 'owner' || owner.role === 'admin') return true;
  if (owner.role === 'staff' && staffRole === 'co_owner') return true;
  return false;
}

// Check if a staff user can access reports (only owner or co_owner)
export function canAccessReports(owner: any, staffRole: string | null): boolean {
  if (owner.role === 'owner' || owner.role === 'admin') return true;
  if (owner.role === 'staff' && staffRole === 'co_owner') return true;
  return false;
}
