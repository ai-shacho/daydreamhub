import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500 });

  const { slug } = params;
  try {
    const hotel = await db.prepare(
      'SELECT id, name, name_ja, slug, city, country, thumbnail_url, images, description, description_ja FROM hotels WHERE slug = ? AND is_active = 1'
    ).bind(slug).first();

    if (!hotel) return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404 });

    // Photos live in two places: the hotel_images table (admin-managed, most
    // hotels) and the hotels.images JSON column (owner uploads). Merge both.
    let photos: string[] = [];
    try {
      const imgRows = await db.prepare(
        'SELECT image_url FROM hotel_images WHERE hotel_id = ? ORDER BY sort_order ASC LIMIT 12'
      ).bind(hotel.id).all();
      photos = (imgRows.results || []).map((r: any) => r.image_url).filter(Boolean);
    } catch {
      // table may not exist in stripped-down environments
    }
    try {
      const arr = JSON.parse(hotel.images || '[]');
      if (Array.isArray(arr)) {
        for (const u of arr) if (typeof u === 'string' && u && !photos.includes(u)) photos.push(u);
      }
    } catch {}
    hotel.images = photos.slice(0, 12);

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
