import type { APIRoute } from 'astro';
import { verifyOwner } from '../../../lib/ownerAuth';
import { sendReviewRequestNotification } from '../../../lib/email';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let hotelId: number;
  try {
    const body = await request.json() as any;
    hotelId = Number(body.hotel_id);
    if (!hotelId) throw new Error();
  } catch {
    return new Response(JSON.stringify({ error: 'hotel_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // オーナーの所有ホテルか確認（is_active=0 も含む）
  const hotel = await db.prepare(
    'SELECT id, name, slug, is_active, review_requested_at FROM hotels WHERE id = ? AND email = ?'
  ).bind(hotelId, owner.email).first() as any;

  if (!hotel) return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  if (hotel.is_active) return new Response(JSON.stringify({ error: 'Already published' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (hotel.review_requested_at) return new Response(JSON.stringify({ error: 'Review already requested' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const now = new Date().toISOString();
  await db.prepare('UPDATE hotels SET review_requested_at = ? WHERE id = ?').bind(now, hotelId).run();

  const resendKey = env?.RESEND_API_KEY;
  if (resendKey) {
    await sendReviewRequestNotification(resendKey, {
      ownerName: owner.name,
      ownerEmail: owner.email,
      hotelName: hotel.name,
      hotelId: hotel.id,
    });
  }

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
};
