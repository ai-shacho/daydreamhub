import type { APIRoute } from 'astro';
import { getOwnerHotelIds } from '../../../../../lib/ownerAuth';
import { requireOwner } from '../../../../../lib/apiAuth';

// GET: 施設の料金設定を取得
export const GET: APIRoute = async ({ params, request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';

  const { owner, response } = await requireOwner(request, jwtSecret);
  if (response) return response;

  const facilityId = Number(params.facilityId);
  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(facilityId)) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  const config = await db
    .prepare('SELECT * FROM facility_pricing_configs WHERE hotel_id = ? LIMIT 1')
    .bind(facilityId)
    .first();

  const plans = await db
    .prepare('SELECT * FROM facility_plans WHERE hotel_id = ? ORDER BY sort_order, id')
    .bind(facilityId)
    .all();

  return new Response(
    JSON.stringify({ config: config || null, plans: plans?.results || [] }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};

// PUT: 施設の料金設定を保存（upsert）
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';

  const { owner, response } = await requireOwner(request, jwtSecret);
  if (response) return response;

  const facilityId = Number(params.facilityId);
  if (!facilityId) {
    return new Response(JSON.stringify({ error: 'Invalid facilityId' }), { status: 400 });
  }

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(facilityId)) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const {
    billing_unit = 'per_stay',
    min_hours = 1,
    max_hours = null,
    time_rounding = 'round_up',
    adult_price_usd = null,
    age_rules = null,
    currency = 'USD',
    notes = null,
  } = body;

  // Validate billing_unit
  if (!['per_hour', 'per_day', 'per_stay'].includes(billing_unit)) {
    return new Response(JSON.stringify({ error: 'Invalid billing_unit' }), { status: 400 });
  }
  if (!['round_up', 'round_down', 'nearest'].includes(time_rounding)) {
    return new Response(JSON.stringify({ error: 'Invalid time_rounding' }), { status: 400 });
  }

  // Serialize age_rules to JSON string if object
  let ageRulesStr: string | null = null;
  if (age_rules != null) {
    ageRulesStr = typeof age_rules === 'string' ? age_rules : JSON.stringify(age_rules);
    // Validate JSON
    try { JSON.parse(ageRulesStr); } catch {
      return new Response(JSON.stringify({ error: 'age_rules must be valid JSON' }), { status: 400 });
    }
  }

  try {
    const existing = await db
      .prepare('SELECT id FROM facility_pricing_configs WHERE hotel_id = ?')
      .bind(facilityId)
      .first();

    if (existing) {
      await db.prepare(`
        UPDATE facility_pricing_configs SET
          billing_unit    = ?,
          min_hours       = ?,
          max_hours       = ?,
          time_rounding   = ?,
          adult_price_usd = ?,
          age_rules       = ?,
          currency        = ?,
          notes           = ?,
          updated_at      = datetime('now')
        WHERE hotel_id = ?
      `).bind(
        billing_unit, min_hours, max_hours, time_rounding,
        adult_price_usd, ageRulesStr, currency, notes, facilityId
      ).run();
    } else {
      await db.prepare(`
        INSERT INTO facility_pricing_configs
          (hotel_id, billing_unit, min_hours, max_hours, time_rounding,
           adult_price_usd, age_rules, currency, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        facilityId, billing_unit, min_hours, max_hours, time_rounding,
        adult_price_usd, ageRulesStr, currency, notes
      ).run();
    }

    const saved = await db
      .prepare('SELECT * FROM facility_pricing_configs WHERE hotel_id = ? LIMIT 1')
      .bind(facilityId)
      .first();

    return new Response(JSON.stringify({ success: true, config: saved }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Save failed' }), { status: 500 });
  }
};
