import type { APIRoute } from 'astro';
import { verifyOwner, getOwnerHotelIds } from '../../../lib/ownerAuth';

export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const url = new URL(request.url);
  const hotelId = url.searchParams.get('hotel_id');
  const month = url.searchParams.get('month'); // YYYY-MM
  const ownerHotelIds = await getOwnerHotelIds(db, owner);

  if (!hotelId || !ownerHotelIds.includes(Number(hotelId))) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let query = 'SELECT * FROM blocked_dates WHERE hotel_id = ?';
  const binds: any[] = [Number(hotelId)];
  if (month) { query += ' AND blocked_date LIKE ?'; binds.push(`${month}%`); }
  query += ' ORDER BY blocked_date';

  const result = await db?.prepare(query).bind(...binds).all();
  return new Response(JSON.stringify({ blocked: result?.results || [] }), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const body = await request.json() as any;
  const { hotel_id, plan_id, date, reason } = body;
  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!hotel_id || !ownerHotelIds.includes(Number(hotel_id))) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  await db?.prepare('INSERT OR REPLACE INTO blocked_dates (hotel_id, plan_id, blocked_date, reason) VALUES (?, ?, ?, ?)')
    .bind(Number(hotel_id), plan_id ? Number(plan_id) : null, date, reason || null).run();

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const body = await request.json() as any;
  const { hotel_id, date } = body;
  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!hotel_id || !ownerHotelIds.includes(Number(hotel_id))) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  await db?.prepare('DELETE FROM blocked_dates WHERE hotel_id = ? AND blocked_date = ?').bind(Number(hotel_id), date).run();
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
};
