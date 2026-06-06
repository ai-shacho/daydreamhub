import type { APIRoute } from 'astro';

// ── 時間丸め ──────────────────────────────────────────────────────────
function roundHours(raw: number, mode: string): number {
  if (mode === 'round_up')   return Math.ceil(raw);
  if (mode === 'round_down') return Math.floor(raw);
  return Math.round(raw); // 'nearest'
}

// HH:MM → 分数 (0–1439)
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

// ── 見積もり計算コア ──────────────────────────────────────────────────
function calcQuote(params: {
  plan: any;
  config: any | null;
  checkInTime?: string;
  checkOutTime?: string;
  adults: number;
  children: number;
  infants: number;
  options: { option: any; quantity: number }[];
}): {
  ok: true;
  hours_billed: number | null;
  base_price_usd: number;
  adult_total_usd: number;
  child_total_usd: number;
  infant_total_usd: number;
  options_total_usd: number;
  subtotal_usd: number;
  processing_fee_usd: number;
  service_fee_usd: number;
  total_usd: number;
  breakdown: { label: string; amount_usd: number }[];
} | { ok: false; error: string } {
  const { plan, config, adults, children, infants, options } = params;
  const breakdown: { label: string; amount_usd: number }[] = [];

  let hoursBilled: number | null = null;
  let basePrice = Number(plan.base_price_usd) || 0;

  // ── 従量課金（metered）──
  if (plan.plan_type === 'metered') {
    if (!params.checkInTime || !params.checkOutTime) {
      return { ok: false, error: 'check_in_time and check_out_time required for metered plans' };
    }
    const diffMin = toMinutes(params.checkOutTime) - toMinutes(params.checkInTime);
    if (diffMin <= 0) return { ok: false, error: 'check_out_time must be after check_in_time' };

    const rawHours = diffMin / 60;
    const roundMode = config?.time_rounding || 'round_up';
    hoursBilled = roundHours(rawHours, roundMode);

    const minH = config?.min_hours || 1;
    if (hoursBilled < minH) hoursBilled = minH;
    const maxH = plan.max_hours || config?.max_hours;
    if (maxH && hoursBilled > maxH) return { ok: false, error: `Maximum ${maxH} hours allowed` };

    const ratePerHour = Number(plan.price_per_hour_usd) || basePrice;
    basePrice = ratePerHour * hoursBilled;
    breakdown.push({ label: `Base (${hoursBilled}h × $${ratePerHour.toFixed(2)}/h)`, amount_usd: basePrice });
  } else {
    breakdown.push({ label: `Base price`, amount_usd: basePrice });
  }

  // ── 年齢ルール ──
  let ageRules: any = null;
  if (config?.age_rules) {
    try { ageRules = JSON.parse(config.age_rules); } catch {}
  }

  const adultRate = Number(config?.adult_price_usd) || basePrice;
  const childRate  = ageRules ? adultRate * (Number(ageRules.child_rate)  ?? 1) : adultRate;
  const infantRate = ageRules ? adultRate * (Number(ageRules.infant_rate) ?? 0) : 0;

  // 人数ベース課金は adult_price_usd が設定されている場合のみ
  let adultTotal  = 0;
  let childTotal  = 0;
  let infantTotal = 0;

  if (config?.adult_price_usd != null) {
    adultTotal  = adultRate  * adults;
    childTotal  = childRate  * children;
    infantTotal = infantRate * infants;
    // 人数ベースの場合は base_price を置き換え
    basePrice = 0;
    breakdown[0] = { label: `Base price`, amount_usd: 0 };
    if (adults   > 0) breakdown.push({ label: `Adults ×${adults}`,   amount_usd: adultTotal });
    if (children > 0) breakdown.push({ label: `Children ×${children}`, amount_usd: childTotal });
    if (infants  > 0) breakdown.push({ label: `Infants ×${infants}`,  amount_usd: infantTotal });
  }

  // ── オプション ──
  let optionsTotal = 0;
  for (const { option, quantity } of options) {
    const qty = quantity || 1;
    let price = 0;
    if (option.billing_unit === 'per_person') {
      price = Number(option.price_usd) * (adults + children) * qty;
    } else if (option.billing_unit === 'per_hour') {
      price = Number(option.price_usd) * (hoursBilled || 1) * qty;
    } else {
      price = Number(option.price_usd) * qty;
    }
    optionsTotal += price;
    if (price > 0) breakdown.push({ label: `Option: ${option.name}`, amount_usd: price });
  }

  const subtotal = basePrice + adultTotal + childTotal + infantTotal + optionsTotal;

  // ── 手数料（capture.ts と同一ロジック）──
  const processingFee = Math.round(subtotal * 0.06 * 100) / 100;
  const serviceFeeBase = Math.round(subtotal * 0.10 * 100) / 100;
  const serviceFee = serviceFeeBase < 10 ? Math.round((10 - serviceFeeBase) * 100) / 100 : 0;
  const total = Math.round((subtotal + processingFee + serviceFee) * 100) / 100;

  breakdown.push({ label: 'Processing fee (6%)', amount_usd: processingFee });
  if (serviceFee > 0) breakdown.push({ label: 'Service fee', amount_usd: serviceFee });

  return {
    ok: true,
    hours_billed: hoursBilled,
    base_price_usd: Math.round(basePrice * 100) / 100,
    adult_total_usd: Math.round(adultTotal * 100) / 100,
    child_total_usd: Math.round(childTotal * 100) / 100,
    infant_total_usd: Math.round(infantTotal * 100) / 100,
    options_total_usd: Math.round(optionsTotal * 100) / 100,
    subtotal_usd: Math.round(subtotal * 100) / 100,
    processing_fee_usd: processingFee,
    service_fee_usd: serviceFee,
    total_usd: total,
    breakdown,
  };
}

