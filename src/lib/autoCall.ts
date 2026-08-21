import { callTargetFor } from './callTarget';

const COUNTRY_TIMEZONES: Record<string, string> = {
  // Asia
  'Thailand': 'Asia/Bangkok',
  'Japan': 'Asia/Tokyo',
  'Pakistan': 'Asia/Karachi',
  'India': 'Asia/Kolkata',
  'Philippines': 'Asia/Manila',
  'Vietnam': 'Asia/Ho_Chi_Minh',
  'Indonesia': 'Asia/Jakarta',
  'Malaysia': 'Asia/Kuala_Lumpur',
  'Singapore': 'Asia/Singapore',
  'South Korea': 'Asia/Seoul',
  'China': 'Asia/Shanghai',
  'Taiwan': 'Asia/Taipei',
  'Cambodia': 'Asia/Phnom_Penh',
  'Myanmar': 'Asia/Yangon',
  'Laos': 'Asia/Vientiane',
  'Nepal': 'Asia/Kathmandu',
  'Sri Lanka': 'Asia/Colombo',
  'Bangladesh': 'Asia/Dhaka',
  'UAE': 'Asia/Dubai',
  'United Arab Emirates': 'Asia/Dubai',
  'Saudi Arabia': 'Asia/Riyadh',
  'Turkey': 'Europe/Istanbul',
  // Europe
  'United Kingdom': 'Europe/London',
  'UK': 'Europe/London',
  'France': 'Europe/Paris',
  'Germany': 'Europe/Berlin',
  'Italy': 'Europe/Rome',
  'Spain': 'Europe/Madrid',
  'Netherlands': 'Europe/Amsterdam',
  'Portugal': 'Europe/Lisbon',
  'Greece': 'Europe/Athens',
  'Switzerland': 'Europe/Zurich',
  // Americas
  'United States': 'America/New_York',
  'USA': 'America/New_York',
  'Canada': 'America/Toronto',
  'Mexico': 'America/Mexico_City',
  'Brazil': 'America/Sao_Paulo',
  'Colombia': 'America/Bogota',
  'Argentina': 'America/Buenos_Aires',
  // Oceania
  'Australia': 'Australia/Sydney',
  'New Zealand': 'Pacific/Auckland',
};

function getLocalHour(country: string): number | null {
  const tz = COUNTRY_TIMEZONES[country];
  if (!tz) return null;
  const now = new Date();
  const localTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return localTime.getHours();
}

function isQuietHours(country: string): boolean {
  const hour = getLocalHour(country);
  if (hour === null) return false;
  return hour >= 0 && hour < 5;
}

