import { getAccessToken, refundCapture } from './paypal';

interface AutoRefundEnv {
  DB: D1Database;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_SECRET: string;
  PAYPAL_MODE?: string;
}

export async function autoRefundBooking(
  env: AutoRefundEnv,
  bookingId: number,
  reason: string
): Promise<{ refunded: boolean; error?: string }> {
  const db = env.DB;

  const booking = await db
    .prepare(`SELECT paypal_order_id, paypal_capture_id, status, total_price_usd FROM bookings WHERE id = ?`)
    .bind(bookingId)
    .first<{ paypal_order_id: string; paypal_capture_id: string; status: string; total_price_usd: number }>();

  if (!booking) {
    return { refunded: false, error: 'Booking not found' };
  }

  if (['refunded', 'cancelled'].includes(booking.status)) {
    return { refunded: false, error: 'Booking already refunded/cancelled' };
  }

  try {
    if (booking.paypal_capture_id) {
      const accessToken = await getAccessToken(
        env.PAYPAL_CLIENT_ID,
        env.PAYPAL_SECRET,
        env.PAYPAL_MODE || 'sandbox'
      );
      await refundCapture(accessToken, booking.paypal_capture_id, env.PAYPAL_MODE || 'sandbox');
    }

    await db
      .prepare(
        `UPDATE bookings SET status = 'refunded', refund_reason = ?, alt_status = NULL, alt_choice_deadline = NULL, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(reason, bookingId)
      .run();

    return { refunded: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Auto-refund failed for booking ${bookingId}:`, message);

    await db
      .prepare(
        `UPDATE bookings SET status = 'cancelled', refund_reason = ?, alt_status = NULL, alt_choice_deadline = NULL, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(`Refund failed: ${message}. Reason: ${reason}`, bookingId)
      .run();

    return { refunded: false, error: message };
  }
}
