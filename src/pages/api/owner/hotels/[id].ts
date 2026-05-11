import { APIRoute } from 'astro';
import { verifyOwner } from '../../../../lib/ownerAuth';

export const del: APIRoute = async ({ params, request, locals }) => {
  const hotelId = params.id;
  const runtime = locals.runtime as any;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || "dev-secret";

  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
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
