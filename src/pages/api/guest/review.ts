import type { APIRoute } from 'astro';

async function verifyJWT(token: string, secret: string): Promise<Record<string, any> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(`${header}.${body}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'ddh-secret-2025';
  const cookieHeader = request.headers.get('cookie') || '';
  const tokenMatch = cookieHeader.match(/ddh_token=([^;]+)/);
  const auth = tokenMatch ? await verifyJWT(tokenMatch[1], jwtSecret) : null;
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { booking_id, rating, content } = body;
  if (!booking_id || !rating) return new Response(JSON.stringify({ error: 'booking_id and rating required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (rating < 1 || rating > 5) return new Response(JSON.stringify({ error: 'Rating must be 1-5' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const booking = await db?.prepare('SELECT * FROM bookings WHERE id = ? AND guest_email = ?').bind(Number(booking_id), auth.email).first() as any;
  if (!booking) return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  if (!['confirmed', 'completed'].includes(booking.status)) return new Response(JSON.stringify({ error: 'Can only review confirmed or completed bookings' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const existing = await db?.prepare('SELECT id FROM reviews WHERE booking_id = ?').bind(Number(booking_id)).first();
  if (existing) return new Response(JSON.stringify({ error: 'You already reviewed this booking' }), { status: 409, headers: { 'Content-Type': 'application/json' } });

  await db?.prepare("INSERT INTO reviews (hotel_id, booking_id, rating, content, guest_name, guest_email, is_approved) VALUES (?, ?, ?, ?, ?, ?, 1)")
    .bind(booking.hotel_id, Number(booking_id), Number(rating), content || '', auth.name || '', auth.email)
    .run();

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
};
