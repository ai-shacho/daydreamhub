import { triggerAutoCall, getBookingInfoForCall } from './autoCall';
import { autoRefundBooking } from './autoRefund';
import { sendAltChoiceEmail } from './email';

interface AltHotelEnv {
  DB: D1Database;
  TELNYX_API_KEY: string;
  TELNYX_CONNECTION_ID: string;
  TELNYX_FROM_NUMBER: string;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_SECRET: string;
  PAYPAL_MODE?: string;
  RESEND_API_KEY?: string;
}

export async function handleHotelDecline(
  env: AltHotelEnv,
  bookingId: number,
  failedHotelId: number,
  failedPlanId: number,
  reason: 'declined' | 'no_answer'
): Promise<void> {
  const db = env.DB;

  // Guard: check booking is still in a valid state for alternatives
  const booking = await db
    .prepare(`SELECT status, alt_status, alt_round FROM bookings WHERE id = ?`)
    .bind(bookingId)
    .first<{ status: string; alt_status: string | null; alt_round: number }>();

  if (!booking || ['refunded', 'cancelled', 'confirmed'].includes(booking.status)) {
    return;
  }
  if (booking.alt_status === 'awaiting_customer_choice') {
    return;
  }

  // Record failed attempt
  await db
    .prepare(
      `INSERT INTO booking_hotel_attempts (booking_id, hotel_id, plan_id, outcome)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(booking_id, hotel_id) DO UPDATE SET outcome = excluded.outcome, attempted_at = datetime('now')`
    )
    .bind(bookingId, failedHotelId, failedPlanId, reason)
    .run();

  // Count total attempts
  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM booking_hotel_attempts WHERE booking_id = ?`)
    .bind(bookingId)
    .first<{ cnt: number }>();
  const triedCount = countRow?.cnt || 0;

  // Preserve original hotel/plan on first alternative
  await db
    .prepare(`UPDATE bookings SET original_hotel_id = hotel_id, original_plan_id = plan_id WHERE id = ? AND original_hotel_id IS NULL`)
    .bind(bookingId)
    .run();

  const altRound = booking.alt_round || 0;
  const maxForRound = altRound === 0 ? 3 : 6;

  if (triedCount < maxForRound) {
    const found = await findAndCallNextHotel(env, bookingId);
    if (found) return;
  }

  if (altRound === 0) {
    await askCustomerForRetry(env, bookingId);
  } else {
    await autoRefundBooking(
      { DB: db, PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID, PAYPAL_SECRET: env.PAYPAL_SECRET, PAYPAL_MODE: env.PAYPAL_MODE },
      bookingId,
      'All alternative hotels unavailable'
    );
  }
}

async function findAndCallNextHotel(env: AltHotelEnv, bookingId: number): Promise<boolean> {
  const db = env.DB;

  const booking = await db
    .prepare(
      `SELECT b.id, b.hotel_id, b.plan_id, b.total_price_usd,
              h.city, p.plan_type
       FROM bookings b
       JOIN hotels h ON h.id = b.hotel_id
       JOIN plans p ON p.id = b.plan_id
       WHERE b.id = ?`
    )
    .bind(bookingId)
    .first<{ id: number; hotel_id: number; plan_id: number; total_price_usd: number; city: string; plan_type: string }>();

  if (!booking) return false;

  const alt = await db
    .prepare(
      `SELECT p.id as plan_id, p.hotel_id, h.name as hotel_name, h.phone, h.country,
              p.name as plan_name, p.price_usd
       FROM plans p
       JOIN hotels h ON h.id = p.hotel_id
       WHERE h.city = ?
         AND h.status = 'active'
         AND h.auto_call_enabled = 1
         AND h.phone IS NOT NULL AND h.phone != ''
         AND p.is_active = 1
         AND p.plan_type = ?
         AND p.price_usd <= ? * 1.5
         AND h.id NOT IN (SELECT hotel_id FROM booking_hotel_attempts WHERE booking_id = ?)
       ORDER BY ABS(p.price_usd - ?) ASC
       LIMIT 1`
    )
    .bind(booking.city, booking.plan_type, booking.total_price_usd, bookingId, booking.total_price_usd)
    .first<{ plan_id: number; hotel_id: number; hotel_name: string; phone: string; country: string; plan_name: string; price_usd: number }>();

  if (!alt) return false;

  // Switch booking to new hotel/plan
  await db
    .prepare(`UPDATE bookings SET hotel_id = ?, plan_id = ?, status = 'pending_confirmation', updated_at = datetime('now') WHERE id = ?`)
    .bind(alt.hotel_id, alt.plan_id, bookingId)
    .run();

  // Trigger call to new hotel
  const bookingInfo = await getBookingInfoForCall(db, bookingId);
  if (bookingInfo) {
    await triggerAutoCall(
      {
        DB: db,
        TELNYX_API_KEY: env.TELNYX_API_KEY,
        TELNYX_CONNECTION_ID: env.TELNYX_CONNECTION_ID,
        TELNYX_FROM_NUMBER: env.TELNYX_FROM_NUMBER,
      },
      bookingInfo
    );
  }

  return true;
}

async function askCustomerForRetry(env: AltHotelEnv, bookingId: number): Promise<void> {
  const db = env.DB;

  await db
    .prepare(
      `UPDATE bookings SET alt_status = 'awaiting_customer_choice', alt_choice_deadline = datetime('now', '+24 hours'), status = 'pending_confirmation', updated_at = datetime('now') WHERE id = ?`
    )
    .bind(bookingId)
    .run();

  const info = await db
    .prepare(
      `SELECT b.guest_name, b.guest_email, b.check_in_date, b.total_price_usd, b.paypal_order_id,
              h.city
       FROM bookings b
       JOIN hotels h ON h.id = COALESCE(b.original_hotel_id, b.hotel_id)
       WHERE b.id = ?`
    )
    .bind(bookingId)
    .first<{ guest_name: string; guest_email: string; check_in_date: string; total_price_usd: number; paypal_order_id: string; city: string }>();

  if (info && env.RESEND_API_KEY) {
    await sendAltChoiceEmail(env.RESEND_API_KEY, {
      bookingId,
      guestName: info.guest_name,
      guestEmail: info.guest_email,
      city: info.city,
      checkInDate: info.check_in_date,
      totalPriceUsd: info.total_price_usd,
      baseUrl: 'https://daydreamhub.pages.dev',
      paypalOrderId: info.paypal_order_id,
    });
  }
}

export async function findAndCallNextAlternative(env: AltHotelEnv, bookingId: number): Promise<boolean> {
  const found = await findAndCallNextHotel(env, bookingId);
  if (!found) {
    await autoRefundBooking(
      { DB: env.DB, PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID, PAYPAL_SECRET: env.PAYPAL_SECRET, PAYPAL_MODE: env.PAYPAL_MODE },
      bookingId,
      'No more alternative hotels available'
    );
  }
  return found;
}
