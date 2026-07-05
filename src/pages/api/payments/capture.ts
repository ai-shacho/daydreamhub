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
  const PAYPAL_CLIENT_ID = runtime?.env?.PAYPAL_SANDBOX_CLIENT_ID || runtime?.env?.PAYPAL_CLIENT_ID;
  const PAYPAL_SECRET = runtime?.env?.PAYPAL_SANDBOX_SECRET || runtime?.env?.PAYPAL_SECRET;
  const PAYPAL_MODE = 'sandbox';
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

  const { order_id, plan_id, guest_name, guest_email, guest_phone, check_in_date, adults, children, infants, notes } = body;

  if (!order_id || !plan_id || !guest_name || !guest_email || !check_in_date) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch plan to get hotel_id and price
  const plan = await db
    .prepare('SELECT id, hotel_id, name, price_usd FROM plans WHERE id = ?')
    .bind(plan_id)
    .first();

  if (!plan) {
    return new Response(JSON.stringify({ error: 'Plan not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const price_usd: number = (plan as any).price_usd;
  const hotelId: number = (plan as any).hotel_id;

  // Fee calculation (must match create.ts exactly)
  const processingFee = Math.round(price_usd * 0.06 * 100) / 100;
  const serviceFeeBase = Math.round(price_usd * 0.10 * 100) / 100;
  const serviceFee = serviceFeeBase < 10 ? Math.round((10 - serviceFeeBase) * 100) / 100 : 0;
  const totalAmount = Math.round((price_usd + processingFee + serviceFee) * 100) / 100;

  try {
    const accessToken = await getAccessToken(PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE);
    const captureResult = await captureOrder(accessToken, order_id, PAYPAL_MODE);
    const captureStatus = captureResult.status;

    // Check nested capture status (top-level COMPLETED but nested PENDING is a real PayPal pattern)
    let captureItemStatus: string | null = null;
    try {
      const captures = captureResult.purchase_units?.[0]?.payments?.captures;
      if (captures?.length > 0) captureItemStatus = captures[0].status;
    } catch {}

    // PENDING: payment held for review — do NOT create booking or send any notification
    if (captureStatus === 'PENDING' || captureItemStatus === 'PENDING') {
      return new Response(
        JSON.stringify({
          pending: true,
          order_id,
          paypal_status: captureStatus,
          capture_status: captureItemStatus,
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (captureStatus === 'COMPLETED') {
      let captureId: string | null = null;
      try {
        const pu = captureResult.purchase_units;
        if (pu?.[0]?.payments?.captures?.[0]?.id) {
          captureId = pu[0].payments.captures[0].id;
        }
      } catch {}

      // Insert booking now that PayPal payment is confirmed
      let bookingId: number | null = null;
      try {
        await db
          .prepare(
            `INSERT INTO bookings (
              plan_id, hotel_id, guest_name, guest_email, guest_phone,
              check_in_date, adults, children, infants, total_price_usd,
              status, paypal_order_id, paypal_capture_id, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_confirmation', ?, ?, ?, datetime('now'), datetime('now'))`
          )
          .bind(
            plan_id,
            hotelId,
            guest_name,
            guest_email,
            guest_phone || '',
            check_in_date,
            adults || 1,
            children || 0,
            infants || 0,
            totalAmount,
            order_id,
            captureId,
            notes || ''
          )
          .run();
        const row: any = await db.prepare('SELECT last_insert_rowid() as id').first();
        bookingId = row?.id;
      } catch (dbError) {
        // Payment succeeded at PayPal but DB write failed — log for manual recovery
        console.error(
          `CRITICAL: PayPal capture succeeded (order=${order_id}, capture=${captureId}) but DB INSERT failed. Guest: ${guest_email}`,
          dbError
        );
        return new Response(
          JSON.stringify({
            error: 'Booking record could not be saved. Please contact support with your PayPal order reference: ' + order_id,
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Auto-call for non-partner hotels
      try {
        const hotelForCall = await db.prepare('SELECT email FROM hotels WHERE id = ?').bind(hotelId).first() as any;
        const isPartnerHotel = hotelForCall?.email && hotelForCall.email.trim() !== '';
        if (!isPartnerHotel) {
          const bookingInfo = await getBookingInfoForCall(db, bookingId!);
          if (bookingInfo) {
            await triggerAutoCall(
              {
                DB: db,
                TWILIO_ACCOUNT_SID: runtime?.env?.TWILIO_ACCOUNT_SID || '',
                TWILIO_AUTH_TOKEN: runtime?.env?.TWILIO_AUTH_TOKEN || '',
                TWILIO_FROM_NUMBER: runtime?.env?.TWILIO_FROM_NUMBER || '',
              },
              bookingInfo
            );
          }
        }
      } catch (callError) {
        console.error('Auto-call trigger failed:', callError);
      }

      if (RESEND_API_KEY) {
        const hotel = await db
          .prepare(`SELECT h.name, h.email, h.city, h.country, u.email as owner_login_email
                    FROM hotels h LEFT JOIN users u ON u.email = h.email
                    WHERE h.id = ?`)
          .bind(hotelId)
          .first()
          .catch(() => null);
        const planFull = await db
          .prepare('SELECT name, check_in_time, check_out_time, cancellation_hours FROM plans WHERE id = ?')
          .bind(plan_id)
          .first()
          .catch(() => null);

        // ① Hotel notification email
        if (planFull) {
          try {
            const bookingEmail: string = (hotel as any)?.email || '';
            const ownerLoginEmail: string = (hotel as any)?.owner_login_email || '';
            const notifyEmails = [...new Set([bookingEmail, ownerLoginEmail].filter(Boolean))];
            if (notifyEmails.length > 0) {
              const subject = `New Booking #${bookingId} - ${guest_name} on ${check_in_date}`;
              const emailResult = await sendBookingNotificationToHotel(RESEND_API_KEY, {
                bookingId: bookingId!,
                guestName: guest_name,
                guestEmail: guest_email,
                guestPhone: guest_phone || '',
                checkInDate: check_in_date,
                planName: (planFull as any).name,
                adults: adults || 1,
                children: children || 0,
                infants: infants || 0,
                totalPriceUsd: totalAmount,
                notes: notes || '',
                hotelName: (hotel as any)?.name || '',
                hotelEmail: notifyEmails,
              });
              await logMessage({
                db,
                bookingId: bookingId!,
                hotelId,
                direction: 'outbound',
                recipientEmail: notifyEmails.join(', '),
                senderEmail: 'noreply@daydreamhub.com',
                subject,
                body: `Booking notification for #${bookingId}`,
                status: emailResult.success ? 'sent' : 'failed',
                errorDetail: emailResult.error,
                messageType: 'booking_notification',
              });
            }
          } catch (e) {
            console.error('Hotel notification email failed:', e);
          }
        }

        // ② Admin notification email
        try {
          const ADMIN_EMAIL = runtime?.env?.ADMIN_EMAIL || 'info@daydreamhub.com';
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'DaydreamHub <noreply@daydreamhub.com>',
              to: [ADMIN_EMAIL],
              subject: `[New Booking] #${bookingId} — ${guest_name} / ${(hotel as any)?.name || ''}`,
              html: `<div style="font-family:Arial,sans-serif"><h3>New Booking Received</h3><table style="font-size:14px"><tr><td style="padding:4px 12px 4px 0;color:#888">Booking ID:</td><td>#${bookingId}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Guest:</td><td>${guest_name} (${guest_email})</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Hotel:</td><td>${(hotel as any)?.name || ''}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Plan:</td><td>${(planFull as any)?.name || ''}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Check-in:</td><td>${check_in_date}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Amount:</td><td>$${totalAmount}</td></tr></table></div>`,
            }),
          });
        } catch (e) {
          console.error('Admin notification email failed:', e);
        }

        // ③ Guest confirmation email
        if (guest_email) {
          try {
            const guestEmailResult = await sendGuestBookingConfirmation(RESEND_API_KEY, {
              bookingId: bookingId!,
              guestName: guest_name || '',
              guestEmail: guest_email,
              hotelName: (hotel as any)?.name || '',
              hotelCity: (hotel as any)?.city || '',
              hotelCountry: (hotel as any)?.country || '',
              planName: (planFull as any)?.name || '',
              checkInDate: check_in_date || '',
              checkInTime: (planFull as any)?.check_in_time || '',
              checkOutTime: (planFull as any)?.check_out_time || '',
              adults: adults || 1,
              children: children || 0,
              totalPriceUsd: totalAmount,
              notes: notes,
              cancellationHours: (planFull as any)?.cancellation_hours ?? 24,
            });
            await logMessage({
              db,
              bookingId: bookingId!,
              hotelId,
              direction: 'outbound',
              recipientEmail: guest_email,
              senderEmail: 'noreply@daydreamhub.com',
              subject: `Booking Request Received #${bookingId} — DaydreamHub`,
              body: `Guest booking confirmation for #${bookingId}`,
              status: guestEmailResult.success ? 'sent' : 'failed',
              errorDetail: guestEmailResult.error,
              messageType: 'guest_confirmation',
            });
          } catch (e) {
            console.error('Guest confirmation email failed:', e);
          }
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          booking_id: bookingId,
          status: 'pending_confirmation',
          paypal_status: captureStatus,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } else {
      // PayPal returned non-COMPLETED status
      if (RESEND_API_KEY && guest_email) {
        const planForEmail = await db
          .prepare('SELECT name FROM plans WHERE id = ?')
          .bind(plan_id)
          .first().catch(() => null);
        const hotelForEmail = await db
          .prepare('SELECT name FROM hotels WHERE id = ?')
          .bind(hotelId)
          .first().catch(() => null);
        sendPaymentFailureEmail(RESEND_API_KEY, {
          guestName: guest_name,
          guestEmail: guest_email,
          hotelName: (hotelForEmail as any)?.name || '',
          planName: (planForEmail as any)?.name || '',
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
    const message = error instanceof Error ? error.message : 'Payment capture failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
