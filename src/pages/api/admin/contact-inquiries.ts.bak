import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';

  let query = 'SELECT * FROM contact_inquiries WHERE 1=1';
  const binds: any[] = [];
  if (status) { query += ' AND status = ?'; binds.push(status); }
  query += ' ORDER BY created_at DESC LIMIT 200';

  try {
    const result = binds.length
      ? await db.prepare(query).bind(...binds).all()
      : await db.prepare(query).all();
    return new Response(JSON.stringify({ inquiries: result?.results || [] }), { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to fetch' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let data: any;
  try { data = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { id, status, note } = data;
  if (!id || !status) return new Response(JSON.stringify({ error: 'id and status required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const updates: string[] = ['status = ?'];
  const params: any[] = [status];
  if (note !== undefined) { updates.push('note = ?'); params.push(note); }

  try {
    await db.prepare(`UPDATE contact_inquiries SET ${updates.join(', ')} WHERE id = ?`).bind(...params, Number(id)).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to update' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
