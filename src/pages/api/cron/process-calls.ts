import type { APIRoute } from 'astro';
import { getBookingInfoForCall } from '../../../lib/autoCall';
import { autoRefundBooking } from '../../../lib/autoRefund';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const TELNYX_API_KEY = runtime?.env?.TELNYX_API_KEY;
  const TELNYX_CONNECTION_ID = runtime?.env?.TELNYX_CONNECTION_ID;
  const TELNYX_FROM_NUMBER = runtime?.env?.TELNYX_FROM_NUMBER;
  const CRON_SECRET = runtime?.env?.CRON_SECRET;

  const authHeader = request.headers.get('Authorization');
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!db || !TELNYX_API_KEY || !TELNYX_CONNECTION_ID || !TELNYX_FROM_NUMBER) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const queuedCalls = await db
    .prepare(
      `SELECT cl.id as call_log_id, cl.booking_id, cl.hotel_id, cl.attempt_number
       FROM call_logs cl
       WHERE cl.status = 'queued'
         AND (cl.scheduled_at IS NULL OR cl.scheduled_at <= datetime('now'))
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
          TELNYX_API_KEY,
          TELNYX_CONNECTION_ID,
          TELNYX_FROM_NUMBER,
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
      processed: results.length,
      results,
      expired_refunded: expiredCount,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
