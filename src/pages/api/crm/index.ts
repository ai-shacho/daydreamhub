import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

export const GET: APIRoute = async ({ request, locals, url }) => {
  const runtime = (locals as any).runtime;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  const format = url.searchParams.get('format');
  const filter = url.searchParams.get('filter');

  let whereClause = '';
  if (filter === 'new') whereClause = "WHERE l.progress = 'new'";
  else if (filter === 'in_progress') whereClause = "WHERE l.progress = 'in_progress'";
  else if (filter === 'won') whereClause = "WHERE l.progress = 'won'";
  else if (filter === 'lost') whereClause = "WHERE l.progress = 'lost'";

  const query = `
    SELECT l.*, h.name as hotel_name
    FROM crm_leads l
    LEFT JOIN hotels h ON h.id = l.hotel_id
    ${whereClause}
    ORDER BY l.last_updated DESC
  `;

  const result = await db.prepare(query).all();
  const leads = result?.results || [];

  if (format === 'csv') {
    const hdrs = ['id','hotel_name','contact_person','position','email','phone','whatsapp','city','country','progress','lost_reason','last_updated','created_at'];
    const csvRows = [
      hdrs.join(','),
      ...leads.map((l: any) => hdrs.map((h: string) => JSON.stringify(l[h] ?? '')).join(','))
    ];
    return new Response(csvRows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="crm_leads.csv"',
      },
    });
  }

  const stats = await db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN progress = 'new' THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN progress = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
      SUM(CASE WHEN progress = 'won' THEN 1 ELSE 0 END) as won_count,
      SUM(CASE WHEN progress = 'lost' THEN 1 ELSE 0 END) as lost_count
    FROM crm_leads
  `).first();

  return new Response(JSON.stringify({ leads, stats }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  try {
    const body = await request.json() as any;
    const { hotel_id, contact_person, phone, email, whatsapp, country, city, position, timezone, appointment_jst, acquirer, official_url } = body;

    if (!contact_person) {
      return new Response(JSON.stringify({ error: 'contact_person is required' }), { status: 400 });
    }

    const result = await db.prepare(`
      INSERT INTO crm_leads (
        hotel_id, contact_person, phone, email, whatsapp,
        country, city, position, timezone, appointment_jst,
        acquirer, official_url, progress,
        created_at, updated_at, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'), datetime('now'), datetime('now'))
    `).bind(
      hotel_id ? parseInt(hotel_id) : null,
      contact_person || null, phone || null,
      email || null, whatsapp || null, country || null, city || null,
      position || null, timezone || null, appointment_jst || null,
      acquirer || null, official_url || null
    ).run();

    return new Response(JSON.stringify({ success: true, id: result.meta?.last_row_id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
