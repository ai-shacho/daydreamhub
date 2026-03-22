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

// GET: booking messages
export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'ddh-secret-2025';
  const cookieHeader = request.headers.get('cookie') || '';
  const tokenMatch = cookieHeader.match(/ddh_token=([^;]+)/);
  const auth = tokenMatch ? await verifyJWT(tokenMatch[1], jwtSecret) : null;
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const url = new URL(request.url);
  const bookingId = url.searchParams.get('booking_id');
  if (!bookingId) return new Response(JSON.stringify({ error: 'booking_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const booking = await db?.prepare('SELECT id FROM bookings WHERE id = ? AND guest_email = ?').bind(Number(bookingId), auth.email).first();
  if (!booking) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const msgs = await db?.prepare('SELECT * FROM booking_messages WHERE booking_id = ? ORDER BY created_at ASC').bind(Number(bookingId)).all();
  // Mark hotel messages as read
  await db?.prepare("UPDATE booking_messages SET is_read = 1 WHERE booking_id = ? AND sender_type = 'hotel'").bind(Number(bookingId)).run();

  return new Response(JSON.stringify({ messages: msgs?.results || [] }), { headers: { 'Content-Type': 'application/json' } });
};

// POST: guest sends message
export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'ddh-secret-2025';
  const RESEND_API_KEY = runtime?.env?.RESEND_API_KEY || '';
  const cookieHeader = request.headers.get('cookie') || '';
  const tokenMatch = cookieHeader.match(/ddh_token=([^;]+)/);
  const auth = tokenMatch ? await verifyJWT(tokenMatch[1], jwtSecret) : null;
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const body = await request.json() as any;
  const { booking_id, content } = body;
  if (!booking_id || !content?.trim()) return new Response(JSON.stringify({ error: 'booking_id and content required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const booking = await db?.prepare(`
    SELECT b.*, h.name as hotel_name, h.email as hotel_email FROM bookings b
    LEFT JOIN hotels h ON h.id = b.hotel_id
    WHERE b.id = ? AND b.guest_email = ?
  `).bind(Number(booking_id), auth.email).first() as any;
  if (!booking) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  await db?.prepare("INSERT INTO booking_messages (booking_id, sender_type, sender_name, content) VALUES (?, 'guest', ?, ?)")
    .bind(Number(booking_id), auth.name || auth.email, content.trim()).run();

  // Notify hotel by email
  if (RESEND_API_KEY && booking.hotel_email) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'DaydreamHub <noreply@daydreamhub.com>',
          to: [booking.hotel_email],
          reply_to: auth.email,
          subject: `💬 New message from guest — Booking #${booking_id}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px"><h3>New message from guest for Booking #${booking_id}</h3><p><strong>From:</strong> ${auth.name || auth.email}</p><p><strong>Message:</strong></p><blockquote style="border-left:3px solid #0d9488;padding:8px 16px;color:#374151">${content.trim()}</blockquote><a href="https://daydreamhub.com/owner/bookings" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#0d9488;color:white;text-decoration:none;border-radius:6px">Reply in Owner Portal</a></div>`,
        }),
      });
    } catch {}
  }

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
};
