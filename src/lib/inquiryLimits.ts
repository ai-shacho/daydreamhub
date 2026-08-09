// Caps on free AI inquiry calls. They cost telephony while the guest pays
// nothing, so both a per-device and a global daily ceiling apply. A failure
// here must not silently disable the cap, so callers get `ok: false` with the
// error surfaced rather than an optimistic pass.
export interface InquiryLimitStatus {
  allowed: boolean;
  reason: 'ok' | 'session' | 'global' | 'error';
  mine: number;
  all: number;
  perSession: number;
  globalCap: number;
  error?: string;
}

export async function checkInquiryLimits(env: any, db: any, sessionId: string): Promise<InquiryLimitStatus> {
  const perSession = Number(env?.CONCIERGE_DAILY_PER_SESSION || 3);
  const globalCap = Number(env?.CONCIERGE_DAILY_GLOBAL || 150);
  const base = { perSession, globalCap, mine: 0, all: 0 };
  try {
    const mine: any = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM concierge_call_groups
          WHERE session_id = ? AND created_at > datetime('now', '-1 day')`
      )
      .bind(sessionId)
      .first();
    const all: any = await db
      .prepare(`SELECT COUNT(*) AS n FROM concierge_call_groups WHERE created_at > datetime('now', '-1 day')`)
      .first();
    const mineN = Number(mine?.n || 0);
    const allN = Number(all?.n || 0);
    if (mineN >= perSession) return { ...base, mine: mineN, all: allN, allowed: false, reason: 'session' };
    if (allN >= globalCap) return { ...base, mine: mineN, all: allN, allowed: false, reason: 'global' };
    return { ...base, mine: mineN, all: allN, allowed: true, reason: 'ok' };
  } catch (e: any) {
    return { ...base, allowed: true, reason: 'error', error: e?.message || String(e) };
  }
}
