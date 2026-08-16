import type { APIRoute } from 'astro';
import { sendOwnerBookingReminder, type ReminderStage } from '../../../lib/email';

// Chase owners who have not answered a paid booking request.
//
// The guest's money is already taken at this point, so silence from the hotel
// is the worst state the booking can be in. Reminders go out at 6, 12 and 24
// hours and then stop for good — there is no stage past 24, so a booking still
// unanswered at 30 or 48 hours gets nothing further from the cron.
//
// Idempotent by construction: a stage is only sent if there is no row for
// (booking, stage) in booking_owner_reminders, and the row is written before we
// move on. Running this every hour, or twice by accident, sends nothing extra.
const STAGES: ReminderStage[] = [24, 12, 6];   // highest first, so an older booking gets the more urgent one

// Sending stage N also marks every earlier stage as done. Without this, a
// booking that is already 30 hours old would match all three queries on the
// first run and land three emails in the owner's inbox at once — it should get
// the 24-hour one and nothing else.
async function markSent(db: any, bookingId: number, stage: ReminderStage) {
  for (const s of STAGES.filter((x) => x <= stage)) {
    await db.prepare('INSERT OR IGNORE INTO booking_owner_reminders (booking_id, stage) VALUES (?, ?)')
      .bind(bookingId, s).run().catch(() => {});
  }
}

const json = { 'Content-Type': 'application/json' };

async function logMessage(params: {
  db: any; bookingId: number; hotelId: number; recipientEmail: string;
  subject: string; status: string; errorDetail?: string | null; messageType: string;
}) {
  try {
    await params.db.prepare(
      `INSERT INTO messages (booking_id, hotel_id, direction, recipient_email, sender_email, subject, body, status, error_detail, message_type, created_at)
       VALUES (?, ?, 'outbound', ?, 'noreply@daydreamhub.com', ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      params.bookingId, params.hotelId, params.recipientEmail, params.subject,
      `Owner reminder for #${params.bookingId}`, params.status,
      params.errorDetail || null, params.messageType,
    ).run();
  } catch (e) {
    console.error('[booking-reminders] failed to log message:', e);
  }
}

