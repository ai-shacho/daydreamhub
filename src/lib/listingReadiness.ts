// A listing may not go public without saying what happens when a guest cancels.
//
// The cancellation rule lives on the plan (plans.cancellation_hours), because
// that is what the hotel page, the booking page and the confirmation email all
// read. The hotel-level free text is optional prose on top of it — several
// hotels have written one that contradicts their own plans, so it is not what
// the gate checks.

export type CancellationGap = { id: number; name: string };

/** Active plans of this hotel that have no cancellation rule set. */
export async function plansMissingCancellationPolicy(
  db: any,
  hotelId: number | string,
): Promise<CancellationGap[]> {
  if (!db) return [];
  const res = await db.prepare(
    `SELECT id, name FROM plans
      WHERE hotel_id = ? AND is_active = 1 AND cancellation_hours IS NULL
      ORDER BY id`
  ).bind(hotelId).all().catch(() => null);
  return ((res?.results || []) as any[]).map((p) => ({ id: Number(p.id), name: String(p.name || `#${p.id}`) }));
}

/** Human-readable reason a listing cannot be published yet, or null if it can. */
export async function publishBlockReason(db: any, hotelId: number | string): Promise<string | null> {
  if (!db) return null;

  const planCount: any = await db.prepare(
    'SELECT COUNT(*) AS n FROM plans WHERE hotel_id = ? AND is_active = 1'
  ).bind(hotelId).first().catch(() => null);
  if (!planCount || Number(planCount.n) === 0) {
    return 'This listing has no active plans yet. Add at least one plan before publishing.';
  }

  const gaps = await plansMissingCancellationPolicy(db, hotelId);
  if (gaps.length) {
    const names = gaps.map((g) => `"${g.name}"`).join(', ');
    return `Set a cancellation policy on every plan before publishing. Missing on: ${names}.`;
  }
  return null;
}

/**
 * Validate a cancellation value coming from a form.
 *
 * Rejects blanks rather than falling back to a default: the old code silently
 * stored 24 for a missing value and 0 — non-refundable — for a cleared field,
 * so an owner could publish terms they never chose.
 */
export function parseCancellationHours(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, error: 'Cancellation policy is required. Enter the number of hours before check-in that a guest can cancel for free, or 0 for non-refundable.' };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { ok: false, error: 'Cancellation policy must be a whole number of hours (0 or more).' };
  }
  if (n > 8760) {
    return { ok: false, error: 'Cancellation policy looks wrong — that is more than a year before check-in.' };
  }
  return { ok: true, value: n };
}
