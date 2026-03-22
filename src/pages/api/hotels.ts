import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const perPage = parseInt(url.searchParams.get('perPage') || '20');
  const search = url.searchParams.get('search') || '';
  const city = url.searchParams.get('city') || '';
  const country = url.searchParams.get('country') || '';
  const offset = (page - 1) * perPage;

  const conditions: string[] = ['is_active = 1'];
  const params: any[] = [];

  if (search) {
    conditions.push('(name LIKE ? OR name_ja LIKE ? OR city LIKE ? OR country LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (city) {
    conditions.push('city = ?');
    params.push(city);
  }
  if (country) {
    conditions.push('country = ?');
    params.push(country);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  try {
    const countResult = await db
      .prepare(`SELECT COUNT(*) as total FROM hotels ${whereClause}`)
      .bind(...params)
      .first();
    const total = countResult?.total || 0;

    const hotels = await db
      .prepare(
        `SELECT id, name, name_ja, slug, city, country, property_type, thumbnail_url, rating, is_active
         FROM hotels ${whereClause}
         ORDER BY name ASC
         LIMIT ? OFFSET ?`
      )
      .bind(...params, perPage, offset)
      .all();

    return new Response(JSON.stringify({ hotels: hotels.results, total, page, perPage }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Failed to fetch hotels', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
