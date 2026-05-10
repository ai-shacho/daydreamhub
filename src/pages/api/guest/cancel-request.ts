import type { APIRoute } from 'astro';
import { sendGuestBookingStatusUpdate } from '../../../lib/email';

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

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'ddh-secret-2025';
  const RESEND_API_KEY = runtime?.env?.RESEND_API_KEY || '';
  const ADMIN_EMAIL = runtime?.env?.ADMIN_EMAIL || 'info@daydreamhub.com';

  // Auth
  const cookieHeader = request.headers.get('cookie') || '';
  const tokenMatch = cookieHeader.match(/ddh_token=([^;]+)/);
  const authPayload = tokenMatch ? await verifyJWT(tokenMatch[1], jwtSecret) : null;
  if (!authPayload) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { booking_id, reason } = body;
  if (!booking_id) {
    return new Response(JSON.stringify({ error: 'booking_id required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify this booking belongs to the logged-in user
  const booking = await db?.prepare(`
    SELECT b.*, h.name as hotel_name, h.city, h.country, p.name as plan_name, p.check_in_time, p.check_out_time
    FROM bookings b
    LEFT JOIN hotels h ON h.id = b.hotel_id
    LEFT JOIN plans p ON p.id = b.plan_id
    WHERE b.id = ? AND b.guest_email = ?
  `).bind(Number(booking_id), authPayload.email).first() as any;

  if (!booking) {
    return new Response(JSON.stringify({ error: 'Booking not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (['cancelled', 'completed', 'failed'].includes(booking.status)) {
    return new Response(JSON.stringify({ error: 'This booking cannot be cancelled' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update status to cancelled
  await db?.prepare("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
    .bind(Number(booking_id))
    .run();

  // Notify guest (cancellation confirmed)
  if (RESEND_API_KEY && booking.guest_email) {
    try {
      await sendGuestBookingStatusUpdate(RESEND_API_KEY, {
        bookingId: booking.id,
        guestName: booking.guest_name || '',
        guestEmail: booking.guest_email,
        hotelName: booking.hotel_name || '',
        hotelCity: booking.city || '',
        hotelCountry: booking.country || '',
        planName: booking.plan_name || '',
        checkInDate: booking.check_in_date || '',
        checkInTime: booking.check_in_time || '',
        checkOutTime: booking.check_out_time || '',
        adults: booking.adults || 1,
        children: booking.children || 0,
        totalPriceUsd: booking.total_price_usd || 0,
        status: 'cancelled',
        cancelReason: reason || 'Cancelled by guest',
      });
    } catch (e) {
      console.error('Failed to send cancellation email:', e);
    }
  }

  // Notify hotel/owner
  if (RESEND_API_KEY) {
    try {
      const hotelEmail = await db?.prepare('SELECT email FROM hotels WHERE id = ?').bind(booking.hotel_id).first() as any;
      if (hotelEmail?.email) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'DaydreamHub <noreply@daydreamhub.com>',
            to: [hotelEmail.email],
            subject: `[Booking Cancelled] #${booking.id} — ${booking.guest_name}`,
            html: `<div style="font-family:Arial,sans-serif"><h3>Booking Cancelled by Guest</h3><p>Booking <strong>#${booking.id}</strong> has been cancelled.</p><table style="font-size:14px"><tr><td style="padding:4px 12px 4px 0;color:#888">Guest:</td><td>${booking.guest_name} (${booking.guest_email})</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Date:</td><td>${booking.check_in_date}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Plan:</td><td>${booking.plan_name || ''}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Reason:</td><td>${reason || 'Not specified'}</td></tr></table></div>`,
          }),
        });
      }
    } catch {}
  }

  // Notify admin
  if (RESEND_API_KEY && ADMIN_EMAIL) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'DaydreamHub <noreply@daydreamhub.com>',
          to: [ADMIN_EMAIL],
          subject: `[Cancel Request] Booking #${booking.id} — ${booking.guest_name}`,
          html: `<p>Booking #${booking.id} cancelled by guest (${booking.guest_email}).<br>Reason: ${reason || 'Not specified'}<br>Hotel: ${booking.hotel_name}<br>Date: ${booking.check_in_date}</p>`,
        }),
      });
    } catch {}
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
