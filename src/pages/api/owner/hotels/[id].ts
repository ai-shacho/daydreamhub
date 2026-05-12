import { APIRoute } from 'astro';
import { verifyOwner } from '../../../../lib/ownerAuth';

export const del: APIRoute = async ({ params, request, locals }) => {
  const hotelId = params.id;
  const runtime = locals.runtime as any;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || "dev-secret";

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

  const parsedHotelId = parseInt(hotelId || '0');
  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(parsedHotelId)) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const hotel = await db.prepare('SELECT * FROM hotels WHERE id = ?').bind(parsedHotelId).first();
    const plansRes = await db.prepare('SELECT * FROM plans WHERE hotel_id = ? ORDER BY name').bind(parsedHotelId).all();
    return new Response(JSON.stringify({ hotel, plans: plansRes?.results || [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Error querying hotel', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
