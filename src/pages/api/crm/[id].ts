import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  const id = params.id;
  if (!id) return new Response(JSON.stringify({ error: 'ID required' }), { status: 400 });

  const lead = await db.prepare('SELECT * FROM crm_leads WHERE id = ?').bind(id).first();
  if (!lead) return new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 });

  const reports = await db.prepare(
    'SELECT * FROM appointment_reports WHERE crm_lead_id = ? ORDER BY timestamp DESC'
  ).bind(id).all();

  return new Response(JSON.stringify({
    lead,
    reports: reports?.results || []
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
