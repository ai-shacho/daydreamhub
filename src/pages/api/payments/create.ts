import type { APIRoute } from 'astro';
import { getAccessToken, createOrder, resolvePayPalConfig } from '../../../lib/paypal';
import { resolveBookingCharge } from '../../../lib/currency';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const { mode: PAYPAL_MODE, clientId: PAYPAL_CLIENT_ID, secret: PAYPAL_SECRET } = resolvePayPalConfig(runtime?.env);

  if (!db || !PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    const missing = [
      !db ? 'DB' : null,
      !PAYPAL_CLIENT_ID ? 'PAYPAL_SANDBOX_CLIENT_ID|PAYPAL_CLIENT_ID' : null,
      !PAYPAL_SECRET ? 'PAYPAL_SANDBOX_SECRET|PAYPAL_SECRET|SECRET' : null,
    ].filter(Boolean);
    console.error('[payments/create] Server configuration error. Missing:', missing.join(', '));
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

  const { plan_id } = body;

  if (!plan_id) {
    return new Response(
      JSON.stringify({ error: 'Missing required field: plan_id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Server-side charge resolution (local price × payment-time rate → USD).
  // Shared with capture.ts via resolveBookingCharge so amounts always match.
  const charge = await resolveBookingCharge(db, plan_id, {
    options: Array.isArray(body.options) ? body.options : [],
    adults: Number(body.adults) || 1,
    children: Number(body.children) || 0,
    infants: Number(body.infants) || 0,
  });

  if (!charge) {
    return new Response(JSON.stringify({ error: 'Plan not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const planName: string = charge.plan.name;
  const totalAmount = charge.totalAmount;

  try {
    const idempotencyKey = crypto.randomUUID();
    const accessToken = await getAccessToken(PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE);
    const orderId = await createOrder(accessToken, totalAmount, PAYPAL_MODE, planName, idempotencyKey);

    // NOTE: No DB write here. Booking is created only after PayPal capture succeeds.
    // The amounts are echoed back so the caller can show/verify exactly what the
    // order was created for, add-ons included.
    return new Response(
      JSON.stringify({
        order_id: orderId,
        amount: totalAmount,
        base_usd: charge.baseUsd,
        options_total_usd: charge.optionsUsd,
        currency: 'USD',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create payment order';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
