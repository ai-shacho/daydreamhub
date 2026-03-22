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
  try {
    const ownerHotelIds = await getOwnerHotelIds(db, owner);
    if (ownerHotelIds.length === 0) {
      return new Response(JSON.stringify({ settings: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const placeholders = ownerHotelIds.map(() => '?').join(',');
    const result = await db
      .prepare(
        `
      SELECT ns.*, h.name as hotel_name FROM notification_settings ns
      JOIN hotels h ON ns.hotel_id = h.id
      WHERE ns.user_id = ? AND ns.hotel_id IN (${placeholders})
    `
      )
      .bind(owner.sub, ...ownerHotelIds)
      .all();
    return new Response(JSON.stringify({ settings: result?.results || [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message || 'Failed to load notification settings' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
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
  try {
    const body: any = await request.json();
    const { hotel_id, email_on_booking, email_on_cancellation, email_on_review, auto_call_enabled } =
      body;
    if (!hotel_id) {
      return new Response(JSON.stringify({ error: 'hotel_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const ownerHotelIds = await getOwnerHotelIds(db, owner);
    if (!ownerHotelIds.includes(Number(hotel_id))) {
      return new Response(JSON.stringify({ error: 'Hotel not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    await db
      .prepare(
        `
      INSERT INTO notification_settings (user_id, hotel_id, email_on_booking, email_on_cancellation, email_on_review, auto_call_enabled)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, hotel_id) DO UPDATE SET
        email_on_booking = excluded.email_on_booking,
        email_on_cancellation = excluded.email_on_cancellation,
        email_on_review = excluded.email_on_review,
        auto_call_enabled = excluded.auto_call_enabled
    `
      )
      .bind(
        owner.sub,
        Number(hotel_id),
        email_on_booking ? 1 : 0,
        email_on_cancellation ? 1 : 0,
        email_on_review ? 1 : 0,
        auto_call_enabled ? 1 : 0
      )
      .run();
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message || 'Failed to update notification settings' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
