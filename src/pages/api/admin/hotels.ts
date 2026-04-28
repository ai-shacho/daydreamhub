import type { APIRoute } from 'astro';
import { sendListingApprovedEmail } from '../../../lib/email';

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
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
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
    'thumbnail_url','property_type','email','phone','latitude','longitude','ical_url','auto_call_enabled','amenities','cancellation_policy','is_active','status'];
  const updates: string[] = [];
  const params: any[] = [];
  for (const key of allowed) {
    if (key in fields) { updates.push(`${key} = ?`); params.push(fields[key]); }
  }
  if (!updates.length) return new Response(JSON.stringify({ error: 'No valid fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Keep is_active in sync with status
  if ('status' in fields) {
    updates.push('is_active = ?');
    params.push(fields.status === 'active' ? 1 : 0);
  }

  // If coordinates changed manually, clear the verified flag so Map Check re-evaluates.
  if ('latitude' in fields || 'longitude' in fields) {
    updates.push('coords_verified_at = NULL');
  }

  try {
    // is_active が 1 に変わる場合、変更前の状態を確認
    const wasActive = 'is_active' in fields && fields.is_active == 1
      ? (await db.prepare('SELECT is_active, name, slug, email FROM hotels WHERE id = ?').bind(id).first() as any)
      : null;

    await db.prepare(`UPDATE hotels SET ${updates.join(', ')} WHERE id = ?`).bind(...params, id).run();

    // is_active: 0→1 になったらオーナーに掲載完了メール送信
    if (wasActive && !wasActive.is_active && wasActive.email) {
      const resendKey = env?.RESEND_API_KEY;
      if (resendKey) {
        const ownerUser = await db.prepare('SELECT name FROM users WHERE email = ?').bind(wasActive.email).first() as any;
        if (ownerUser) {
          await sendListingApprovedEmail(resendKey, {
            ownerName: ownerUser.name,
            ownerEmail: wasActive.email,
            hotelName: wasActive.name,
            hotelSlug: wasActive.slug,
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Update failed', details: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing required query param: id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const hotelId = parseInt(id);
    await db.prepare('DELETE FROM plans WHERE hotel_id = ?').bind(hotelId).run();
    await db.prepare('DELETE FROM hotel_amenities WHERE hotel_id = ?').bind(hotelId).run();
    const result = await db.prepare('DELETE FROM hotels WHERE id = ?').bind(hotelId).run();
    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Hotel not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Delete failed', details: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
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

  const { name, slug, city, country } = data;
  if (!name || !slug || !city || !country) {
    return new Response(JSON.stringify({ error: 'Missing required fields: name, slug, city, country' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const status = data.status || 'inactive';
    const isActive = status === 'active' ? 1 : 0;
    const result = await db.prepare(
      `INSERT INTO hotels (name, name_ja, slug, description, description_ja, city, country, address, thumbnail_url, property_type, email, phone, amenities, is_active, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, datetime('now'))`
    ).bind(
      name, data.name_ja || null, slug,
      data.description || null, data.description_ja || null,
      city, country,
      data.address || null, data.thumbnail_url || null,
      data.property_type || 'hotel',
      data.email || null, data.phone || null,
      isActive, status
    ).run();
    return new Response(JSON.stringify({ success: true, id: (result as any).meta?.last_row_id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Insert failed', details: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
