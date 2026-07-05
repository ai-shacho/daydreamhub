import type { APIRoute } from 'astro';
import { getAccessToken, createOrder } from '../../../lib/paypal';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const PAYPAL_CLIENT_ID = runtime?.env?.PAYPAL_SANDBOX_CLIENT_ID || runtime?.env?.PAYPAL_CLIENT_ID;
  // Backward compatibility: some deployments stored sandbox secret as generic SECRET
  const PAYPAL_SECRET = runtime?.env?.PAYPAL_SANDBOX_SECRET || runtime?.env?.PAYPAL_SECRET || runtime?.env?.SECRET;
  const PAYPAL_MODE = 'sandbox';

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

  // Fetch plan info (price only — no guest data needed here)
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
  const planName: string = (plan as any).name;

  // Fee calculation (must match capture.ts exactly)
  const processingFee = Math.round(price_usd * 0.06 * 100) / 100;
  const serviceFeeBase = Math.round(price_usd * 0.10 * 100) / 100;
  const serviceFee = serviceFeeBase < 10 ? Math.round((10 - serviceFeeBase) * 100) / 100 : 0;
  const totalAmount = Math.round((price_usd + processingFee + serviceFee) * 100) / 100;

  try {
    const idempotencyKey = crypto.randomUUID();
    const accessToken = await getAccessToken(PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE);
    const orderId = await createOrder(accessToken, totalAmount, PAYPAL_MODE, planName, idempotencyKey);

    // NOTE: No DB write here. Booking is created only after PayPal capture succeeds.
    return new Response(
      JSON.stringify({ order_id: orderId }),
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