function getNext5amUtc(country: string): string | null {
  const tz = COUNTRY_TIMEZONES[country];
  if (!tz) return null;
  const now = new Date();
  const localStr = now.toLocaleString('en-US', { timeZone: tz });
  const localNow = new Date(localStr);
  const target = new Date(localNow);
  target.setHours(5, 0, 0, 0);
  if (localNow >= target) {
    target.setDate(target.getDate() + 1);
  }
  const diffMs = target.getTime() - localNow.getTime();
  const utcTarget = new Date(now.getTime() + diffMs);
  return utcTarget.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Which script this call reads.
 *
 * A hotel with an email on file has an owner account, a portal, and a booking
 * email already in its inbox — it needs to be told a booking arrived, not asked
 * whether it does day use. A hotel without one has none of that, so the call is
 * the whole conversation.
 *
 * Deciding it here rather than at each call site means the overnight-queue cron,
 * the alternative-hotel path and the admin re-call button cannot pick a
 * different answer from the one payment capture picked.
 */
export function phaseFor(booking: any): 'notify' | 'booking' {
  return String(booking?.hotel_email || '').trim() ? 'notify' : 'booking';
}

/**
 * Run the listing past callTarget before anything is dialled.
 *
 * `unclassified` is deliberately allowed through. For a hotel with no email the
 * call is the only way it hears about a paid booking at all, so refusing to dial
 * one merely because nobody has classified it yet would strand the guest rather
 * than protect anyone. Everything the classification is actually certain about
 * (a salon, somebody's flat, a listing that is not a real business) still
 * blocks, for both kinds of hotel.
 */
function decideCall(booking: any) {
  const decision = callTargetFor({
    id: Number(booking.hotel_id),
    phone: booking.hotel_phone,
    call_kind: booking.hotel_call_kind,
    country: booking.hotel_country,
  });
  if (decision.call) return decision;
  if (decision.reason === 'unclassified') {
    const to = String(booking.hotel_phone || '').trim();
    if (to) {
      console.log('[autoCall] calling an unclassified listing', { hotel_id: booking.hotel_id, why: decision.why });
      return { call: true as const, to };
    }
  }
  return decision;
}

/** Record a call that was never placed, so it is visible rather than missing. */
async function logSkipped(db: any, booking: any, why: string): Promise<number> {
  const res = await db
    .prepare(
      // No ended_at: the column is present in production but is not in any
      // migration, so a database built from d1/migrations alone would not have
      // it. created_at is enough for a row that is already finished.
      `INSERT INTO call_logs (booking_id, hotel_id, status, attempt_number, error_detail, created_at)
       VALUES (?, ?, 'skipped', 1, ?, datetime('now'))`
    )
    .bind(booking.booking_id, booking.hotel_id, `Not called — ${why}`)
    .run();
  console.log('[autoCall] not calling', { booking_id: booking.booking_id, hotel_id: booking.hotel_id, why });
  return res.meta.last_row_id;
}

export async function triggerAutoCall(env: any, booking: any): Promise<number | null> {
  const db = env.DB;
  const decision = decideCall(booking);
  if (!decision.call) return await logSkipped(db, booking, decision.why);

  const quiet = isQuietHours(booking.hotel_country);
  const scheduledAt = quiet ? getNext5amUtc(booking.hotel_country) : null;
  const status = quiet ? 'queued' : 'calling';
  const result = await db
    .prepare(
      `INSERT INTO call_logs (booking_id, hotel_id, status, attempt_number, scheduled_at, created_at)
       VALUES (?, ?, ?, 1, ?, datetime('now'))`
    )
    .bind(booking.booking_id, booking.hotel_id, status, scheduledAt)
    .run();
  const callLogId = result.meta.last_row_id;
  if (!quiet) {
    await initiateCall(env, callLogId, booking);
  }
  return callLogId;
}

function getPublicBaseUrl(env: any): string {
  const fallback = 'https://daydreamhub.com';
  const raw = String(env?.PUBLIC_BASE_URL || env?.SITE_URL || fallback).trim();
  if (!raw) return fallback;
  return raw.replace(/\/$/, '');
}

export async function initiateCall(env: any, callLogId: number, booking: any): Promise<void> {
  const db = env.DB;
  const baseUrl = getPublicBaseUrl(env);

  // Checked here as well as in triggerAutoCall, because this is the function
  // that actually dials and it has a second caller: the cron that picks up
  // calls deferred overnight. A listing can be reclassified between the two.
  const decision = decideCall(booking);
  if (!decision.call) {
    await db
      .prepare(`UPDATE call_logs SET status = 'skipped', error_detail = ? WHERE id = ?`)
      .bind(`Not called — ${decision.why}`, callLogId)
      .run();
    console.log('[autoCall] not calling', { call_log_id: callLogId, hotel_id: booking?.hotel_id, why: decision.why });
    return;
  }

  try {
    if (!env?.TWILIO_ACCOUNT_SID || !env?.TWILIO_AUTH_TOKEN || !env?.TWILIO_FROM_NUMBER) {
      throw new Error('Twilio env not configured');
    }

    const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    const params = new URLSearchParams();
    params.set('To', decision.to);
    params.set('From', env.TWILIO_FROM_NUMBER);
    // The phase travels in the URL rather than the call_logs row: the webhook
    // reads the query first, and the phase column is not in any migration.
    const phase = phaseFor(booking);
    params.set('Url', `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId}&phase=${phase}`);
    params.set('Method', 'POST');
    params.set('StatusCallback', `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId}&event=status&phase=${phase}`);
    params.set('StatusCallbackMethod', 'POST');
    params.set('Timeout', '120');
    params.set('StatusCallbackEvent', 'initiated');
    params.append('StatusCallbackEvent', 'ringing');
    params.append('StatusCallbackEvent', 'answered');
    params.append('StatusCallbackEvent', 'completed');

    const twilioCallUrl = `https://api.tokyo.us1.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`;
    const dialStartMs = Date.now();
    console.log(`[autoCall] twilio dial start`, { call_log_id: callLogId, booking_id: booking?.booking_id || null, at: new Date(dialStartMs).toISOString() });
    const res = await fetch(twilioCallUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const dialElapsedMs = Date.now() - dialStartMs;
    console.log(`[autoCall] twilio dial finished`, { call_log_id: callLogId, status: res.status, elapsed_ms: dialElapsedMs });
    db.prepare(`INSERT INTO call_log_events (call_log_id, provider, event_type, phase, note, payload_json, created_at)
                VALUES (?1, 'twilio', 'dial_timing', 'booking', ?2, ?3, datetime('now'))`)
      .bind(callLogId, `Twilio dial request completed in ${dialElapsedMs}ms`, JSON.stringify({ elapsed_ms: dialElapsedMs, status: res.status, url: twilioCallUrl }))
      .run()
      .catch(() => {});
    const txt = await res.text();
    const data: any = txt ? JSON.parse(txt) : {};
    if (!res.ok) throw new Error(`Twilio API error: ${res.status} ${txt}`);
    const callId = `twilio:${data?.sid || ''}`;

    await db
      .prepare(
        `UPDATE call_logs SET telnyx_call_id = ?, status = 'calling', started_at = datetime('now') WHERE id = ?`
      )
      .bind(callId, callLogId)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await db
      .prepare(
        `UPDATE call_logs SET status = 'failed', error_detail = ?, ended_at = datetime('now') WHERE id = ?`
      )
      .bind(message, callLogId)
      .run();
  }
}

export async function getBookingInfoForCall(db: any, bookingId: number): Promise<any | null> {
  const row = await db
    .prepare(
      `SELECT b.id as booking_id, b.hotel_id, b.plan_id, b.guest_name, b.check_in_date,
              b.check_in_time, b.check_out_time,
              (b.adults + b.children) as guests,
              h.name as hotel_name, h.phone as hotel_phone, h.country as hotel_country,
              h.call_kind as hotel_call_kind, h.email as hotel_email,
              p.name as plan_name
       FROM bookings b
       LEFT JOIN hotels h ON h.id = b.hotel_id
       LEFT JOIN plans p ON p.id = b.plan_id
       WHERE b.id = ?`
    )
    .bind(bookingId)
    .first();
  if (!row) return null;
  return {
    booking_id: row.booking_id,
    hotel_id: row.hotel_id,
    plan_id: row.plan_id,
    hotel_name: row.hotel_name || 'Hotel',
    hotel_phone: row.hotel_phone || '',
    hotel_country: row.hotel_country || '',
    hotel_call_kind: row.hotel_call_kind || '',
    hotel_email: row.hotel_email || '',
    guest_name: row.guest_name || 'Guest',
    check_in_date: row.check_in_date || '',
    check_in_time: row.check_in_time || '',
    check_out_time: row.check_out_time || '',
    guests: row.guests || 1,
    plan_name: row.plan_name || 'Room',
  };
}
