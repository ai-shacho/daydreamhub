import type { APIRoute } from 'astro';
import { requireOwner } from '../../../lib/apiAuth';
import { resolvePlanPriceFields } from '../../../lib/currency';

// Paid add-ons attached to a plan (breakfast, airport transfer, day pass…).
// Prices are entered in the hotel's own currency and stored the same way plan
// prices are: local amount plus a derived USD cache.
const json = { 'Content-Type': 'application/json' };

export const PRICING_TYPES = ['per_room', 'per_person', 'per_adult_child'] as const;

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: json });
}

// An owner may only touch options on plans belonging to their own hotels.
async function ownedPlan(db: any, ownerEmail: string, planId: number) {
  return await db.prepare(
    `SELECT p.id, p.hotel_id FROM plans p
       JOIN hotels h ON h.id = p.hotel_id
      WHERE p.id = ? AND LOWER(TRIM(h.email)) = LOWER(TRIM(?))`
  ).bind(planId, ownerEmail).first();
}

async function ownedOption(db: any, ownerEmail: string, optionId: number) {
  return await db.prepare(
    `SELECT o.* FROM plan_options o
       JOIN hotels h ON h.id = o.hotel_id
      WHERE o.id = ? AND LOWER(TRIM(h.email)) = LOWER(TRIM(?))`
  ).bind(optionId, ownerEmail).first();
}

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return bad('Database not available', 503);
  const { owner, response } = await requireOwner(request, env?.JWT_SECRET || 'dev-secret');
  if (response) return response;

  const planId = Number(new URL(request.url).searchParams.get('plan_id'));
  if (!planId) return bad('plan_id required');
  if (!(await ownedPlan(db, owner.email, planId))) return bad('Plan not found', 404);

  const rows = await db.prepare(
    'SELECT * FROM plan_options WHERE plan_id = ? ORDER BY sort_order ASC, id ASC'
  ).bind(planId).all();
  return new Response(JSON.stringify({ options: rows?.results || [] }), { headers: json });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return bad('Database not available', 503);
  const { owner, response } = await requireOwner(request, env?.JWT_SECRET || 'dev-secret');
  if (response) return response;

  let body: any;
  try { body = await request.json(); } catch { return bad('Invalid JSON'); }

  const planId = Number(body.plan_id);
  const name = String(body.name || '').trim();
  const pricingType = String(body.pricing_type || 'per_room');
  if (!planId) return bad('plan_id required');
  if (!name) return bad('name required');
  if (!PRICING_TYPES.includes(pricingType as any)) return bad('Invalid pricing_type');

  const plan: any = await ownedPlan(db, owner.email, planId);
  if (!plan) return bad('Plan not found', 404);

  try {
    const price = await resolvePlanPriceFields(db, plan.hotel_id, body.price);
    const child = pricingType === 'per_adult_child'
      ? await resolvePlanPriceFields(db, plan.hotel_id, body.child_price ?? 0)
      : null;
    const infant = pricingType === 'per_adult_child'
      ? await resolvePlanPriceFields(db, plan.hotel_id, body.infant_price ?? 0)
      : null;

    const res: any = await db.prepare(
      `INSERT INTO plan_options (plan_id, hotel_id, name, name_ja, description, pricing_type,
         price_local, price_usd, child_price_local, child_price_usd,
         infant_price_local, infant_price_usd,
         counts_adults, counts_children, counts_infants, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
         COALESCE((SELECT MAX(sort_order) + 1 FROM plan_options WHERE plan_id = ?), 0))`
    ).bind(
      planId, plan.hotel_id, name, String(body.name_ja || ''), String(body.description || ''), pricingType,
      price.price_local, price.price_usd,
      child ? child.price_local : null, child ? child.price_usd : null,
      infant ? infant.price_local : null, infant ? infant.price_usd : null,
      body.counts_adults === false ? 0 : 1,
      body.counts_children === false ? 0 : 1,
      body.counts_infants === true ? 1 : 0,
      planId,
    ).run();

    return new Response(JSON.stringify({ success: true, id: res?.meta?.last_row_id, currency: price.currency }), { headers: json });
  } catch (e: any) {
    return bad(e?.message || 'Failed to create option', 500);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return bad('Database not available', 503);
  const { owner, response } = await requireOwner(request, env?.JWT_SECRET || 'dev-secret');
  if (response) return response;

  let body: any;
  try { body = await request.json(); } catch { return bad('Invalid JSON'); }
  const id = Number(body.id);
  if (!id) return bad('id required');

  const existing: any = await ownedOption(db, owner.email, id);
  if (!existing) return bad('Option not found', 404);

  const sets: string[] = [];
  const binds: any[] = [];
  const push = (sql: string, val: any) => { sets.push(sql); binds.push(val); };

  if ('name' in body) {
    const name = String(body.name || '').trim();
    if (!name) return bad('name cannot be empty');
    push('name = ?', name);
  }
  if ('name_ja' in body) push('name_ja = ?', String(body.name_ja || ''));
  if ('description' in body) push('description = ?', String(body.description || ''));
  if ('is_active' in body) push('is_active = ?', body.is_active ? 1 : 0);
  // Which age bands a per-guest option counts.
  if ('counts_adults' in body) push('counts_adults = ?', body.counts_adults ? 1 : 0);
  if ('counts_children' in body) push('counts_children = ?', body.counts_children ? 1 : 0);
  if ('counts_infants' in body) push('counts_infants = ?', body.counts_infants ? 1 : 0);

  const pricingType = 'pricing_type' in body ? String(body.pricing_type) : String(existing.pricing_type);
  if ('pricing_type' in body) {
    if (!PRICING_TYPES.includes(pricingType as any)) return bad('Invalid pricing_type');
    push('pricing_type = ?', pricingType);
  }

  try {
    if ('price' in body) {
      const price = await resolvePlanPriceFields(db, existing.hotel_id, body.price);
      push('price_local = ?', price.price_local);
      push('price_usd = ?', price.price_usd);
    }
    if (pricingType === 'per_adult_child') {
      if ('child_price' in body) {
        const child = await resolvePlanPriceFields(db, existing.hotel_id, body.child_price ?? 0);
        push('child_price_local = ?', child.price_local);
        push('child_price_usd = ?', child.price_usd);
      }
      if ('infant_price' in body) {
        const infant = await resolvePlanPriceFields(db, existing.hotel_id, body.infant_price ?? 0);
        push('infant_price_local = ?', infant.price_local);
        push('infant_price_usd = ?', infant.price_usd);
      }
    } else if ('pricing_type' in body) {
      // Switching away from age-band pricing clears the child and infant rates.
      push('child_price_local = ?', null);
      push('child_price_usd = ?', null);
      push('infant_price_local = ?', null);
      push('infant_price_usd = ?', null);
    }

    if (!sets.length) return bad('No fields to update');
    push('updated_at = ?', new Date().toISOString());
    binds.push(id);
    await db.prepare(`UPDATE plan_options SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return new Response(JSON.stringify({ success: true }), { headers: json });
  } catch (e: any) {
    return bad(e?.message || 'Failed to update option', 500);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return bad('Database not available', 503);
  const { owner, response } = await requireOwner(request, env?.JWT_SECRET || 'dev-secret');
  if (response) return response;

  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!id) return bad('id required');
  if (!(await ownedOption(db, owner.email, id))) return bad('Option not found', 404);

  // Past bookings keep their own copy in booking_options, so removing the
  // option here never changes what a guest was charged.
  await db.prepare('DELETE FROM plan_options WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify({ success: true }), { headers: json });
};
