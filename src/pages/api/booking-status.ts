import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB as D1Database | undefined;

  if (!db) {
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const orderId = url.searchParams.get('order') || '';
  if (!orderId) {
    return new Response(JSON.stringify({ error: 'order parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const bookingIdNum = parseInt(orderId, 10);
  const isNumeric = !isNaN(bookingIdNum) && String(bookingIdNum) === orderId;

  let booking: any;
  if (isNumeric) {
    booking = await db
      .prepare(
        `SELECT b.id, b.status, b.alt_status, b.check_in_date, b.total_price_usd,
                b.guest_name, b.guest_email,
                h.name as hotel_name, h.name_ja as hotel_name_ja,
                p.name as plan_name, p.name_ja as plan_name_ja
         FROM bookings b
         LEFT JOIN hotels h ON h.id = b.hotel_id
         LEFT JOIN plans p ON p.id = b.plan_id
         WHERE b.id = ?`
      )
      .bind(bookingIdNum)
      .first();
  } else {
    // Look up by paypal_order_id
    booking = await db
      .prepare(
        `SELECT b.id, b.status, b.alt_status, b.check_in_date, b.total_price_usd,
                b.guest_name, b.guest_email,
                h.name as hotel_name, h.name_ja as hotel_name_ja,
                p.name as plan_name, p.name_ja as plan_name_ja
         FROM bookings b
         LEFT JOIN hotels h ON h.id = b.hotel_id
         LEFT JOIN plans p ON p.id = b.plan_id
         WHERE b.paypal_order_id = ?`
      )
      .bind(orderId)
      .first();
  }

  if (!booking) {
    return new Response(JSON.stringify({ error: 'Booking not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // What the guest bought on top of the room, so the confirmation screen can
  // account for the whole amount rather than just the plan price.
  const options: any[] = ((await db.prepare(
    `SELECT name, pricing_type, quantity, child_quantity, infant_quantity, currency, amount_local, amount_usd
       FROM booking_options WHERE booking_id = ? ORDER BY id`
  ).bind(booking.id).all().catch(() => null))?.results) || [];

  return new Response(
    JSON.stringify({
      id: booking.id,
      status: booking.status,
      alt_status: booking.alt_status,
      // The Japanese confirmation page showed the English plan name while the
      // booking form a click earlier showed the Japanese one — the same plan
      // changing language between two steps of one flow. Both are returned and
      // the page picks; falling back to English when no translation exists.
      hotel_name: booking.hotel_name,
      hotel_name_ja: booking.hotel_name_ja,
      plan_name: booking.plan_name,
      plan_name_ja: booking.plan_name_ja,
      check_in_date: booking.check_in_date,
      total_price_usd: booking.total_price_usd,
      guest_name: booking.guest_name,
      guest_email: booking.guest_email,
      options,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
