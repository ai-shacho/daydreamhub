import type { APIRoute } from 'astro';
import { requireOwner } from '../../../../lib/apiAuth';
import { convertUsdToLocal, roundForCurrency } from '../../../../lib/currency';

// Copy add-ons from one plan onto other plans the same owner controls.
//
// Each copy is an independent row: changing the price on one plan afterwards
// does not touch the others. That is the point — an owner sets breakfast up
// once, applies it across the estate, then adjusts the properties that differ.
//
// Prices are stored per hotel currency, so copying into a hotel that prices in
// another currency converts through the USD cache rather than carrying the
// number across unchanged.
const json = { 'Content-Type': 'application/json' };

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: json });
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return bad('Database not available', 503);

  const { owner, response } = await requireOwner(request, env?.JWT_SECRET || 'dev-secret');
  if (response) return response;

  let body: any;
  try { body = await request.json(); } catch { return bad('Invalid JSON'); }

  const optionIds = (Array.isArray(body.option_ids) ? body.option_ids : [])
    .map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v) && v > 0);
  const targetPlanIds = (Array.isArray(body.target_plan_ids) ? body.target_plan_ids : [])
    .map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v) && v > 0);
  const overwrite = body.overwrite === true;

  if (!optionIds.length) return bad('option_ids required');
  if (!targetPlanIds.length) return bad('target_plan_ids required');

  // Only the owner's own options and plans, resolved in one round trip each.
  const sources: any[] = ((await db.prepare(
    `SELECT o.* FROM plan_options o
       JOIN hotels h ON h.id = o.hotel_id
      WHERE LOWER(TRIM(h.email)) = LOWER(TRIM(?))
        AND o.id IN (${optionIds.map(() => '?').join(',')})`
  ).bind(owner.email, ...optionIds).all().catch(() => null))?.results) || [];
  if (!sources.length) return bad('No matching options', 404);

  const targets: any[] = ((await db.prepare(
    `SELECT p.id AS plan_id, p.hotel_id, h.currency
       FROM plans p JOIN hotels h ON h.id = p.hotel_id
      WHERE LOWER(TRIM(h.email)) = LOWER(TRIM(?))
        AND p.id IN (${targetPlanIds.map(() => '?').join(',')})`
  ).bind(owner.email, ...targetPlanIds).all().catch(() => null))?.results) || [];
  if (!targets.length) return bad('No matching target plans', 404);

  // Amounts are anchored on the USD cache, so rates are only needed when a
  // target prices in something other than USD.
  const needsFx = targets.some((t) => String(t.currency || 'USD').toUpperCase() !== 'USD');
  let rates: Record<string, number> = {};
  if (needsFx) {
    try {
      const { getExchangeRates } = await import('../../../../lib/tools');
      rates = await getExchangeRates(db);
    } catch { rates = {}; }
  }

  // Convert a USD-anchored amount into the target hotel's currency.
  const toLocal = (usd: number | null, currency: string): number | null => {
    if (usd == null) return null;
    if (currency === 'USD') return roundForCurrency(usd, 'USD');
    const v = convertUsdToLocal(usd, currency, rates);
    return v == null ? null : v;
  };

  let copied = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const t of targets) {
    const currency = String(t.currency || 'USD').toUpperCase();
    for (const s of sources) {
      if (Number(s.plan_id) === Number(t.plan_id)) { skipped++; continue; } // itself
      try {
        const existing: any = await db.prepare(
          'SELECT id FROM plan_options WHERE plan_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1'
        ).bind(t.plan_id, s.name).first();

        const price_usd = Number(s.price_usd || 0);
        const child_usd = s.child_price_usd == null ? null : Number(s.child_price_usd);
        const infant_usd = s.infant_price_usd == null ? null : Number(s.infant_price_usd);
        const price_local = toLocal(price_usd, currency) ?? price_usd;
        const child_local = toLocal(child_usd, currency);
        const infant_local = toLocal(infant_usd, currency);

        if (existing) {
          // An option of the same name is already there. Leave it alone unless
          // the owner explicitly asked to overwrite — silently rewriting a
          // price they had tuned would be worse than doing nothing.
          if (!overwrite) { skipped++; continue; }
          await db.prepare(
            `UPDATE plan_options SET name_ja = ?, description = ?, pricing_type = ?,
               price_local = ?, price_usd = ?, child_price_local = ?, child_price_usd = ?,
               infant_price_local = ?, infant_price_usd = ?,
               counts_adults = ?, counts_children = ?, counts_infants = ?, updated_at = datetime('now')
             WHERE id = ?`
          ).bind(
            s.name_ja || '', s.description || '', s.pricing_type,
            price_local, price_usd, child_local, child_usd, infant_local, infant_usd,
            s.counts_adults == null ? 1 : s.counts_adults,
            s.counts_children == null ? 1 : s.counts_children,
            s.counts_infants ? 1 : 0,
            existing.id,
          ).run();
          updated++;
        } else {
          await db.prepare(
            `INSERT INTO plan_options (plan_id, hotel_id, name, name_ja, description, pricing_type,
               price_local, price_usd, child_price_local, child_price_usd,
               infant_price_local, infant_price_usd,
               counts_adults, counts_children, counts_infants, is_active, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               COALESCE((SELECT MAX(sort_order) + 1 FROM plan_options WHERE plan_id = ?), 0))`
          ).bind(
            t.plan_id, t.hotel_id, s.name, s.name_ja || '', s.description || '', s.pricing_type,
            price_local, price_usd, child_local, child_usd, infant_local, infant_usd,
            s.counts_adults == null ? 1 : s.counts_adults,
            s.counts_children == null ? 1 : s.counts_children,
            s.counts_infants ? 1 : 0,
            s.is_active ? 1 : 0, t.plan_id,
          ).run();
          copied++;
        }
      } catch (e: any) {
        errors.push(`plan ${t.plan_id} / ${s.name}: ${e?.message || 'failed'}`);
      }
    }
  }

  return new Response(JSON.stringify({ success: true, copied, updated, skipped, errors }), { headers: json });
};
