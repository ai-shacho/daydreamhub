import type { APIRoute } from 'astro';
import { getAccessToken, createOrder } from '../../../lib/paypal';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const PAYPAL_CLIENT_ID = runtime?.env?.PAYPAL_CLIENT_ID;
  const PAYPAL_SECRET = runtime?.env?.PAYPAL_SECRET;
  const PAYPAL_MODE = runtime?.env?.PAYPAL_MODE || 'live';

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

  const {
    plan_id,
    guest_name,
    guest_email,
    guest_phone,
    check_in_date,
    adults = 1,
    children = 0,
    infants = 0,
    notes,
  } = body;

  if (!plan_id || !guest_name || !guest_email || !check_in_date) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: plan_id, guest_name, guest_email, check_in_date' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Step 1: Get plan info (price + hotel_id)
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
  const hotel_id: number = (plan as any).hotel_id;
  const planName: string = (plan as any).name;

  // Fee calculation
  const processingFee = Math.round(price_usd * 0.06 * 100) / 100; // 6% processing fee
  const serviceFeeBase = Math.round(price_usd * 0.10 * 100) / 100; // 10% of plan price
  const serviceFee = serviceFeeBase < 10 ? Math.round((10 - serviceFeeBase) * 100) / 100 : 0; // top-up to $10 if under
  const totalAmount = Math.round((price_usd + processingFee + serviceFee) * 100) / 100;

  try {
    const idempotencyKey = crypto.randomUUID();

    // Step 2: Create PayPal order with total amount (plan + fees)
    const accessToken = await getAccessToken(PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE);
    const orderId = await createOrder(accessToken, totalAmount, PAYPAL_MODE, planName, idempotencyKey);

    // Step 3: Insert booking record with status='pending'
    // [変更前] idempotency_key カラムなし
    // [変更後] idempotency_key を追加（UNIQUE制約により同一キーの二重INSERTはエラーになる）
    const result = await db
      .prepare(
        `INSERT INTO bookings
          (hotel_id, plan_id, guest_name, guest_email, guest_phone, check_in_date,
           adults, children, infants, total_price_usd, notes, status, paypal_order_id,
           idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'), datetime('now'))`
      )
      .bind(
        hotel_id,
        plan_id,
        guest_name,
        guest_email,
        guest_phone || null,
        check_in_date,
        adults,
        children,
        infants,
        totalAmount,
        notes || null,
        orderId,
        idempotencyKey  // [追加] 二重決済防止キー
      )
      .run();

    return new Response(
      JSON.stringify({ order_id: orderId, booking_id: result.meta.last_row_id }),
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
