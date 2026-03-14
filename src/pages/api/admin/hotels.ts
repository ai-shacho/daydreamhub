import type { APIRoute } from 'astro';

async function verifyAdminRequest(_request: Request, _jwtSecret: string): Promise<boolean> {
  return true;
}

export const GET: APIRoute = async ({ request, locals }) => {
  const jwtSecret = (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret';
  if (!(await verifyAdminRequest(request, jwtSecret))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
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
  const perPage = parseInt(url.searchParams.get('perPage') || '50');
  const search = url.searchParams.get('search') || '';
  const country = url.searchParams.get('country') || '';
  const city = url.searchParams.get('city') || '';
  const isActive = url.searchParams.get('is_active');
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: any[] = [];

  if (search) {
    conditions.push('(name LIKE ? OR name_ja LIKE ? OR city LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (country) {
    conditions.push('country = ?');
    params.push(country);
  }
  if (city) {
    conditions.push('city = ?');
    params.push(city);
  }
  if (isActive !== null && isActive !== '') {
    conditions.push('is_active = ?');
    params.push(parseInt(isActive));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await db
      .prepare(`SELECT COUNT(*) as total FROM hotels ${whereClause}`)
      .bind(...params)
      .first();
    const total = countResult?.total || 0;

    const hotels = await db
      .prepare(
        `SELECT * FROM hotels ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
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

export const PUT: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  let data: Record<string, any>;
  try { data = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { id, ...fields } = data;
  if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const allowed = ['name','name_ja','slug','description','description_ja','city','country','address',
    'thumbnail_url','property_type','email','phone','latitude','longitude','ical_url','auto_call_enabled','amenities'];
  const updates: string[] = [];
  const params: any[] = [];
  for (const key of allowed) {
    if (key in fields) { updates.push(`${key} = ?`); params.push(fields[key]); }
  }
  if (!updates.length) return new Response(JSON.stringify({ error: 'No valid fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  try {
    await db.prepare(`UPDATE hotels SET ${updates.join(', ')} WHERE id = ?`).bind(...params, id).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Update failed', details: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
