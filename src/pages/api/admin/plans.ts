import type { APIRoute } from 'astro';

const db = (locals: any) => (locals as any).runtime?.env?.DB;

// Ensure sort_order column exists (auto-migrate)
async function ensureSortOrder(d: any) {
  try {
    await d.prepare("SELECT sort_order FROM plans LIMIT 1").first();
  } catch {
    await d.exec("ALTER TABLE plans ADD COLUMN sort_order INTEGER DEFAULT 0");
  }
}

// GET: ?hotel_id=xxx
export const GET: APIRoute = async ({ request, locals }) => {
  const d = db(locals);
  if (!d) return json({ error: 'DB unavailable' }, 500);
  const url = new URL(request.url);
  const hotelId = url.searchParams.get('hotel_id');
  if (!hotelId) return json({ error: 'hotel_id required' }, 400);
  try {
    await ensureSortOrder(d);
    const result = await d.prepare('SELECT * FROM plans WHERE hotel_id = ? ORDER BY sort_order ASC, price_usd ASC').bind(hotelId).all();
    return json({ plans: result.results });
  } catch (e) { return json({ error: String(e) }, 500); }
};

// POST: create plan
export const POST: APIRoute = async ({ request, locals }) => {
  const d = db(locals);
  if (!d) return json({ error: 'DB unavailable' }, 500);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { hotel_id, name, name_ja, description, description_ja, price_usd, check_in_time, check_out_time, plan_type, max_guests, duration_hours, cancellation_policy } = body;
  if (!hotel_id || !name) return json({ error: 'hotel_id and name required' }, 400);
  try {
    const r = await d.prepare(
      `INSERT INTO plans (hotel_id,name,name_ja,description,description_ja,price_usd,check_in_time,check_out_time,plan_type,max_guests,duration_hours,cancellation_policy,is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`
    ).bind(hotel_id, name, name_ja||null, description||'', description_ja||null, price_usd||0, check_in_time||'', check_out_time||'', plan_type||'daycation', max_guests||2, duration_hours||null, cancellation_policy||'').run();
    return json({ success: true, id: r.meta?.last_row_id });
  } catch (e) { return json({ error: String(e) }, 500); }
};

// PUT: update plan
export const PUT: APIRoute = async ({ request, locals }) => {
  const d = db(locals);
  if (!d) return json({ error: 'DB unavailable' }, 500);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { id, ...fields } = body;
  if (!id) return json({ error: 'id required' }, 400);
  const allowed = ['name','name_ja','description','description_ja','price_usd','check_in_time','check_out_time','plan_type','max_guests','duration_hours','cancellation_policy','is_active','sort_order'];
  const updates: string[] = []; const params: any[] = [];
  for (const k of allowed) { if (k in fields) { updates.push(`${k} = ?`); params.push(fields[k]); } }
  if (!updates.length) return json({ error: 'No fields to update' }, 400);
  try {
    await d.prepare(`UPDATE plans SET ${updates.join(', ')} WHERE id = ?`).bind(...params, id).run();
    return json({ success: true });
  } catch (e) { return json({ error: String(e) }, 500); }
};

// PATCH: reorder plans [{id, sort_order}]
export const PATCH: APIRoute = async ({ request, locals }) => {
  const d = db(locals);
  if (!d) return json({ error: 'DB unavailable' }, 500);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { plans } = body;
  if (!plans || !Array.isArray(plans)) return json({ error: 'plans array required' }, 400);
  try {
    await ensureSortOrder(d);
    for (const p of plans) {
      await d.prepare('UPDATE plans SET sort_order = ? WHERE id = ?').bind(p.sort_order, p.id).run();
    }
    return json({ success: true });
  } catch (e) { return json({ error: String(e) }, 500); }
};

// DELETE: ?id=xxx
export const DELETE: APIRoute = async ({ request, locals }) => {
  const d = db(locals);
  if (!d) return json({ error: 'DB unavailable' }, 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);
  try {
    await d.prepare('DELETE FROM plans WHERE id = ?').bind(id).run();
    return json({ success: true });
  } catch (e) { return json({ error: String(e) }, 500); }
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
