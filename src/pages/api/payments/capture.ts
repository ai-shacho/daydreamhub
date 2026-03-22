import type { APIRoute } from 'astro';
import { getAccessToken, captureOrder } from '../../../lib/paypal';
import { sendBookingNotificationToHotel, sendGuestBookingConfirmation, sendPaymentFailureEmail } from '../../../lib/email';
import { getBookingInfoForCall, triggerAutoCall } from '../../../lib/autoCall';

async function logMessage(params: {
  db: any;
  bookingId: number;
  hotelId: number;
  direction: string;
  recipientEmail: string;
  senderEmail: string;
  subject: string;
  body: string;
  status: string;
  errorDetail?: string | null;
  messageType: string;
}) {
  try {
    await params.db
      .prepare(
        `INSERT INTO messages (booking_id, hotel_id, direction, recipient_email, sender_email, subject, body, status, error_detail, message_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(
        params.bookingId,
        params.hotelId,
        params.direction,
        params.recipientEmail,
        params.senderEmail,
        params.subject,
        params.body,
        params.status,
        params.errorDetail || null,
        params.messageType
      )
      .run();
  } catch (e) {
    console.error('Failed to log message:', e);
  }
}

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const PAYPAL_CLIENT_ID = runtime?.env?.PAYPAL_CLIENT_ID;
  const PAYPAL_SECRET = runtime?.env?.PAYPAL_SECRET;
  const PAYPAL_MODE = runtime?.env?.PAYPAL_MODE;
  const RESEND_API_KEY = runtime?.env?.RESEND_API_KEY;
  if (!db || !PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { order_id } = body;
  if (!order_id) {
    return new Response(JSON.stringify({ error: 'Missing required field: order_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Step 1: Find the booking by paypal_order_id (existence check only)
  const booking = await db
    .prepare('SELECT * FROM bookings WHERE paypal_order_id = ?')
    .bind(order_id)
    .first();
  if (!booking) {
    return new Response(JSON.stringify({ error: 'Booking not found for this order' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Step 2: Atomic optimistic lock — only advance if status is 'pending'
  // This prevents race conditions: only one request can set status to 'processing'
  const lockResult = await db
    .prepare(
      "UPDATE bookings SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND status = 'pending'"
    )
    .bind((booking as any).id)
    .run();

  if (lockResult.meta.changes === 0) {
    // Another request already grabbed the lock (processing) or payment already done
    return new Response(
      JSON.stringify({ error: 'Payment already captured or is currently being processed' }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Step 3: Execute PayPal capture (we now hold the 'processing' lock)
  try {
    const accessToken = await getAccessToken(PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE || 'sandbox');
    const captureResult = await captureOrder(accessToken, order_id, PAYPAL_MODE || 'sandbox');
    const captureStatus = captureResult.status;

    if (captureStatus === 'COMPLETED') {
      // Step 4 (success): Update to pending_confirmation with capture ID
      let captureId = null;
      try {
        const pu = captureResult.purchase_units;
        if (pu?.[0]?.payments?.captures?.[0]?.id) {
          captureId = pu[0].payments.captures[0].id;
        }
      } catch {}
      await db
        .prepare(
          "UPDATE bookings SET status = 'pending_confirmation', paypal_capture_id = COALESCE(?, paypal_capture_id), updated_at = datetime('now') WHERE id = ?"
        )
        .bind(captureId, (booking as any).id)
        .run();

      try {
        const bookingInfo = await getBookingInfoForCall(db, (booking as any).id);
        if (bookingInfo) {
          await triggerAutoCall(
            {
              DB: db,
              TELNYX_API_KEY: runtime?.env?.TELNYX_API_KEY || '',
              TELNYX_CONNECTION_ID: runtime?.env?.TELNYX_CONNECTION_ID || '',
              TELNYX_FROM_NUMBER: runtime?.env?.TELNYX_FROM_NUMBER || '',
            },
            bookingInfo
          );
        }
      } catch (callError) {
        console.error('Auto-call trigger failed:', callError);
      }

      if (RESEND_API_KEY) {
        try {
          const hotel = await db
            .prepare('SELECT name, email, city, country FROM hotels WHERE id = ?')
            .bind((booking as any).hotel_id)
            .first();
          const plan = await db
            .prepare('SELECT name, check_in_time, check_out_time, cancellation_hours FROM plans WHERE id = ?')
            .bind((booking as any).plan_id)
            .first();
          if (plan) {
            // ① ホテルへ通知メール
            if ((hotel as any)?.email) {
              const subject = `New Booking #${(booking as any).id} - ${(booking as any).guest_name} on ${(booking as any).check_in_date}`;
              const emailResult = await sendBookingNotificationToHotel(RESEND_API_KEY, {
                bookingId: (booking as any).id,
                guestName: (booking as any).guest_name,
                guestEmail: (booking as any).guest_email,
                guestPhone: (booking as any).guest_phone,
                checkInDate: (booking as any).check_in_date,
                planName: (plan as any).name,
                adults: (booking as any).adults,
                children: (booking as any).children,
                infants: (booking as any).infants,
                totalPriceUsd: (booking as any).total_price_usd,
                notes: (booking as any).notes,
                hotelName: (hotel as any).name,
                hotelEmail: (hotel as any).email,
              });
              await logMessage({
                db,
                bookingId: (booking as any).id,
                hotelId: (booking as any).hotel_id,
                direction: 'outbound',
                recipientEmail: (hotel as any).email,
                senderEmail: 'noreply@daydreamhub.com',
                subject,
                body: `Booking notification for #${(booking as any).id}`,
                status: emailResult.success ? 'sent' : 'failed',
                errorDetail: emailResult.error,
                messageType: 'booking_notification',
              });
            }

            // ② ゲストへ予約確認メール
            if ((booking as any).guest_email) {
              const guestEmailResult = await sendGuestBookingConfirmation(RESEND_API_KEY, {
                bookingId: (booking as any).id,
                guestName: (booking as any).guest_name,
                guestEmail: (booking as any).guest_email,
                hotelName: (hotel as any)?.name || '',
                hotelCity: (hotel as any)?.city || '',
                hotelCountry: (hotel as any)?.country || '',
                planName: (plan as any).name,
                checkInDate: (booking as any).check_in_date,
                checkInTime: (plan as any).check_in_time || '',
                checkOutTime: (plan as any).check_out_time || '',
                adults: (booking as any).adults,
                children: (booking as any).children,
                totalPriceUsd: (booking as any).total_price_usd,
                notes: (booking as any).notes,
                cancellationHours: (plan as any).cancellation_hours ?? 24,
              });
              await logMessage({
                db,
                bookingId: (booking as any).id,
                hotelId: (booking as any).hotel_id,
                direction: 'outbound',
                recipientEmail: (booking as any).guest_email,
                senderEmail: 'noreply@daydreamhub.com',
                subject: `Booking Request Received #${(booking as any).id} — DaydreamHub`,
                body: `Guest booking confirmation for #${(booking as any).id}`,
                status: guestEmailResult.success ? 'sent' : 'failed',
                errorDetail: guestEmailResult.error,
                messageType: 'guest_confirmation',
              });
            }
          }
        } catch {}
      }
      return new Response(
        JSON.stringify({
          success: true,
          booking_id: (booking as any).id,
          status: 'pending_confirmation',
          paypal_status: captureStatus,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } else {
      // Step 5 (failure): PayPal returned a non-COMPLETED status — revert to 'failed'
      await db
        .prepare("UPDATE bookings SET status = 'failed', updated_at = datetime('now') WHERE id = ?")
        .bind((booking as any).id)
        .run();

      // Fire-and-forget: send payment failure email to guest
      if (RESEND_API_KEY && (booking as any).guest_email) {
        const plan = await db
          .prepare('SELECT name FROM plans WHERE id = ?')
          .bind((booking as any).plan_id)
          .first().catch(() => null);
        const hotel = await db
          .prepare('SELECT name FROM hotels WHERE id = ?')
          .bind((booking as any).hotel_id)
          .first().catch(() => null);
        sendPaymentFailureEmail(RESEND_API_KEY, {
          guestName: (booking as any).guest_name,
          guestEmail: (booking as any).guest_email,
          hotelName: (hotel as any)?.name || '',
          planName: (plan as any)?.name || '',
          errorMessage: `Payment not completed. PayPal status: ${captureStatus}`,
        }).catch(() => {});
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: `Payment not completed. PayPal status: ${captureStatus}`,
          paypal_result: captureResult,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    // Step 6 (unexpected error): Revert status to 'pending' so the guest can retry
    await db
      .prepare("UPDATE bookings SET status = 'pending', updated_at = datetime('now') WHERE id = ?")
      .bind((booking as any).id)
      .run()
      .catch(() => {});

    const message = error instanceof Error ? error.message : 'Payment capture failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
