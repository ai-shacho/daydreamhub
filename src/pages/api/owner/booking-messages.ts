import type { APIRoute } from 'astro';
import { verifyOwner, getOwnerHotelIds } from '../../../lib/ownerAuth';

export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const url = new URL(request.url);
  const bookingId = url.searchParams.get('booking_id');
  if (!bookingId) return new Response(JSON.stringify({ error: 'booking_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  const booking = await db?.prepare('SELECT hotel_id FROM bookings WHERE id = ?').bind(Number(bookingId)).first() as any;
  if (!booking || !ownerHotelIds.includes(booking.hotel_id)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  const msgs = await db?.prepare('SELECT * FROM booking_messages WHERE booking_id = ? ORDER BY created_at ASC').bind(Number(bookingId)).all();
  await db?.prepare("UPDATE booking_messages SET is_read = 1 WHERE booking_id = ? AND sender_type = 'guest'").bind(Number(bookingId)).run();

  return new Response(JSON.stringify({ messages: msgs?.results || [] }), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const RESEND_API_KEY = runtime?.env?.RESEND_API_KEY || '';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const body = await request.json() as any;
  const { booking_id, content } = body;
  if (!booking_id || !content?.trim()) return new Response(JSON.stringify({ error: 'booking_id and content required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  const booking = await db?.prepare(`
    SELECT b.*, h.name as hotel_name FROM bookings b
    LEFT JOIN hotels h ON h.id = b.hotel_id
    WHERE b.id = ?
  `).bind(Number(booking_id)).first() as any;
  if (!booking || !ownerHotelIds.includes(booking.hotel_id)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  await db?.prepare("INSERT INTO booking_messages (booking_id, sender_type, sender_name, content) VALUES (?, 'hotel', ?, ?)")
    .bind(Number(booking_id), booking.hotel_name || 'Hotel', content.trim()).run();

  // Notify guest by email
  if (RESEND_API_KEY && booking.guest_email) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'DaydreamHub <noreply@daydreamhub.com>',
          to: [booking.guest_email],
          subject: `💬 Reply from ${booking.hotel_name} — Booking #${booking_id}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px"><h3>Message from ${booking.hotel_name}</h3><p>Regarding your booking #${booking_id}</p><blockquote style="border-left:3px solid #46a3c2;padding:8px 16px;color:#374151">${content.trim()}</blockquote><a href="${runtime?.env?.SITE_URL || 'https://daydreamhub.com'}/mypage" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#46a3c2;color:white;text-decoration:none;border-radius:6px">View & Reply in My Bookings</a></div>`,
        }),
      });
    } catch {}
  }

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
};
