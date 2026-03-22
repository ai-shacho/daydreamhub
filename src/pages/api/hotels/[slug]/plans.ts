import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500 });

  const { slug } = params;
  try {
    const hotel = await db.prepare(
      'SELECT id, name, slug, city, country, thumbnail_url FROM hotels WHERE slug = ? AND is_active = 1'
    ).bind(slug).first();

    if (!hotel) return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404 });

    const plans = await db.prepare(
      'SELECT id, name, name_ja, price_usd, check_in_time, check_out_time, plan_type, max_guests, duration_hours FROM plans WHERE hotel_id = ? AND is_active = 1 ORDER BY price_usd ASC'
    ).bind(hotel.id).all();

    return new Response(JSON.stringify({ hotel, plans: plans.results || [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
