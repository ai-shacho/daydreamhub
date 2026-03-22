import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;

  if (!db) {
    return new Response(JSON.stringify({ error: 'DB not available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ボットチェック（honeypot）
  if (body.website) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { plan_id, guest_name, guest_email, guest_phone, check_in_date, adults, children, notes } = body;

  if (!plan_id || !guest_name || !guest_email || !check_in_date) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Get plan + hotel info
    const plan: any = await db.prepare(`
      SELECT p.*, h.id as hotel_id, h.name as hotel_name, h.phone as hotel_phone
      FROM plans p JOIN hotels h ON h.id = p.hotel_id
      WHERE p.id = ?1
    `).bind(plan_id).first();

    if (!plan) {
      return new Response(JSON.stringify({ error: 'Plan not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create booking (pay at hotel / bypassed payment)
    await db.prepare(`
      INSERT INTO bookings (
        plan_id, hotel_id, guest_name, guest_email, guest_phone,
        check_in_date, adults, children, total_price_usd,
        status, paypal_order_id, notes, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'confirmed', 'PAY_AT_HOTEL', ?10, datetime('now'))
    `).bind(
      plan_id,
      plan.hotel_id,
      guest_name,
      guest_email,
      guest_phone || '',
      check_in_date,
      adults || 1,
      children || 0,
      plan.price_usd,
      notes || ''
    ).run();

    // Get the new booking ID
    const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
    const bookingId = row?.id;

    return new Response(JSON.stringify({
      success: true,
      booking_id: bookingId,
      hotel_name: plan.hotel_name,
      plan_name: plan.name,
      total: plan.price_usd,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('Direct booking error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Booking failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
