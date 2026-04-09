import { getAccessToken, refundCapture } from './paypal';

interface AutoRefundEnv {
  DB: D1Database;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_SECRET: string;
  PAYPAL_MODE?: string;
  RESEND_API_KEY?: string;
  ADMIN_EMAIL?: string;
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
        env.PAYPAL_MODE || 'live'
      );
      await refundCapture(accessToken, booking.paypal_capture_id, env.PAYPAL_MODE || 'live');
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

    // Notify admin about refund failure
    if (env.RESEND_API_KEY) {
      const adminEmail = env.ADMIN_EMAIL || 'info@daydreamhub.com';
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'DaydreamHub <noreply@daydreamhub.com>',
            to: [adminEmail],
            subject: `[REFUND FAILED] Booking #${bookingId} — Manual action required`,
            html: `<div style="font-family:Arial,sans-serif"><h3 style="color:#dc2626">Refund Failed — Manual Action Required</h3><table style="font-size:14px"><tr><td style="padding:4px 12px 4px 0;color:#888">Booking ID:</td><td>#${bookingId}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Amount:</td><td>$${booking.total_price_usd}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Capture ID:</td><td>${booking.paypal_capture_id || 'N/A'}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Reason:</td><td>${reason}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Error:</td><td style="color:#dc2626">${message}</td></tr></table><p style="margin-top:16px;color:#374151">Please process this refund manually via PayPal Dashboard.</p></div>`,
          }),
        });
      } catch {}
    }

    return { refunded: false, error: message };
  }
}
