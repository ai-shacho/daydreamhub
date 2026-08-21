import type { APIRoute } from 'astro';
import { getBookingInfoForCall } from '../../../lib/autoCall';
import { autoRefundBooking } from '../../../lib/autoRefund';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const TWILIO_ACCOUNT_SID = runtime?.env?.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = runtime?.env?.TWILIO_AUTH_TOKEN;
  const TWILIO_FROM_NUMBER = runtime?.env?.TWILIO_FROM_NUMBER;
  const CRON_SECRET = runtime?.env?.CRON_SECRET;

  const authHeader = request.headers.get('Authorization');
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!db || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ?dry_run=1 reports what would be dialled and writes nothing. This endpoint
  // has never been on a schedule, so the first live run needs to be looked at
  // before it happens rather than after.
  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';

  // A queued call is only worth placing while the booking it is about still
  // lies ahead. This endpoint has never run, so anything already queued has
  // been sitting there since it was written — ringing a hotel about a stay that
  // came and went would be worse than never ringing at all. Those rows are
  // closed off rather than dialled.
  const STILL_WORTH_CALLING = `
        AND b.id IS NOT NULL
        AND COALESCE(b.status, '') NOT IN ('cancelled', 'refunded', 'completed', 'no_show')
        AND (b.check_in_date IS NULL OR b.check_in_date >= date('now'))`;

  const stale = await db
    .prepare(
      `SELECT cl.id, cl.booking_id, b.check_in_date, b.status as booking_status
         FROM call_logs cl
         LEFT JOIN bookings b ON b.id = cl.booking_id
        WHERE cl.status = 'queued'
          AND NOT (1 = 1 ${STILL_WORTH_CALLING})
        LIMIT 50`
    )
    .all();

  const stood_down: any[] = [];
  for (const row of (stale as any).results) {
    const why = !row.check_in_date
      ? `booking ${row.booking_id} is gone`
      : `booking ${row.booking_id} is ${row.booking_status || 'unknown'} and its check-in (${row.check_in_date}) has passed`;
    if (!dryRun) {
      await db
        .prepare(`UPDATE call_logs SET status = 'skipped', error_detail = ? WHERE id = ?`)
        .bind(`Not called — ${why}`, row.id)
        .run();
    }
    stood_down.push({ call_log_id: row.id, why });
  }

  const queuedCalls = await db
    .prepare(
      `SELECT cl.id as call_log_id, cl.booking_id, cl.hotel_id, cl.attempt_number
       FROM call_logs cl
       JOIN bookings b ON b.id = cl.booking_id
       WHERE cl.status = 'queued'
         AND (cl.scheduled_at IS NULL OR cl.scheduled_at <= datetime('now'))
         ${STILL_WORTH_CALLING}
       ORDER BY cl.scheduled_at ASC
       LIMIT 5`
    )
    .all();

  const results: any[] = [];
  for (const row of (queuedCalls as any).results) {
    const callLogId = row.call_log_id;
    const bookingId = row.booking_id;
    try {
      const { initiateCall } = await import('../../../lib/autoCall');
      const bookingInfo = await getBookingInfoForCall(db, bookingId);
      if (dryRun) {
        results.push({ call_log_id: callLogId, booking_id: bookingId, would_call: bookingInfo?.hotel_phone || null });
        continue;
      }
      if (!bookingInfo || !bookingInfo.hotel_phone) {
        await db
          .prepare(`UPDATE call_logs SET status = 'failed', error_detail = 'No phone number' WHERE id = ?`)
          .bind(callLogId)
          .run();
        results.push({ call_log_id: callLogId, status: 'failed' });
        continue;
      }
      await initiateCall(
        {
          DB: db,
          TWILIO_ACCOUNT_SID,
          TWILIO_AUTH_TOKEN,
          TWILIO_FROM_NUMBER,
          PUBLIC_BASE_URL: runtime?.env?.PUBLIC_BASE_URL,
          SITE_URL: runtime?.env?.SITE_URL,
        },
        callLogId,
        bookingInfo
      );
      results.push({ call_log_id: callLogId, status: 'calling' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await db
        .prepare(`UPDATE call_logs SET status = 'failed', error_detail = ? WHERE id = ?`)
        .bind(message, callLogId)
        .run();
      results.push({ call_log_id: callLogId, status: 'failed' });
    }
  }

  const expiredChoices = await db
    .prepare(
      `SELECT id FROM bookings
       WHERE alt_status = 'awaiting_customer_choice'
         AND alt_choice_deadline IS NOT NULL
         AND alt_choice_deadline <= datetime('now')
         AND status NOT IN ('refunded', 'cancelled')
       LIMIT 5`
    )
    .all();

  let expiredCount = 0;
  for (const row of (expiredChoices as any).results) {
    if (dryRun) { expiredCount++; continue; }
    try {
      await autoRefundBooking(
        {
          DB: db,
          PAYPAL_CLIENT_ID: runtime?.env?.PAYPAL_CLIENT_ID || '',
          PAYPAL_SECRET: runtime?.env?.PAYPAL_SECRET || '',
          PAYPAL_MODE: runtime?.env?.PAYPAL_MODE,
        },
        row.id,
        'Customer did not reply within 24 hours'
      );
      expiredCount++;
    } catch (error) {
      console.error('Expired choice refund failed for booking', row.id, error);
    }
  }

  return new Response(
    JSON.stringify({
      dry_run: dryRun,
      processed: results.length,
      results,
      // Queued calls closed off as too late to place, rather than dialled.
      stood_down: stood_down.length,
      stood_down_detail: stood_down,
      [dryRun ? 'would_refund_expired' : 'expired_refunded']: expiredCount,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
