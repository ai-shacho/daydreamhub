import type { APIRoute } from 'astro';
import { verifyOwner } from '../../../../lib/ownerAuth';

export const POST: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'ddh-secret-2025';

  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 503, headers: json });
  }

  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });
  }

  let data: Record<string, any>;
  try { data = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json });
  }

  const { name, city, country } = data;
  if (!name || !city || !country) {
    return new Response(JSON.stringify({ error: 'name, city, country are required' }), { status: 400, headers: json });
  }

  // スラッグを自動生成
  const baseSlug = name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
  const uniqueSuffix = Date.now().toString(36);
  const slug = `${baseSlug}-${uniqueSuffix}`;

  const allowed = ['name', 'name_ja', 'description', 'description_ja', 'city', 'country',
    'address', 'property_type', 'phone', 'latitude', 'longitude'];
  const cols: string[] = ['slug', 'email', 'is_active'];
  const vals: any[] = [slug, owner.email, 1];

  for (const key of allowed) {
    if (key in data && data[key] !== '' && data[key] !== null && data[key] !== undefined) {
      cols.push(key);
      vals.push(data[key]);
    }
  }

  try {
    const result = await db.prepare(
      `INSERT INTO hotels (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    ).bind(...vals).run();

    const newId = result.meta?.last_row_id;
    const newHotel = await db.prepare('SELECT id FROM hotels WHERE slug = ? LIMIT 1').bind(slug).first();

    return new Response(JSON.stringify({
      success: true,
      id: newHotel?.id || newId,
      message: 'Hotel submitted for review. It will appear on the site after admin approval.'
    }), { status: 201, headers: json });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Failed to create hotel', details: message }), { status: 500, headers: json });
  }
};
