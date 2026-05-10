import type { APIRoute } from 'astro';
import { sendWelcomeEmail, sendOwnerAccountEmail, sendGuestBookingConfirmation, sendGuestBookingStatusUpdate } from '../../../lib/email';

// Temporary GET endpoint to send test emails of each type
export const GET: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  const runtime = (locals as any).runtime;
  const resendKey = runtime?.env?.RESEND_API_KEY;
  if (!resendKey) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: json });
  }

  const url = new URL(request.url);
  const to = url.searchParams.get('to') || 'daydreamhub.contact@gmail.com';
  const type = url.searchParams.get('type') || 'welcome';
  const results: any[] = [];

  try {
    if (type === 'all' || type === 'welcome') {
      const r = await sendWelcomeEmail(resendKey, { name: 'Test User', email: to });
      results.push({ type: 'welcome', ...r });
    }
    if (type === 'all' || type === 'owner_account') {
      const r = await sendOwnerAccountEmail(resendKey, { name: 'Test Hotel Owner', email: to, password: 'DemoPass123!' });
      results.push({ type: 'owner_account', ...r });
    }
    if (type === 'all' || type === 'booking_confirm') {
      const r = await sendGuestBookingConfirmation(resendKey, {
        bookingId: 999, guestName: 'Test Guest', guestEmail: to,
        hotelName: 'Grand Palace Hotel Bangkok', hotelCity: 'Bangkok', hotelCountry: 'Thailand',
        planName: 'Half Day Plan', checkInDate: '2026-04-15', checkInTime: '10:00', checkOutTime: '18:00',
        adults: 2, children: 0, totalPriceUsd: 45,
      });
      results.push({ type: 'booking_confirm', ...r });
    }
    if (type === 'all' || type === 'booking_confirmed') {
      const r = await sendGuestBookingStatusUpdate(resendKey, {
        bookingId: 999, guestName: 'Test Guest', guestEmail: to,
        hotelName: 'Grand Palace Hotel Bangkok', hotelCity: 'Bangkok', hotelCountry: 'Thailand',
        planName: 'Half Day Plan', checkInDate: '2026-04-15', checkInTime: '10:00', checkOutTime: '18:00',
        adults: 2, children: 0, totalPriceUsd: 45, status: 'confirmed',
      });
      results.push({ type: 'booking_confirmed', ...r });
    }
    if (type === 'all' || type === 'booking_cancelled') {
      const r = await sendGuestBookingStatusUpdate(resendKey, {
        bookingId: 999, guestName: 'Test Guest', guestEmail: to,
        hotelName: 'Grand Palace Hotel Bangkok', hotelCity: 'Bangkok', hotelCountry: 'Thailand',
        planName: 'Half Day Plan', checkInDate: '2026-04-15', checkInTime: '10:00', checkOutTime: '18:00',
        adults: 2, children: 0, totalPriceUsd: 45, status: 'cancelled',
      });
      results.push({ type: 'booking_cancelled', ...r });
    }

    return new Response(JSON.stringify({ results, to }), { headers: json });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: json });
  }
};
