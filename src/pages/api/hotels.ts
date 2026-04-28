import type { APIRoute } from 'astro';

// Simple in-memory rate limiter (resets per Worker instance, but sufficient to slow scrapers)
const rateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 20; // max 20 requests per minute per IP

export const GET: APIRoute = async ({ request, locals }) => {
  // IP-based rate limiting
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (entry && now < entry.resetAt) {
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }
  } else {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
  }

  const db = (locals as any).runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const perPage = Math.min(parseInt(url.searchParams.get('perPage') || '20'), 50); // max 50 per request
  const search = url.searchParams.get('search') || '';
  const city = url.searchParams.get('city') || '';
  const country = url.searchParams.get('country') || '';
  const offset = (page - 1) * perPage;

  const conditions: string[] = ['status = 'active''];
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
        `SELECT id, name, name_ja, slug, city, country, property_type, thumbnail_url, rating
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
