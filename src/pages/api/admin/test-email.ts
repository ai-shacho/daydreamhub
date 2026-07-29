import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/apiAuth';
import {
  sendWelcomeEmail, sendStaffInvitationEmail, sendOwnerAccountEmail,
  sendBookingNotificationToHotel, sendConciergeCallStartedEmail, sendConciergeConfirmation,
  sendGuestBookingStatusUpdate, sendGuestBookingConfirmation, sendPaymentFailureEmail,
  sendConciergeDeclineToGuest, sendListingApprovedEmail, sendConciergeResultEmail,
} from '../../../lib/email';

// Admin-only test-send endpoint. Sends a sample of each email type so we can
// preview exactly what Resend delivers. Open in a browser while logged in as
// admin:  /api/admin/test-email?to=<address>&type=all
// type can be 'all' or a single key from SENDERS below.
export const GET: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';

  const { response } = await requireAdmin(request, jwtSecret);
  if (response) return response;

  const resendKey = env?.RESEND_API_KEY;
  if (!resendKey) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: json });
  }

  const url = new URL(request.url);
  const to = url.searchParams.get('to') || '';
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return new Response(JSON.stringify({ error: 'Provide a valid ?to=<email> address' }), { status: 400, headers: json });
  }
  const type = (url.searchParams.get('type') || 'all').toLowerCase();

  // Realistic multi-currency sample (hotel prices in JPY, settled in USD).
  const common = {
    hotelName: 'Grand Palace Hotel Tokyo', hotelCity: 'Tokyo', hotelCountry: 'Japan',
    planName: 'Half-Day Relax Plan', checkInDate: '2026-08-15', checkInTime: '10:00', checkOutTime: '18:00',
    adults: 2, children: 0,
  };

  const SENDERS: Record<string, () => Promise<any>> = {
    welcome: () => sendWelcomeEmail(resendKey, { name: 'Test User', email: to }),
    staff_invitation: () => sendStaffInvitationEmail(resendKey, { name: 'Test Staff', email: to, staffRole: 'booking_manager', hotelName: common.hotelName, inviterName: 'Owner', invitationLink: 'https://daydreamhub.com/owner' } as any),
    owner_account: () => sendOwnerAccountEmail(resendKey, { name: 'Test Hotel Owner', email: to, password: 'DemoPass123!' }),
    listing_approved: () => sendListingApprovedEmail(resendKey, { ownerName: 'Test Hotel Owner', ownerEmail: to, hotelName: common.hotelName, hotelSlug: 'grand-palace-hotel-tokyo' } as any),
    hotel_booking_notice: () => sendBookingNotificationToHotel(resendKey, {
      bookingId: 9001, guestName: 'Test Guest', guestEmail: to, guestPhone: '+81 80 1234 5678',
      checkInDate: common.checkInDate, planName: common.planName, adults: 2, children: 0, infants: 0,
      totalPriceUsd: 61.04, localCurrency: 'JPY', localAmount: 10000, fxRate: 163.8, notes: 'Late check-in please.',
      hotelName: common.hotelName, hotelEmail: to,
    } as any),
    guest_booking_received: () => sendGuestBookingConfirmation(resendKey, {
      bookingId: 9001, guestName: 'Test Guest', guestEmail: to, ...common,
      totalPriceUsd: 61.04, localCurrency: 'JPY', localAmount: 10000, notes: 'Late check-in please.', cancellationHours: 24,
    } as any),
    guest_booking_confirmed: () => sendGuestBookingStatusUpdate(resendKey, {
      bookingId: 9001, guestName: 'Test Guest', guestEmail: to, ...common, totalPriceUsd: 61.04, localCurrency: 'JPY', localAmount: 10000, status: 'confirmed',
    } as any),
    guest_booking_cancelled: () => sendGuestBookingStatusUpdate(resendKey, {
      bookingId: 9001, guestName: 'Test Guest', guestEmail: to, ...common, totalPriceUsd: 61.04, localCurrency: 'JPY', localAmount: 10000, status: 'cancelled',
    } as any),
    payment_failure: () => sendPaymentFailureEmail(resendKey, {
      guestName: 'Test Guest', guestEmail: to, hotelName: common.hotelName, planName: common.planName,
      errorMessage: 'Card was declined by the issuer.',
    } as any),
    concierge_call_started: () => sendConciergeCallStartedEmail(resendKey, {
      guestName: 'Test Guest', guestEmail: to, hotelNames: [common.hotelName, 'Sakura Stay Shinjuku'],
      date: common.checkInDate, checkIn: common.checkInTime, checkOut: common.checkOutTime, guests: 2,
    } as any),
    concierge_booked: () => sendConciergeConfirmation(resendKey, {
      guestName: 'Test Guest', guestEmail: to, hotelName: common.hotelName, hotelPhone: '+81 3 1234 5678',
      date: common.checkInDate, checkIn: common.checkInTime, checkOut: common.checkOutTime, guests: 2,
      priceQuoted: '8000',
    } as any),
    concierge_declined: () => sendConciergeDeclineToGuest(resendKey, {
      guestName: 'Test Guest', guestEmail: to, hotelName: common.hotelName,
      date: common.checkInDate, checkIn: common.checkInTime, checkOut: common.checkOutTime, guests: 2,
    } as any),
    concierge_result_success: () => sendConciergeResultEmail(resendKey, {
      guestName: 'Test Guest', guestEmail: to, resultType: 'success', hotelName: common.hotelName,
      date: common.checkInDate, checkIn: common.checkInTime, checkOut: common.checkOutTime, guests: 2,
      priceQuoted: '8000', priceCurrency: 'JPY',
    } as any),
    concierge_result_over_budget: () => sendConciergeResultEmail(resendKey, {
      guestName: 'Test Guest', guestEmail: to, resultType: 'over_budget', hotelName: common.hotelName,
      date: common.checkInDate, checkIn: common.checkInTime, checkOut: common.checkOutTime, guests: 2,
      priceQuoted: '15000', priceCurrency: 'JPY',
    } as any),
    concierge_result_all_failed: () => sendConciergeResultEmail(resendKey, {
      guestName: 'Test Guest', guestEmail: to, resultType: 'all_failed',
      date: common.checkInDate, checkIn: common.checkInTime, checkOut: common.checkOutTime, guests: 2,
      attemptedHotels: ['Grand Palace Hotel Tokyo', 'Sakura Stay Shinjuku', 'Tokyo Bay View'],
    } as any),
  };

  const keys = type === 'all' ? Object.keys(SENDERS) : (SENDERS[type] ? [type] : []);
  if (!keys.length) {
    return new Response(JSON.stringify({ error: `Unknown type '${type}'`, available: ['all', ...Object.keys(SENDERS)] }), { status: 400, headers: json });
  }

  const results: any[] = [];
  for (const k of keys) {
    try {
      const r = await SENDERS[k]();
      results.push({ type: k, success: r?.success !== false, error: r?.error || null });
    } catch (e: any) {
      results.push({ type: k, success: false, error: e?.message || String(e) });
    }
  }

  return new Response(JSON.stringify({ to, sent: results.length, results }, null, 2), { headers: json });
};
