import { APIRoute } from 'astro';
import { verifyOwner } from '../../../../lib/ownerAuth';

export const del: APIRoute = async ({ params, request, locals }) => {
  const hotelId = params.id;
  const runtime = locals.runtime as any;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || "dev-secret";

  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) {
<<<<<<< HEAD
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
=======
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
  const hotelId = parseInt(params.id || '0');
  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(hotelId)) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const hotel = await db.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
  const plansRes = await db
    .prepare('SELECT * FROM plans WHERE hotel_id = ? ORDER BY name')
    .bind(hotelId)
    .all();
  return new Response(JSON.stringify({ hotel, plans: plansRes?.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
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
  const hotelId = parseInt(params.id || '0');
  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(hotelId)) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete related data first, then the hotel itself
  try {
    await db.prepare('DELETE FROM plans WHERE hotel_id = ?').bind(hotelId).run();
    await db.prepare('DELETE FROM bookings WHERE hotel_id = ?').bind(hotelId).run();
    await db.prepare('DELETE FROM hotel_edit_requests WHERE hotel_id = ?').bind(hotelId).run();
    await db.prepare('DELETE FROM hotels WHERE id = ?').bind(hotelId).run();

    return new Response(JSON.stringify({ success: true }), {
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

export const PUT: APIRoute = async ({ params, request, locals }) => {
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
  const hotelId = parseInt(params.id || '0');
  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(hotelId)) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const body: any = await request.json();
  const { field_changes } = body;
  if (!field_changes || Object.keys(field_changes).length === 0) {
    return new Response(JSON.stringify({ error: 'No changes provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
>>>>>>> fed5969 (Fix test environment: Jest setup for TypeScript and segregate Playwright tests)
  }

  if (db) {
    try {
      await db.transaction(async (trx) => {
        await trx.prepare('DELETE FROM reviews WHERE hotel_id = ?').bind(hotelId).run();
        await trx.prepare('DELETE FROM bookings WHERE hotel_id = ?').bind(hotelId).run();
        await trx.prepare('DELETE FROM hotel_images WHERE hotel_id = ?').bind(hotelId).run();
        await trx.prepare('DELETE FROM hotels WHERE id = ? AND email = ?').bind(hotelId, owner.email).run();
      });
      return new Response(null, { status: 204 });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Failed to delete hotel' }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500 });
};
