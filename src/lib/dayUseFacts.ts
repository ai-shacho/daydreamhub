// Memory of what AI calls established about unlisted hotels.
//
// A hotel that told us "we don't do day-use" should stop appearing in search
// results — showing an option the guest cannot use is noise — and should never
// cost us another call. A hotel that does day-use but was full keeps its 'yes'
// (it is still a usable option, and a listing lead).

// Facts expire so the inventory does not shrink permanently: policies change,
// and a single "no" may have come from someone who simply did not know.
export const FACT_TTL_DAYS = 180;

export function phoneKey(phone: string | null | undefined): string {
  return String(phone || '').replace(/\D/g, '');
}

export interface DayUseFact {
  day_use: 'yes' | 'no';
  last_price: number | null;
  last_currency: string | null;
  last_verified_at: string;
}

// Records what a finished call taught us. Reasons come from the webhook:
//   hotel_declined_dayuse  → they do not offer it at all      → 'no'
//   hotel_no_availability  → they do offer it, just not then  → 'yes'
// Anything inconclusive (no answer, failed call) is deliberately not stored.
export async function recordDayUseFact(
  db: any,
  params: { phone: string; hotelName?: string | null; outcome: string; reason?: string | null; price?: number | null; currency?: string | null }
): Promise<void> {
  const key = phoneKey(params.phone);
  if (!db || key.length < 6) return;

  const reason = String(params.reason || '');
  let dayUse: 'yes' | 'no' | null = null;
  if (['booked', 'available', 'quoted', 'over_budget'].includes(params.outcome)) {
    dayUse = 'yes';
  } else if (params.outcome === 'unavailable') {
    if (reason.includes('declined_dayuse')) dayUse = 'no';
    else if (reason.includes('no_availability')) dayUse = 'yes';
  }
  if (!dayUse) return;

  try {
    await db
      .prepare(
        `INSERT INTO hotel_day_use_facts (phone_key, hotel_name, day_use, last_price, last_currency, verify_count, last_verified_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
         ON CONFLICT(phone_key) DO UPDATE SET
           hotel_name = COALESCE(excluded.hotel_name, hotel_name),
           day_use = excluded.day_use,
           last_price = COALESCE(excluded.last_price, last_price),
           last_currency = COALESCE(excluded.last_currency, last_currency),
           verify_count = verify_count + 1,
           last_verified_at = datetime('now'),
           updated_at = datetime('now')`
      )
      .bind(key, params.hotelName || null, dayUse, params.price ?? null, params.currency || null)
      .run();
  } catch (e) {
    console.error('[dayUseFacts] record failed', e);
  }
}

// Facts for a batch of phone numbers, expired ones excluded.
export async function getDayUseFacts(db: any, phones: string[]): Promise<Record<string, DayUseFact>> {
  const keys = [...new Set(phones.map(phoneKey).filter((k) => k.length >= 6))];
  if (!db || !keys.length) return {};
  try {
    const placeholders = keys.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT phone_key, day_use, last_price, last_currency, last_verified_at
           FROM hotel_day_use_facts
          WHERE phone_key IN (${placeholders})
            AND last_verified_at > datetime('now', '-${FACT_TTL_DAYS} days')`
      )
      .bind(...keys)
      .all();
    const out: Record<string, DayUseFact> = {};
    for (const r of (rows.results || []) as any[]) out[r.phone_key] = r;
    return out;
  } catch (e) {
    console.error('[dayUseFacts] lookup failed', e);
    return {};
  }
}
