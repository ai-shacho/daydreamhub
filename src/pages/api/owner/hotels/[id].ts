import type { APIRoute } from 'astro';
import { verifyOwner, getOwnerHotelIds } from '../../../../lib/ownerAuth';

export const GET: APIRoute = async ({ params, request, locals }) => {
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
  const hotel = await db.prepare('SELECT * FROM hotels WHERE id = ?').bind(hotelId).first();
  const plansRes = await db
    .prepare('SELECT * FROM plans WHERE hotel_id = ? ORDER BY name')
    .bind(hotelId)
    .all();
  return new Response(JSON.stringify({ hotel, plans: plansRes?.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
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
  // Booking managers cannot edit hotel info
  if ((owner as any).role === 'staff') {
    const { getStaffRole } = await import('../../../../lib/ownerAuth');
    const staffRole = await getStaffRole(db, (owner as any).sub);
    if (staffRole !== 'co_owner') {
      return new Response(JSON.stringify({ error: 'Booking managers cannot edit hotel information' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
  }

  const allowed = ['name', 'name_ja', 'description', 'description_ja', 'amenities',
    'categories', 'property_type', 'thumbnail_url', 'ical_url', 'address', 'phone',
    'latitude', 'longitude'];
  const updates: string[] = [];
  const params_vals: any[] = [];
  for (const key of allowed) {
    if (key in field_changes) {
      updates.push(`${key} = ?`);
      params_vals.push(field_changes[key]);
    }
  }
  if (updates.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid fields to update' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  await db.prepare(`UPDATE hotels SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...params_vals, hotelId).run();

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
