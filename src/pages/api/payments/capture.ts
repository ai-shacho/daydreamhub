import type { APIRoute } from 'astro';
import { getAccessToken, captureOrder, resolvePayPalConfig } from '../../../lib/paypal';
import { sendBookingNotificationToHotel, sendGuestBookingConfirmation, sendPaymentFailureEmail } from '../../../lib/email';
import { getBookingInfoForCall, triggerAutoCall } from '../../../lib/autoCall';
import { resolveBookingCharge, roundForCurrency } from '../../../lib/currency';

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
  const { mode: PAYPAL_MODE, clientId: PAYPAL_CLIENT_ID, secret: PAYPAL_SECRET } = resolvePayPalConfig(runtime?.env);
  const RESEND_API_KEY = runtime?.env?.RESEND_API_KEY;

  if (!db || !PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    const missing = [
      !db ? 'DB' : null,
      !PAYPAL_CLIENT_ID ? 'PAYPAL_SANDBOX_CLIENT_ID|PAYPAL_CLIENT_ID' : null,
      !PAYPAL_SECRET ? 'PAYPAL_SANDBOX_SECRET|PAYPAL_SECRET|SECRET' : null,
    ].filter(Boolean);
    console.error('[payments/capture] Server configuration error. Missing:', missing.join(', '));
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

  const { order_id, plan_id, guest_name, guest_email, guest_phone, guest_nationality, check_in_date, adults, children, infants, notes } = body;

  if (!order_id || !plan_id || !guest_name || !guest_email || !check_in_date) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Server-side charge resolution — same resolver as create.ts, so the add-ons
  // are re-priced here too rather than trusted from the client.
  const charge = await resolveBookingCharge(db, plan_id, {
    options: Array.isArray(body.options) ? body.options : [],
    adults: Number(adults) || 1,
    children: Number(children) || 0,
    infants: Number(infants) || 0,
  });

  if (!charge) {
    return new Response(JSON.stringify({ error: 'Plan not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const hotelId: number = charge.plan.hotel_id;
  let totalAmount = charge.totalAmount;
  let localTotal = charge.localTotal;

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

      // The amount PayPal actually captured is authoritative. If the fx cache
      // refreshed between create and capture, prefer the captured value and
      // re-derive the local snapshot from it.
      try {
        const capturedValue = Number(captureResult.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value);
        if (Number.isFinite(capturedValue) && capturedValue > 0 && capturedValue !== totalAmount) {
          console.warn(`[payments/capture] captured amount ${capturedValue} differs from recomputed ${totalAmount} (order=${order_id}); using captured value`);
          totalAmount = capturedValue;
          localTotal = charge.currency === 'USD' ? capturedValue : roundForCurrency(capturedValue * charge.fxRate, charge.currency);
        }
      } catch {}

      // Insert booking now that PayPal payment is confirmed
      let bookingId: number | null = null;
      try {
        await db
          .prepare(
            `INSERT INTO bookings (
              plan_id, hotel_id, guest_name, guest_email, guest_phone,
              guest_nationality, check_in_date, adults, children, infants, total_price_usd,
              local_currency, local_amount, fx_rate,
              status, paypal_order_id, paypal_capture_id, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_confirmation', ?, ?, ?, datetime('now'), datetime('now'))`
          )
          .bind(
            plan_id,
            hotelId,
            guest_name,
            guest_email,
            guest_phone || '',
            guest_nationality || null,
            check_in_date,
            adults || 1,
            children || 0,
            infants || 0,
            totalAmount,
            charge.currency,
            localTotal,
            charge.fxRate,
            order_id,
            captureId,
            notes || ''
          )
          .run();
        const row: any = await db.prepare('SELECT last_insert_rowid() as id').first();
        bookingId = row?.id;

        // Record the add-ons at the prices charged, so later edits to an option
        // never rewrite what this guest actually paid.
        if (bookingId && charge.options.length) {
          for (const o of charge.options) {
            await db.prepare(
              `INSERT INTO booking_options (
                 booking_id, option_id, name, pricing_type, currency,
                 unit_price_local, unit_price_usd, child_unit_price_local, child_unit_price_usd,
                 infant_unit_price_local, infant_unit_price_usd,
                 quantity, child_quantity, infant_quantity, amount_local, amount_usd
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              bookingId, o.option_id, o.name, o.pricing_type, charge.currency,
              o.unit_price_local, o.unit_price_usd, o.child_unit_price_local, o.child_unit_price_usd,
              o.infant_unit_price_local, o.infant_unit_price_usd,
              o.quantity, o.child_quantity, o.infant_quantity, o.amount_local, o.amount_usd
            ).run().catch((e: any) => console.error('[capture] booking_option insert failed', e));
          }
          await db.prepare('UPDATE bookings SET options_total_usd = ? WHERE id = ?')
            .bind(charge.optionsUsd, bookingId).run().catch(() => {});
        }
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
          .prepare(`SELECT h.name, h.email, h.contact_email, h.city, h.country, u.email as owner_login_email
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
            // Notify BOTH the booking-management email (予約管理) and the
            // person-in-charge email (担当者), plus the owner login, deduped.
            const bookingEmail: string = (hotel as any)?.email || '';
            const contactEmail: string = (hotel as any)?.contact_email || '';
            const ownerLoginEmail: string = (hotel as any)?.owner_login_email || '';
            const notifyEmails = [...new Set([bookingEmail, contactEmail, ownerLoginEmail].filter(Boolean))];
            if (notifyEmails.length > 0) {
              const subject = `New Booking #${bookingId} - ${guest_name} on ${check_in_date}`;
              const emailResult = await sendBookingNotificationToHotel(RESEND_API_KEY, {
                bookingId: bookingId!,
                guestName: guest_name,
                guestEmail: guest_email,
                guestPhone: guest_phone || '',
                guestNationality: guest_nationality || '',
                checkInDate: check_in_date,
                planName: (planFull as any).name,
                adults: adults || 1,
                children: children || 0,
                infants: infants || 0,
                totalPriceUsd: totalAmount,
                localCurrency: charge.currency,
                localAmount: localTotal,
                fxRate: charge.fxRate,
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

        // ② Admin (DDH) notification email. Always include the monitored DDH
        //    inbox, sanitize ADMIN_EMAIL (secrets synced via `echo` can carry a
        //    trailing newline that makes Resend reject the whole send), and log
        //    the result so delivery is auditable — this used to fail silently.
        try {
          const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
          const adminRaw = String(runtime?.env?.ADMIN_EMAIL || '').trim();
          const adminTo = [...new Set([
            'contact@daydreamhub.com',
            ...(isEmail(adminRaw) ? [adminRaw] : []),
          ])];
          const adminSubject = `[New Booking] #${bookingId} — ${guest_name} / ${(hotel as any)?.name || ''}`;
          const adminRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'DaydreamHub <noreply@daydreamhub.com>',
              to: adminTo,
              subject: adminSubject,
              html: `<div style="font-family:Arial,sans-serif"><h3>New Booking Received</h3><table style="font-size:14px"><tr><td style="padding:4px 12px 4px 0;color:#888">Booking ID:</td><td>#${bookingId}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Guest:</td><td>${guest_name}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Email:</td><td>${guest_email}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Phone:</td><td>${guest_phone || '-'}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Nationality:</td><td>${guest_nationality || '-'}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Hotel:</td><td>${(hotel as any)?.name || ''}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Plan:</td><td>${(planFull as any)?.name || ''}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Check-in:</td><td>${check_in_date}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Amount:</td><td>$${totalAmount}</td></tr></table></div>`,
            }),
          });
          const adminBody: any = await adminRes.json().catch(() => ({}));
          await logMessage({
            db, bookingId: bookingId!, hotelId,
            direction: 'outbound',
            recipientEmail: adminTo.join(', '),
            senderEmail: 'noreply@daydreamhub.com',
            subject: adminSubject,
            body: `Admin booking notification for #${bookingId}`,
            status: adminRes.ok ? 'sent' : 'failed',
            errorDetail: adminRes.ok ? null : (adminBody?.message || `HTTP ${adminRes.status}`),
            messageType: 'admin_booking_notification',
          });
        } catch (e: any) {
          console.error('Admin notification email failed:', e);
          try {
            await logMessage({
              db, bookingId: bookingId!, hotelId, direction: 'outbound',
              recipientEmail: 'contact@daydreamhub.com', senderEmail: 'noreply@daydreamhub.com',
              subject: `[New Booking] #${bookingId}`, body: 'Admin booking notification',
              status: 'failed', errorDetail: e?.message || String(e), messageType: 'admin_booking_notification',
            });
          } catch {}
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
              localCurrency: charge.currency,
              localAmount: localTotal,
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
