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
  const directionFilter = url.searchParams.get('direction') || '';
  const statusFilter = url.searchParams.get('status') || '';
  const hotelFilter = url.searchParams.get('hotel_id') || '';

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (ownerHotelIds.length === 0) {
    return new Response(JSON.stringify({ messages: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const placeholders = ownerHotelIds.map(() => '?').join(',');
  let query = `SELECT m.*, h.name as hotel_name
    FROM messages m
    LEFT JOIN hotels h ON m.hotel_id = h.id
    WHERE m.hotel_id IN (${placeholders})`;
  const binds: any[] = [...ownerHotelIds];

  if (directionFilter) {
    query += ' AND m.direction = ?';
    binds.push(directionFilter);
  }
  if (statusFilter) {
    query += ' AND m.status = ?';
    binds.push(statusFilter);
  }
  if (hotelFilter) {
    const hid = parseInt(hotelFilter);
    if (ownerHotelIds.includes(hid)) {
      query += ' AND m.hotel_id = ?';
      binds.push(hid);
    }
  }

  query += ' ORDER BY m.created_at DESC';

  const result = await db.prepare(query).bind(...binds).all();
  const messages: any[] = result?.results || [];

  return new Response(JSON.stringify({ messages }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
