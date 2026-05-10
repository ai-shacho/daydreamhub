import type { APIRoute } from 'astro';

async function handleChoice(
  params: Record<string, string | undefined>,
  request: Request,
  locals: any
): Promise<Response> {
  const runtime = locals.runtime;
  const db = runtime?.env?.DB as D1Database | undefined;

  if (!db) {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const bookingId = parseInt(params.id || '', 10);
  if (isNaN(bookingId)) {
    return new Response(JSON.stringify({ error: 'Invalid booking ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const url = new URL(request.url);
  let token = url.searchParams.get('token');
  let choice = url.searchParams.get('choice');
  const locale = url.searchParams.get('locale') || 'en';
  const isGet = request.method === 'GET';

  if (!isGet) {
    try {
      const body = await request.json() as { token?: string; choice?: string };
      token = body.token || token;
      choice = body.choice || choice;
    } catch {}
  }

  if (!token || !choice || !['retry', 'refund'].includes(choice)) {
    return new Response(JSON.stringify({ error: 'Missing token or choice' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const booking = await db
    .prepare(`SELECT paypal_order_id, alt_status, alt_choice_deadline, status FROM bookings WHERE id = ?`)
    .bind(bookingId)
    .first<{ paypal_order_id: string; alt_status: string | null; alt_choice_deadline: string | null; status: string }>();

  if (!booking || booking.paypal_order_id !== token) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  if (booking.alt_status !== 'awaiting_customer_choice') {
    if (isGet) {
      const basePath = locale === 'ja' ? '/ja' : '';
      return Response.redirect(new URL(`${basePath}/booking/confirmation?order=${encodeURIComponent(token)}`, url.origin).toString(), 302);
    }
    return new Response(JSON.stringify({ error: 'Choice no longer available' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  if (booking.alt_choice_deadline && new Date(booking.alt_choice_deadline + 'Z') < new Date()) {
    if (isGet) {
      const basePath = locale === 'ja' ? '/ja' : '';
      return Response.redirect(new URL(`${basePath}/booking/confirmation?order=${encodeURIComponent(token)}`, url.origin).toString(), 302);
    }
    return new Response(JSON.stringify({ error: 'Choice expired' }), { status: 410, headers: { 'Content-Type': 'application/json' } });
  }

  if (choice === 'refund') {
    const { autoRefundBooking } = await import('../../../../lib/autoRefund');
    await autoRefundBooking(
      {
        DB: db,
        PAYPAL_CLIENT_ID: runtime?.env?.PAYPAL_CLIENT_ID || '',
        PAYPAL_SECRET: runtime?.env?.PAYPAL_SECRET || '',
        PAYPAL_MODE: runtime?.env?.PAYPAL_MODE,
      },
      bookingId,
      'Customer chose refund'
    );

    if (isGet) {
      const basePath = locale === 'ja' ? '/ja' : '';
      return Response.redirect(new URL(`${basePath}/booking/confirmation?order=${encodeURIComponent(token)}`, url.origin).toString(), 302);
    }
    return new Response(JSON.stringify({ success: true, action: 'refunded' }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (choice === 'retry') {
    await db
      .prepare(`UPDATE bookings SET alt_status = NULL, alt_round = 1, updated_at = datetime('now') WHERE id = ?`)
      .bind(bookingId)
      .run();

    const { findAndCallNextAlternative } = await import('../../../../lib/alternativeHotel');
    await findAndCallNextAlternative(
      {
        DB: db,
        TELNYX_API_KEY: runtime?.env?.TELNYX_API_KEY || '',
        TELNYX_CONNECTION_ID: runtime?.env?.TELNYX_CONNECTION_ID || '',
        TELNYX_FROM_NUMBER: runtime?.env?.TELNYX_FROM_NUMBER || '',
        PAYPAL_CLIENT_ID: runtime?.env?.PAYPAL_CLIENT_ID || '',
        PAYPAL_SECRET: runtime?.env?.PAYPAL_SECRET || '',
        PAYPAL_MODE: runtime?.env?.PAYPAL_MODE,
        RESEND_API_KEY: runtime?.env?.RESEND_API_KEY,
      },
      bookingId
    );

    if (isGet) {
      const basePath = locale === 'ja' ? '/ja' : '';
      return Response.redirect(new URL(`${basePath}/booking/confirmation?order=${encodeURIComponent(token)}`, url.origin).toString(), 302);
    }
    return new Response(JSON.stringify({ success: true, action: 'retrying' }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Invalid choice' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ params, request, locals }) => handleChoice(params, request, locals);
export const POST: APIRoute = async ({ params, request, locals }) => handleChoice(params, request, locals);
