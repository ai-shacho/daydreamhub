// Paid add-ons attached to a plan (breakfast, airport transfer, day pass…).
//
// Owners reach these through /api/owner/plan-options and admins through
// /api/admin/plan-options. The two routes differ only in who is allowed to
// touch which plan; everything below — validation, currency handling, what
// happens when the pricing type changes — is shared, because two copies of
// these rules would drift and the subtle one (clearing the child and infant
// rates when a per-guest option stops being priced by age band) is exactly the
// kind that gets fixed in one copy and not the other.

import { resolvePlanPriceFields } from './currency';

export const PRICING_TYPES = ['per_room', 'per_person', 'per_adult_child'] as const;
export type PricingType = (typeof PRICING_TYPES)[number];

export function isPricingType(v: unknown): v is PricingType {
  return PRICING_TYPES.includes(String(v) as PricingType);
}

export async function listOptions(db: any, planId: number) {
  const rows = await db.prepare(
    'SELECT * FROM plan_options WHERE plan_id = ? ORDER BY sort_order ASC, id ASC'
  ).bind(planId).all();
  return rows?.results || [];
}

/** Create an add-on on a plan. `hotelId` decides which currency the price is in. */
export async function createOption(db: any, planId: number, hotelId: number, body: any) {
  const name = String(body.name || '').trim();
  const pricingType = String(body.pricing_type || 'per_room');
  if (!name) throw new Error('name required');
  if (!isPricingType(pricingType)) throw new Error('Invalid pricing_type');

  const price = await resolvePlanPriceFields(db, hotelId, body.price);
  const child = pricingType === 'per_adult_child'
    ? await resolvePlanPriceFields(db, hotelId, body.child_price ?? 0)
    : null;
  const infant = pricingType === 'per_adult_child'
    ? await resolvePlanPriceFields(db, hotelId, body.infant_price ?? 0)
    : null;

  const res: any = await db.prepare(
    `INSERT INTO plan_options (plan_id, hotel_id, name, name_ja, description, pricing_type,
       price_local, price_usd, child_price_local, child_price_usd,
       infant_price_local, infant_price_usd,
       counts_adults, counts_children, counts_infants, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
       COALESCE((SELECT MAX(sort_order) + 1 FROM plan_options WHERE plan_id = ?), 0))`
  ).bind(
    planId, hotelId, name, String(body.name_ja || ''), String(body.description || ''), pricingType,
    price.price_local, price.price_usd,
    child ? child.price_local : null, child ? child.price_usd : null,
    infant ? infant.price_local : null, infant ? infant.price_usd : null,
    // Which age bands a per-guest option counts is the hotel's rule: a day pass
    // may count everyone through the door, a tasting adults only.
    body.counts_adults === false ? 0 : 1,
    body.counts_children === false ? 0 : 1,
    body.counts_infants === true ? 1 : 0,
    planId,
  ).run();

  return { id: res?.meta?.last_row_id, currency: price.currency };
}

/** Apply a partial update to an existing add-on. `existing` is the current row. */
export async function updateOption(db: any, id: number, existing: any, body: any) {
  const sets: string[] = [];
  const binds: any[] = [];
  const push = (sql: string, val: any) => { sets.push(sql); binds.push(val); };

  if ('name' in body) {
    const name = String(body.name || '').trim();
    if (!name) throw new Error('name cannot be empty');
    push('name = ?', name);
  }
  if ('name_ja' in body) push('name_ja = ?', String(body.name_ja || ''));
  if ('description' in body) push('description = ?', String(body.description || ''));
  if ('is_active' in body) push('is_active = ?', body.is_active ? 1 : 0);
  if ('counts_adults' in body) push('counts_adults = ?', body.counts_adults ? 1 : 0);
  if ('counts_children' in body) push('counts_children = ?', body.counts_children ? 1 : 0);
  if ('counts_infants' in body) push('counts_infants = ?', body.counts_infants ? 1 : 0);

  const pricingType = 'pricing_type' in body ? String(body.pricing_type) : String(existing.pricing_type);
  if ('pricing_type' in body) {
    if (!isPricingType(pricingType)) throw new Error('Invalid pricing_type');
    push('pricing_type = ?', pricingType);
  }

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
    // Switching away from age-band pricing clears the child and infant rates,
    // so a later switch back cannot resurrect stale numbers.
    push('child_price_local = ?', null);
    push('child_price_usd = ?', null);
    push('infant_price_local = ?', null);
    push('infant_price_usd = ?', null);
  }

  if (!sets.length) throw new Error('No fields to update');
  push('updated_at = ?', new Date().toISOString());
  binds.push(id);
  await db.prepare(`UPDATE plan_options SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
}

/**
 * Remove an add-on. Past bookings keep their own copy in booking_options, so
 * this never changes what a guest was charged.
 */
export async function deleteOption(db: any, id: number) {
  await db.prepare('DELETE FROM plan_options WHERE id = ?').bind(id).run();
}
