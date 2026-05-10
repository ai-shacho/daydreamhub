import type { APIRoute } from 'astro';
import { verifyOwner, getOwnerHotelIds } from '../../../lib/ownerAuth';

export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (ownerHotelIds.length === 0) {
    return new Response(JSON.stringify({ requests: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const placeholders = ownerHotelIds.map(() => '?').join(',');
  const result = await db
    .prepare(
      `
    SELECT er.*, h.name as hotel_name, u.name as requester_name
    FROM hotel_edit_requests er
    LEFT JOIN hotels h ON er.hotel_id = h.id
    LEFT JOIN users u ON er.requested_by = u.id
    WHERE er.hotel_id IN (${placeholders})
    ORDER BY er.created_at DESC
  `
    )
    .bind(...ownerHotelIds)
    .all();
  return new Response(JSON.stringify({ requests: result?.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
