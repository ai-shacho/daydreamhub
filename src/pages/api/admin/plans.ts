import type { APIRoute } from 'astro';
import { parseCancellationHours } from '../../../lib/listingReadiness';
import { resolvePlanPriceFields } from '../../../lib/currency';

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
  const { hotel_id, name, name_ja, description, description_ja, price_usd, check_in_time, check_out_time, plan_type, max_guests, duration_hours, cancellation_policy, cancellation_hours } = body;
  if (!hotel_id || !name) return json({ error: 'hotel_id and name required' }, 400);
  const cancel = parseCancellationHours(cancellation_hours);
  if (!cancel.ok) return json({ error: cancel.error }, 400);
  try {
    // Price arrives in the hotel's currency; both columns resolved server-side.
    const pricing = await resolvePlanPriceFields(d, hotel_id, body.price ?? body.price_local ?? price_usd ?? 0);
    const r = await d.prepare(
      `INSERT INTO plans (hotel_id,name,name_ja,description,description_ja,price_usd,price_local,check_in_time,check_out_time,plan_type,max_guests,duration_hours,cancellation_policy,cancellation_hours,is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`
    ).bind(hotel_id, name, name_ja||null, description||'', description_ja||null, pricing.price_usd, pricing.price_local, check_in_time||'', check_out_time||'', plan_type||'daycation', max_guests||2, duration_hours||null, cancellation_policy||'', cancel.value).run();
    return json({ success: true, id: r.meta?.last_row_id, pricing });
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
  if ('cancellation_hours' in fields) {
    const c = parseCancellationHours(fields.cancellation_hours);
    if (!c.ok) return json({ error: c.error }, 400);
    fields.cancellation_hours = c.value;
  }
  const allowed = ['name','name_ja','description','description_ja','check_in_time','check_out_time','plan_type','max_guests','duration_hours','cancellation_policy','cancellation_hours','is_active','sort_order'];
  const updates: string[] = []; const params: any[] = [];
  for (const k of allowed) { if (k in fields) { updates.push(`${k} = ?`); params.push(fields[k]); } }

  // Price updates: resolve both columns from the hotel-currency amount.
  const priceInput = fields.price ?? fields.price_local ?? fields.price_usd;
  if (priceInput !== undefined) {
    try {
      const planRow: any = await d.prepare('SELECT hotel_id FROM plans WHERE id = ?').bind(id).first();
      if (!planRow) return json({ error: 'Plan not found' }, 404);
      const pricing = await resolvePlanPriceFields(d, planRow.hotel_id, priceInput);
      updates.push('price_local = ?', 'price_usd = ?');
      params.push(pricing.price_local, pricing.price_usd);
    } catch (e: any) { return json({ error: e?.message || String(e) }, 400); }
  }
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
