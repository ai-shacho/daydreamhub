import type { APIRoute } from 'astro';
import { verifyOwner, getOwnerHotelIds } from '../../../lib/ownerAuth';

const json = { 'Content-Type': 'application/json' };

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'ddh-secret-2025';

  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json }); }

  const { hotel_id, name, name_ja, description, description_ja, price_usd,
    check_in_time, check_out_time, plan_type, max_guests, duration_hours, cancellation_policy, cancellation_hours } = body;

  if (!hotel_id || !name) return new Response(JSON.stringify({ error: 'hotel_id and name required' }), { status: 400, headers: json });

  // オーナーが所有するホテルか確認
  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(Number(hotel_id))) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404, headers: json });
  }

  try {
    const r = await db.prepare(
      `INSERT INTO plans (hotel_id,name,name_ja,description,description_ja,price_usd,check_in_time,check_out_time,plan_type,max_guests,duration_hours,cancellation_policy,cancellation_hours,is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`
    ).bind(hotel_id, name, name_ja||null, description||'', description_ja||null,
      price_usd||0, check_in_time||'', check_out_time||'', plan_type||'daycation',
      max_guests||2, duration_hours||null, cancellation_policy||'', cancellation_hours ?? 24).run();
    return new Response(JSON.stringify({ success: true, id: r.meta?.last_row_id }), { status: 201, headers: json });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: json });
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'ddh-secret-2025';

  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json }); }

  const { id, hotel_id, ...fields } = body;
  if (!id || !hotel_id) return new Response(JSON.stringify({ error: 'id and hotel_id required' }), { status: 400, headers: json });

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(Number(hotel_id))) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404, headers: json });
  }

  const allowed = ['name','name_ja','description','description_ja','price_usd','check_in_time',
    'check_out_time','plan_type','max_guests','duration_hours','cancellation_policy','cancellation_hours','is_active'];
  const updates: string[] = []; const params: any[] = [];
  for (const k of allowed) { if (k in fields) { updates.push(`${k} = ?`); params.push(fields[k]); } }
  if (!updates.length) return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: json });

  await db.prepare(`UPDATE plans SET ${updates.join(', ')} WHERE id = ? AND hotel_id = ?`)
    .bind(...params, id, hotel_id).run();
  return new Response(JSON.stringify({ success: true }), { headers: json });
};

// PATCH: reorder plans
export const PATCH: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'ddh-secret-2025';

  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json }); }

  const { hotel_id, order } = body; // order: plan id array in new order
  if (!hotel_id || !Array.isArray(order)) {
    return new Response(JSON.stringify({ error: 'hotel_id and order required' }), { status: 400, headers: json });
  }

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(Number(hotel_id))) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404, headers: json });
  }

  // Update sort_order for each plan
  for (let i = 0; i < order.length; i++) {
    await db.prepare('UPDATE plans SET sort_order = ? WHERE id = ? AND hotel_id = ?')
      .bind(i, order[i], Number(hotel_id)).run();
  }

  return new Response(JSON.stringify({ success: true }), { headers: json });
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'ddh-secret-2025';

  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });

  const url = new URL(request.url);
  const planId = url.searchParams.get('id');
  const hotelId = url.searchParams.get('hotel_id');
  if (!planId || !hotelId) return new Response(JSON.stringify({ error: 'id and hotel_id required' }), { status: 400, headers: json });

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(Number(hotelId))) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404, headers: json });
  }

  await db.prepare('DELETE FROM plans WHERE id = ? AND hotel_id = ?').bind(planId, hotelId).run();
  return new Response(JSON.stringify({ success: true }), { headers: json });
};
