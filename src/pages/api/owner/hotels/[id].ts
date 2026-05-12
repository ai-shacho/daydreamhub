import { APIRoute } from 'astro';
import { verifyOwner } from '../../../../lib/ownerAuth';

export const GET: APIRoute = async ({ params, request, locals }) => {
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

export const DELETE: APIRoute = async ({ params, request, locals }) => {
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
  if (!parsedHotelId) {
    return new Response(JSON.stringify({ error: 'Invalid hotel ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership and delete
  try {
    const existing = await db.prepare('SELECT id FROM hotels WHERE id = ? AND email = ?').bind(parsedHotelId, owner.email).first();
    if (!existing) {
      return new Response(JSON.stringify({ error: 'Hotel not found or not owned by you' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Delete related data first
    await db.prepare('DELETE FROM plans WHERE hotel_id = ?').bind(parsedHotelId).run();
    await db.prepare('DELETE FROM bookings WHERE hotel_id = ?').bind(parsedHotelId).run();
    await db.prepare('DELETE FROM reviews WHERE hotel_id = ?').bind(parsedHotelId).run();
    // Delete the hotel itself
    await db.prepare('DELETE FROM hotels WHERE id = ?').bind(parsedHotelId).run();

    return new Response(JSON.stringify({ success: true, message: 'Hotel deleted successfully' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Failed to delete hotel', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
