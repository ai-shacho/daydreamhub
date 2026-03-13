import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ hotels: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const slugsParam = url.searchParams.get('slugs') || '';
  if (!slugsParam) {
    return new Response(JSON.stringify({ hotels: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const slugs = slugsParam.split(',').filter(Boolean).slice(0, 50);
  if (slugs.length === 0) {
    return new Response(JSON.stringify({ hotels: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const placeholders = slugs.map(() => '?').join(',');
  const result = await db
    .prepare(
      `SELECT h.id, h.name, h.name_ja, h.slug, h.city, h.country, h.thumbnail_url, h.avg_rating, h.review_count, h.categories,
              MIN(p.price_usd) as min_price
       FROM hotels h
       LEFT JOIN plans p ON p.hotel_id = h.id AND p.is_active = 1
       WHERE h.slug IN (${placeholders}) AND h.is_active = 1
       GROUP BY h.id`
    )
    .bind(...slugs)
    .all();

  return new Response(JSON.stringify({ hotels: result?.results || [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
