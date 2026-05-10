import type { APIRoute } from 'astro';
import { verifyOwner, getOwnerHotelIds } from '../../../lib/ownerAuth';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner)
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!db)
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

  const { review_id, content } = (await request.json()) as any;
  if (!review_id || !content?.trim()) {
    return new Response(JSON.stringify({ error: 'review_id and content required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  const review = await db
    .prepare('SELECT hotel_id FROM reviews WHERE id = ?')
    .bind(review_id)
    .first();
  if (!review || !ownerHotelIds.includes((review as any).hotel_id)) {
    return new Response(JSON.stringify({ error: 'Review not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const existing = await db
    .prepare('SELECT id FROM review_replies WHERE review_id = ?')
    .bind(review_id)
    .first();
  if (existing) {
    await db
      .prepare('UPDATE review_replies SET content = ? WHERE review_id = ?')
      .bind(content.trim(), review_id)
      .run();
  } else {
    await db
      .prepare('INSERT INTO review_replies (review_id, user_id, content) VALUES (?, ?, ?)')
      .bind(review_id, owner.sub, content.trim())
      .run();
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
