import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/apiAuth';
import { sendListingChangesRequestedEmail } from '../../../lib/email';

// Admin sends a listing back to the owner with feedback instead of publishing.
// Moves the hotel from "Under review" to "Changes requested": clears
// review_requested_at, stamps review_changes_requested_at, stores the feedback,
// and emails the owner so they can revise and re-request.
export const POST: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  const { response } = await requireAdmin(request, jwtSecret);
  if (response) return response;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json });
  }
  const hotelId = Number(body.hotel_id);
  const feedback = String(body.feedback || '').trim();
  if (!hotelId) return new Response(JSON.stringify({ error: 'hotel_id required' }), { status: 400, headers: json });
  if (!feedback) return new Response(JSON.stringify({ error: 'feedback required' }), { status: 400, headers: json });

  const hotel: any = await db.prepare(
    'SELECT id, name, email, is_active FROM hotels WHERE id = ?'
  ).bind(hotelId).first();
  if (!hotel) return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404, headers: json });
  if (hotel.is_active) return new Response(JSON.stringify({ error: 'Hotel is already published' }), { status: 400, headers: json });

  const now = new Date().toISOString();
  await db.prepare(
    'UPDATE hotels SET review_requested_at = NULL, review_changes_requested_at = ?, review_feedback = ? WHERE id = ?'
  ).bind(now, feedback, hotelId).run();

  let emailed = false;
  const resendKey = env?.RESEND_API_KEY;
  if (resendKey && hotel.email) {
    const ownerUser: any = await db.prepare('SELECT name FROM users WHERE email = ?').bind(hotel.email).first();
    const res = await sendListingChangesRequestedEmail(resendKey, {
      ownerName: ownerUser?.name || 'there',
      ownerEmail: hotel.email,
      hotelName: hotel.name,
      hotelId: hotel.id,
      feedback,
    });
    emailed = res.success !== false;
  }

  return new Response(JSON.stringify({ success: true, emailed }), { headers: json });
};
