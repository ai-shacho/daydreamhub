import type { APIRoute } from 'astro';
import { verifyOwner, getOwnerHotelIds } from '../../../lib/ownerAuth';

export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner)
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!db)
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status') || '';
  const hotelFilter = url.searchParams.get('hotel_id') || '';

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (ownerHotelIds.length === 0)
    return new Response(JSON.stringify({ callLogs: [], hotels: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });

  const placeholders = ownerHotelIds.map(() => '?').join(',');
  let query = `SELECT cl.*, h.name as hotel_name, h.phone as hotel_phone,
                      b.guest_name, b.check_in_date, b.status as booking_status
               FROM call_logs cl
               LEFT JOIN hotels h ON h.id = cl.hotel_id
               LEFT JOIN bookings b ON b.id = cl.booking_id
               WHERE cl.hotel_id IN (${placeholders})`;
  const binds: any[] = [...ownerHotelIds];

  if (statusFilter) {
    query += ' AND cl.status = ?';
    binds.push(statusFilter);
  }
  if (hotelFilter) {
    query += ' AND cl.hotel_id = ?';
    binds.push(parseInt(hotelFilter));
  }
  query += ' ORDER BY cl.created_at DESC LIMIT 100';

  const result = await db.prepare(query).bind(...binds).all();
  const hotelsRes = await db
    .prepare(`SELECT id, name FROM hotels WHERE id IN (${placeholders})`)
    .bind(...ownerHotelIds)
    .all();

  return new Response(
    JSON.stringify({ callLogs: result?.results || [], hotels: hotelsRes?.results || [] }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner)
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!db)
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

  const { booking_id } = (await request.json()) as any;
  if (!booking_id)
    return new Response(JSON.stringify({ error: 'booking_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  const booking = await db
    .prepare('SELECT hotel_id FROM bookings WHERE id = ?')
    .bind(booking_id)
    .first();
  if (!booking || !ownerHotelIds.includes((booking as any).hotel_id)) {
    return new Response(JSON.stringify({ error: 'Booking not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const maxAttempt = await db
    .prepare('SELECT MAX(attempt_number) as max_attempt FROM call_logs WHERE booking_id = ?')
    .bind(booking_id)
    .first();
  const nextAttempt = ((maxAttempt as any)?.max_attempt || 0) + 1;
  await db
    .prepare(
      'INSERT INTO call_logs (booking_id, hotel_id, status, attempt_number) VALUES (?, ?, ?, ?)'
    )
    .bind(booking_id, (booking as any).hotel_id, 'queued', nextAttempt)
    .run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