// ── API ──────────────────────────────────────────────────────────────
export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'DB not available' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    plan_id,
    facility_plan_id,
    check_in_time,
    check_out_time,
    adults = 1,
    children = 0,
    infants = 0,
    options: rawOptions = [],
  } = body;

  if (!plan_id && !facility_plan_id) {
    return new Response(JSON.stringify({ error: 'plan_id or facility_plan_id required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let plan: any;
    let config: any = null;

    if (facility_plan_id) {
      // New facility_plans table
      plan = await db.prepare(`
        SELECT fp.*, fpc.billing_unit, fpc.min_hours, fpc.max_hours as config_max_hours,
               fpc.time_rounding, fpc.adult_price_usd, fpc.age_rules
        FROM facility_plans fp
        LEFT JOIN facility_pricing_configs fpc ON fpc.id = fp.pricing_config_id
        WHERE fp.id = ? AND fp.is_active = 1
      `).bind(facility_plan_id).first();

      if (!plan) {
        return new Response(JSON.stringify({ error: 'Facility plan not found' }), {
          status: 404, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Also load standalone config if plan has hotel_id
      if (!plan.pricing_config_id && plan.hotel_id) {
        config = await db.prepare(
          'SELECT * FROM facility_pricing_configs WHERE hotel_id = ? LIMIT 1'
        ).bind(plan.hotel_id).first();
      } else {
        config = plan; // JOIN fields already merged
      }
    } else {
      // Legacy plans table — treat as fixed plan, no age rules
      plan = await db.prepare(
        'SELECT id, hotel_id, name, price_usd as base_price_usd FROM plans WHERE id = ?'
      ).bind(plan_id).first();

      if (!plan) {
        return new Response(JSON.stringify({ error: 'Plan not found' }), {
          status: 404, headers: { 'Content-Type': 'application/json' },
        });
      }
      plan.plan_type = 'fixed';
    }

    // Load requested options
    const optionList: { option: any; quantity: number }[] = [];
    if (rawOptions.length > 0 && facility_plan_id) {
      const ids = rawOptions.map((o: any) => o.option_id).filter(Boolean);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const rows = await db.prepare(
          `SELECT * FROM facility_plan_options WHERE id IN (${placeholders}) AND plan_id = ? AND is_active = 1`
        ).bind(...ids, facility_plan_id).all();
        for (const row of (rows?.results || [])) {
          const req = rawOptions.find((o: any) => o.option_id === (row as any).id);
          optionList.push({ option: row, quantity: req?.quantity || 1 });
        }
      }
    }

    const result = calcQuote({
      plan,
      config,
      checkInTime: check_in_time,
      checkOutTime: check_out_time,
      adults: Number(adults),
      children: Number(children),
      infants: Number(infants),
      options: optionList,
    });

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('Quote error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Quote calculation failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
