import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB as D1Database | undefined;

  if (!db) {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const idParam = params.id || '';
  const bookingIdNum = parseInt(idParam, 10);
  const isNumeric = !isNaN(bookingIdNum) && String(bookingIdNum) === idParam;

  let booking;
  if (isNumeric) {
    booking = await db
      .prepare(
        `SELECT b.id, b.status, b.alt_status, b.check_in_date,
                h.name as hotel_name, p.name as plan_name
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
        `SELECT b.id, b.status, b.alt_status, b.check_in_date,
                h.name as hotel_name, p.name as plan_name
         FROM bookings b
         LEFT JOIN hotels h ON h.id = b.hotel_id
         LEFT JOIN plans p ON p.id = b.plan_id
         WHERE b.paypal_order_id = ?`
      )
      .bind(idParam)
      .first();
  }

  if (!booking) {
    return new Response(JSON.stringify({ error: 'Booking not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    booking: {
      id: booking.id,
      status: booking.status,
      alt_status: booking.alt_status,
      hotel_name: booking.hotel_name,
      plan_name: booking.plan_name,
      check_in_date: booking.check_in_date,
    }
  }), { headers: { 'Content-Type': 'application/json' } });
};