export const POST: APIRoute = async ({ request, url, locals }) => {
  // ?dry_run=1 reports exactly who would be emailed and writes nothing, so the
  // first run on a new environment can be checked before anything is sent.
  const dryRun = url.searchParams.get('dry_run') === '1';
  // ?suppress=79,81 marks those bookings as already reminded and sends nothing.
  // For a booking made while testing against a real hotel: the booking itself
  // stays open, so the hotel can still approve or decline it from the email it
  // already has, but it stops chasing them about a guest who does not exist.
  // Explicit ids only — there is deliberately no "suppress everything".
  const suppress = new Set(
    (url.searchParams.get('suppress') || '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
  // A ceiling on one run. Normal volume is a handful; anything near this means
  // something is wrong, and stopping is better than mailing every owner.
  const MAX_PER_RUN = 50;

  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const CRON_SECRET = runtime?.env?.CRON_SECRET;
  const RESEND_API_KEY = runtime?.env?.RESEND_API_KEY || '';

  const authHeader = request.headers.get('Authorization');
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });
  }
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500, headers: json });
  // Only the sending path needs the mail key. A dry run and a suppression both
  // refuse to send by definition, and blocking them here made the one safe way
  // to inspect this job unusable on any environment without Resend configured.
  if (!RESEND_API_KEY && !dryRun && !suppress.size) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not set' }), { status: 500, headers: json });
  }

  const sent: any[] = [];
  const failed: any[] = [];
  const wouldSend: any[] = [];
  const suppressed: any[] = [];
  // One booking gets at most one email per run. markSent already enforces this
  // by writing the earlier stages, but holding it in memory too means a dry run
  // reports exactly what a real run would send, and a failed write cannot turn
  // into three emails.
  const handled = new Set<number>();

  for (const stage of STAGES) {
    // Awaiting the owner, old enough for this stage, check-in still ahead, and
    // this stage not yet sent. Bookings whose date has already passed are left
    // alone — chasing a hotel over a stay that cannot happen is just noise.
    //
    // Bookings that predate this feature are excluded by migration 054, which
    // pre-recorded every stage for them. Deleting a hotel's rows from
    // booking_owner_reminders is what opts its existing bookings back in.
    const due: any[] = ((await db.prepare(
      `SELECT b.id, b.hotel_id, b.guest_name, b.guest_email, b.guest_phone, b.guest_nationality,
              b.created_at, b.check_in_date, b.adults, b.children, b.infants,
              b.total_price_usd, b.local_currency, b.local_amount, b.fx_rate, b.notes,
              h.name AS hotel_name, h.email AS hotel_email, h.contact_email,
              p.name AS plan_name
         FROM bookings b
         LEFT JOIN hotels h ON h.id = b.hotel_id
         LEFT JOIN plans p ON p.id = b.plan_id
        WHERE b.status IN ('pending_confirmation', 'pending')
          AND b.check_in_date >= date('now')
          AND b.created_at <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1 FROM booking_owner_reminders r
             WHERE r.booking_id = b.id AND r.stage = ?
          )
        ORDER BY b.created_at ASC
        LIMIT 100`
    ).bind(`-${stage} hours`, stage).all().catch((e: any) => {
      console.error('[booking-reminders] query failed', e);
      return null;
    }))?.results) || [];

    for (const b of due) {
      if (handled.has(b.id)) continue;
      if (sent.length + failed.length >= MAX_PER_RUN) {
        console.warn(`[booking-reminders] hit the ${MAX_PER_RUN} cap; remaining bookings wait for the next run`);
        break;
      }
      const recipients = [...new Set([b.hotel_email, b.contact_email].filter(Boolean))];
      if (!recipients.length) {
        // Nowhere to send it. Record the stage anyway so the query does not
        // return this booking on every single run for the rest of its life.
        handled.add(b.id);
        await markSent(db, b.id, stage);
        failed.push({ booking_id: b.id, stage, error: 'no hotel email on file' });
        continue;
      }

      if (suppress.has(b.id)) {
        handled.add(b.id);
        if (!dryRun) await markSent(db, b.id, stage);
        suppressed.push({ booking_id: b.id, stage });
        continue;
      }

      if (dryRun) {
        handled.add(b.id);
        wouldSend.push({ booking_id: b.id, stage, to: recipients, created_at: b.created_at, check_in_date: b.check_in_date });
        continue;
      }

      const options: any[] = ((await db.prepare(
        `SELECT name, pricing_type, quantity, child_quantity, infant_quantity, amount_local, amount_usd
           FROM booking_options WHERE booking_id = ? ORDER BY id`
      ).bind(b.id).all().catch(() => null))?.results) || [];

      const result = await sendOwnerBookingReminder(RESEND_API_KEY, stage, {
        bookingId: b.id,
        guestName: b.guest_name || '',
        guestEmail: b.guest_email || '',
        guestPhone: b.guest_phone || '',
        guestNationality: b.guest_nationality || '',
        checkInDate: b.check_in_date || '',
        planName: b.plan_name || '',
        adults: b.adults || 1,
        children: b.children || 0,
        infants: b.infants || 0,
        totalPriceUsd: b.total_price_usd || 0,
        localCurrency: b.local_currency,
        localAmount: b.local_amount,
        fxRate: b.fx_rate,
        notes: b.notes || '',
        options,
        hotelName: b.hotel_name || '',
        hotelEmail: recipients as string[],
      }).catch((e: any) => ({ success: false, error: e?.message || String(e) }));

      // Recorded whether or not Resend accepted it: a send that keeps failing
      // should show up in the message log, not turn into an hourly retry loop.
      handled.add(b.id);
      await markSent(db, b.id, stage);

      await logMessage({
        db, bookingId: b.id, hotelId: b.hotel_id,
        recipientEmail: recipients.join(', '),
        subject: `Owner reminder (${stage}h) for booking #${b.id}`,
        status: result.success ? 'sent' : 'failed',
        errorDetail: result.success ? null : (result as any).error,
        messageType: `owner_reminder_${stage}h`,
      });

      (result.success ? sent : failed).push({ booking_id: b.id, stage, to: recipients, error: (result as any).error });
    }
  }

  if (dryRun) {
    return new Response(JSON.stringify({
      success: true, dry_run: true, would_send: wouldSend.length, details: wouldSend,
      suppressed: suppressed.length, suppressed_details: suppressed,
    }), { headers: json });
  }

  return new Response(JSON.stringify({
    success: true,
    sent: sent.length,
    failed: failed.length,
    suppressed: suppressed.length,
    details: { sent, failed, suppressed },
  }), { headers: json });
};
