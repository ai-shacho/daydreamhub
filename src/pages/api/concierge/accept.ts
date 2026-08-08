import type { APIRoute } from 'astro';
import { getAccessToken, createOrder, captureOrder, resolvePayPalConfig } from '../../../lib/paypal';
import { initiateCall } from '../../../lib/tools';
import { currencyForPhone } from '../../../lib/phoneCurrency';

// Two-call model — guest accepts the quote from call 1. Collect the $7 DDH fee
// via PayPal, then trigger call 2 (a fresh concierge_calls row in call_mode
// 'confirm') to finalize the booking with the hotel. Room price is paid on-site.
const CALL_FEE_USD = 7;
const json = { 'Content-Type': 'application/json' };

function parseDetails(raw: unknown): any { try { return JSON.parse(String(raw || '{}')); } catch { return {}; } }

async function findByToken(db: any, token: string): Promise<any> {
  return await db.prepare(
    `SELECT c.*, g.session_id AS group_session FROM concierge_calls c
       LEFT JOIN concierge_call_groups g ON g.id = c.call_group_id
      WHERE c.accept_token = ? LIMIT 1`
  ).bind(token).first().catch(() => null);
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json }); }
  const action = String(body.action || '');
  const token = String(body.token || '').trim();
  if (!token) return new Response(JSON.stringify({ error: 'token required' }), { status: 400, headers: json });

  const call = await findByToken(db, token);
  if (!call) return new Response(JSON.stringify({ error: 'Quote not found' }), { status: 404, headers: json });
  const currency = currencyForPhone(call.hotel_phone).currency || 'USD';
  const details = parseDetails(call.request_details);
  const origin = new URL(request.url).origin;

  if (action === 'info') {
    return new Response(JSON.stringify({
      hotel_name: call.hotel_name,
      price: call.price_quoted,
      currency,
      date: details.check_in_date || details.date || '',
      check_in: details.check_in_time || details.check_in || '',
      check_out: details.check_out_time || details.check_out || '',
      guests: details.guests || 1,
      fee_usd: CALL_FEE_USD,
      accepted: !!call.guest_accepted_at,
    }), { headers: json });
  }

  const pp = resolvePayPalConfig(env);
  if (!pp.clientId || !pp.secret) {
    return new Response(JSON.stringify({ error: 'Payment service not available' }), { status: 503, headers: json });
  }

  if (action === 'create') {
    if (call.guest_accepted_at) return new Response(JSON.stringify({ error: 'This quote has already been accepted.' }), { status: 409, headers: json });
    const at = await getAccessToken(pp.clientId, pp.secret, pp.mode);
    const returnUrl = `${origin}/concierge/accept?token=${encodeURIComponent(token)}&ppreturn=1`;
    const cancelUrl = `${origin}/concierge/accept?token=${encodeURIComponent(token)}&ppcancel=1`;
    const orderId = await createOrder(at, CALL_FEE_USD, pp.mode, 'DayDreamHub Booking Fee', undefined, { returnUrl, cancelUrl });
    // Remember the order so the return leg can capture without echoing it back.
    await db.prepare(`UPDATE concierge_calls SET paypal_order_id = ?, fee_payment_status = 'pending', updated_at = datetime('now') WHERE id = ?`).bind(orderId, call.id).run().catch(() => {});
    const base = pp.mode === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com';
    return new Response(JSON.stringify({ order_id: orderId, approve_url: `${base}/checkoutnow?token=${orderId}`, amount: CALL_FEE_USD }), { headers: json });
  }

  if (action === 'capture') {
    // Idempotent: already accepted.
    if (call.guest_accepted_at && call.fee_payment_status === 'paid') {
      return new Response(JSON.stringify({ status: 'accepted', idempotent: true }), { headers: json });
    }
    const orderId = String(body.order_id || call.paypal_order_id || '');
    if (!orderId) return new Response(JSON.stringify({ error: 'No pending order for this quote' }), { status: 400, headers: json });

    const at = await getAccessToken(pp.clientId, pp.secret, pp.mode);
    let cap: any;
    try {
      cap = await captureOrder(at, orderId, pp.mode);
    } catch (e: any) {
      const msg = e?.message || '';
      if (/ORDER_ALREADY_CAPTURED|ORDER_COMPLETED|already captured/i.test(msg)) {
        cap = { status: 'COMPLETED' };
      } else if (/PAYER_ACTION_REQUIRED|ORDER_NOT_APPROVED|not approved/i.test(msg)) {
        return new Response(JSON.stringify({ status: 'pending', detail: msg }), { status: 202, headers: json });
      } else {
        throw e;
      }
    }
    if (cap.status !== 'COMPLETED') return new Response(JSON.stringify({ status: 'pending' }), { status: 202, headers: json });
    const captureId = cap.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

    // Claim acceptance exactly once.
    const claim: any = await db.prepare(
      `UPDATE concierge_calls SET guest_accepted_at = datetime('now'), fee_payment_status = 'paid', paypal_capture_id = ?, updated_at = datetime('now')
         WHERE id = ? AND guest_accepted_at IS NULL`
    ).bind(captureId, call.id).run().catch(() => null);
    if (Number(claim?.meta?.changes || 0) === 0) {
      return new Response(JSON.stringify({ status: 'accepted', idempotent: true }), { headers: json });
    }

    // Create call 2 (confirmation) as a fresh record so initiateCall's per-row
    // lock does not block it, and trigger it.
    const sessionId = String(call.session_id || call.group_session || '');
    const maxOrder: any = await db.prepare(`SELECT COALESCE(MAX(call_order), 0) AS m FROM concierge_calls WHERE call_group_id = ?`).bind(call.call_group_id).first().catch(() => null);
    const call2Order = Number(maxOrder?.m || call.call_order || 1) + 1;
    const details2 = { ...details, call_mode: 'confirm', confirmed_price: call.price_quoted, price_currency: currency };
    const ins: any = await db.prepare(
      `INSERT INTO concierge_calls (session_id, call_group_id, call_order, hotel_name, hotel_phone, hotel_source, hotel_id, request_details, status, guest_name, guest_email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'), datetime('now'))`
    ).bind(sessionId, call.call_group_id, call2Order, call.hotel_name, call.hotel_phone, call.hotel_source, call.hotel_id, JSON.stringify(details2), call.guest_name, call.guest_email).run().catch((e: any) => { console.error('[accept] call2 insert failed', e); return null; });
    const call2Id = Number(ins?.meta?.last_row_id || 0);

    let trigger: any = null;
    if (call2Id) {
      await db.prepare(`UPDATE concierge_call_groups SET status = 'confirming', current_order = ?, updated_at = datetime('now') WHERE id = ?`).bind(call2Order, call.call_group_id).run().catch(() => {});
      trigger = await initiateCall(env, db, sessionId, call2Id).catch((e: any) => { console.error('[accept] call2 trigger failed', e); return null; });
    }
    return new Response(JSON.stringify({ status: 'accepted', call2_id: call2Id || null, call_triggered: String(trigger?.status || '') === 'calling', capture_id: captureId }), { headers: json });
  }

  return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: json });
};
