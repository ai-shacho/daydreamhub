import type { APIRoute } from 'astro';
import { sendBookingNotificationToHotel, sendGuestBookingConfirmation } from '../../../lib/email';
import { getBookingInfoForCall, triggerAutoCall } from '../../../lib/autoCall';
import { resolveBookingCharge } from '../../../lib/currency';

// テスト用PayPalキャプチャシミュレーター
// ?test_pay=1 モード時のみ使用。本番環境では使わないこと。
export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const RESEND_API_KEY = runtime?.env?.RESEND_API_KEY;

  if (!db) {
    return new Response(JSON.stringify({ error: 'DB not available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { plan_id, guest_name, guest_email, guest_phone, check_in_date, adults, children, infants, notes } = body;

  if (!plan_id || !guest_name || !guest_email || !check_in_date) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const plan: any = await db.prepare(`
      SELECT p.*, h.id as hotel_id, h.name as hotel_name, h.email as hotel_email,
             h.phone as hotel_phone, h.city, h.country,
             u.email as hotel_owner_login_email
      FROM plans p JOIN hotels h ON h.id = p.hotel_id
      LEFT JOIN users u ON u.email = h.email
      WHERE p.id = ?1
    `).bind(plan_id).first();

    if (!plan) {
      return new Response(JSON.stringify({ error: 'Plan not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // テスト用PayPal order ID
    const testOrderId = `TEST-${Date.now()}`;

    // Price it the way the real capture does. This used to store the plan
    // price as the booking total, so a test booking recorded a figure the
    // guest would never have been charged — and that figure is what the
    // emails and the admin screens then showed.
    const charge = await resolveBookingCharge(db, plan_id, {
      options: Array.isArray(body.options) ? body.options : [],
      adults: Number(adults) || 1,
      children: Number(children) || 0,
      infants: Number(infants) || 0,
    });
    const totalAmount = charge ? charge.totalAmount : Number(plan.price_usd || 0);

    // 実際のPayPalキャプチャと同じ: status = pending_confirmation
    await db.prepare(`
      INSERT INTO bookings (
        plan_id, hotel_id, guest_name, guest_email, guest_phone,
        check_in_date, adults, children, infants, total_price_usd,
        status, paypal_order_id, paypal_capture_id, notes, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                'pending_confirmation', ?11, ?11, ?12, datetime('now'))
    `).bind(
      plan_id,
      plan.hotel_id,
      guest_name,
      guest_email,
      guest_phone || '',
      check_in_date,
      adults || 1,
      children || 0,
      infants || 0,
      totalAmount,
      testOrderId,
      notes || ''
    ).run();

    const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
    const bookingId = row?.id;

    // Record what was bought, as the real capture does. Without this a test
    // booking is charged for add-ons that appear nowhere afterwards — the
    // hotel cannot see what to prepare, and the line items the guest paid for
    // are missing from every screen.
    if (bookingId && charge && charge.options.length) {
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
        ).run().catch((e: any) => console.error('[test-capture] booking_option insert failed', e));
      }
      await db.prepare('UPDATE bookings SET options_total_usd = ? WHERE id = ?')
        .bind(charge.optionsUsd, bookingId).run().catch(() => {});
    }

    // 自動発信トリガー（実PayPalと同じ）
    // capture.ts と同じく、提携・非提携のどちらも架電する。読む台本の違いは
    // lib/autoCall の phaseFor が予約行から決めるので、ここに分岐は要らない。
    try {
      const bookingInfo = await getBookingInfoForCall(db, bookingId);
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
    } catch (callError) {
      console.error('Auto-call trigger failed (test):', callError);
    }

    // メール送信（実PayPalと同じ）
    if (RESEND_API_KEY) {
      try {
        const notifyEmails = [...new Set([plan.hotel_email, plan.hotel_owner_login_email].filter(Boolean))];
        if (notifyEmails.length > 0) {
          await sendBookingNotificationToHotel(RESEND_API_KEY, {
            bookingId,
            guestName: guest_name,
            guestEmail: guest_email,
            guestPhone: guest_phone || '',
            checkInDate: check_in_date,
            planName: plan.name,
            adults: adults || 1,
            children: children || 0,
            infants: infants || 0,
            totalPriceUsd: totalAmount,
            notes: notes || '',
            hotelName: plan.hotel_name,
            hotelEmail: notifyEmails,
          });
        }
        if (guest_email) {
          await sendGuestBookingConfirmation(RESEND_API_KEY, {
            bookingId,
            guestName: guest_name,
            guestEmail: guest_email,
            hotelName: plan.hotel_name,
            hotelCity: plan.city || '',
            hotelCountry: plan.country || '',
            planName: plan.name,
            checkInDate: check_in_date,
            checkInTime: plan.check_in_time || '',
            checkOutTime: plan.check_out_time || '',
            adults: adults || 1,
            children: children || 0,
            totalPriceUsd: totalAmount,
            notes: notes || '',
            cancellationHours: plan.cancellation_hours ?? 24,
          });
        }
      } catch (emailErr) {
        console.error('Email send failed (test):', emailErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      order_id: testOrderId,
      booking_id: bookingId,
      // Same shape as the real capture, so the client shows one figure either way.
      total_price_usd: totalAmount,
      local_total: charge ? charge.localTotal : null,
      currency: charge ? charge.currency : 'USD',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('Test capture error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Test capture failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
