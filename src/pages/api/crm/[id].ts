import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

export const GET: APIRoute = async ({ params, request, locals }) => {
  const runtime = (locals as any).runtime;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  const id = params.id;
  if (!id) return new Response(JSON.stringify({ error: 'ID required' }), { status: 400 });

  const lead = await db.prepare(`
    SELECT l.*, h.name as hotel_name, h.city as hotel_city, h.status as hotel_status
    FROM crm_leads l
    LEFT JOIN hotels h ON h.id = l.hotel_id
    WHERE l.id = ?
  `).bind(id).first();

  if (!lead) return new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 });

  const reports = await db.prepare(
    'SELECT * FROM appointment_reports WHERE crm_lead_id = ? ORDER BY created_at DESC'
  ).bind(id).all();

  return new Response(JSON.stringify({ lead, reports: reports?.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const runtime = (locals as any).runtime;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  const id = params.id;
  const body = await request.json() as any;

  const allowed = ['contact_person','phone','email','whatsapp','position','city','country','timezone','appointment_jst','official_url','lost_reason','progress'];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const k of allowed) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
  }
  if (!sets.length) return new Response(JSON.stringify({ error: 'No valid fields' }), { status: 400 });
  sets.push("updated_at = datetime('now')");
  sets.push("last_updated = datetime('now')");
  vals.push(id);

  await db.prepare(`UPDATE crm_leads SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
};
