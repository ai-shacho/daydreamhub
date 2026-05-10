import type { APIRoute } from 'astro';
import { sendBookingNotificationToHotel, sendGuestBookingConfirmation } from '../../../lib/email';
import { getBookingInfoForCall, triggerAutoCall } from '../../../lib/autoCall';

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
             h.phone as hotel_phone, h.city, h.country
      FROM plans p JOIN hotels h ON h.id = p.hotel_id
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
      plan.price_usd,
      testOrderId,
      notes || ''
    ).run();

    const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
    const bookingId = row?.id;

    // 自動発信トリガー（実PayPalと同じ）
    try {
      const bookingInfo = await getBookingInfoForCall(db, bookingId);
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
      console.error('Auto-call trigger failed (test):', callError);
    }

    // メール送信（実PayPalと同じ）
    if (RESEND_API_KEY) {
      try {
        if (plan.hotel_email) {
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
            totalPriceUsd: plan.price_usd,
            notes: notes || '',
            hotelName: plan.hotel_name,
            hotelEmail: plan.hotel_email,
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
            totalPriceUsd: plan.price_usd,
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
