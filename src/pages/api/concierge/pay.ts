import type { APIRoute } from 'astro';
import { getAccessToken, createOrder, captureOrder } from '../../../lib/paypal';
import { initiateNextGroupCall } from '../../../lib/tools';

const CALL_FEE_USD = 7;

async function triggerInitialGroupCallIfNeeded(env: any, db: any, groupId: number) {
  const group: any = await db
    .prepare('SELECT id, current_order, status FROM concierge_call_groups WHERE id = ?')
    .bind(groupId)
    .first();

  if (!group) {
    return { skipped: true, reason: 'group_not_found' };
  }

  // 決済APIの重複呼び出しで2件目以降へ勝手に進まないよう、初回（current_order=0）のみキック。
  if (Number(group.current_order || 0) !== 0) {
    return {
      skipped: true,
      reason: 'already_started',
      current_order: group.current_order,
      status: group.status,
    };
  }

  if (String(group.status || '') === 'success' || String(group.status || '') === 'all_failed') {
    return { skipped: true, reason: 'terminal_group_status', status: group.status };
  }

  const trigger = await initiateNextGroupCall(env, db, Number(groupId));
  return { skipped: false, trigger };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  if (!db || !env?.PAYPAL_CLIENT_ID || !env?.PAYPAL_SECRET) {
    return new Response(JSON.stringify({ error: 'Payment service not available' }), {
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
  const { action, session_id, call_id, group_id, order_id, guest_name, guest_email } = body;
  const mode = env.PAYPAL_MODE || 'live';

  try {
    if (action === 'config') {
      return new Response(
        JSON.stringify({ client_id: env?.PAYPAL_CLIENT_ID || '' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'create') {
      if (!session_id) {
        return new Response(JSON.stringify({ error: 'session_id required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const accessToken = await getAccessToken(env.PAYPAL_CLIENT_ID, env.PAYPAL_SECRET, mode);
      const orderId = await createOrder(
        accessToken,
        CALL_FEE_USD,
        mode,
        'DaydreamHub AI Phone Booking Service'
      );
      return new Response(
        JSON.stringify({ order_id: orderId, amount: CALL_FEE_USD }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'capture') {
      if (!order_id) {
        return new Response(JSON.stringify({ error: 'order_id required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!group_id && !call_id) {
        return new Response(JSON.stringify({ error: 'group_id or call_id required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const accessToken = await getAccessToken(env.PAYPAL_CLIENT_ID, env.PAYPAL_SECRET, mode);
      const captureResult = await captureOrder(accessToken, order_id, mode);
      if (captureResult.status === 'COMPLETED') {
        const captureId =
          captureResult.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;
        if (group_id && session_id) {
          const updateResult = await db
            .prepare(
              `UPDATE concierge_call_groups SET paypal_order_id = ?, paypal_capture_id = ?, payment_status = 'paid', guest_name = ?, guest_email = ?, updated_at = datetime('now') WHERE id = ? AND session_id = ?`
            )
            .bind(order_id, captureId, guest_name || null, guest_email || null, group_id, session_id)
            .run();

          if (!updateResult?.meta?.changes) {
            return new Response(JSON.stringify({ error: 'Group not found for session' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          await db
            .prepare(
              `UPDATE concierge_calls SET guest_name = ?, guest_email = ?, payment_status = 'paid', updated_at = datetime('now') WHERE call_group_id = ?`
            )
            .bind(guest_name || null, guest_email || null, group_id)
            .run();

          const kickoff = await triggerInitialGroupCallIfNeeded(env, db, Number(group_id));
          return new Response(
            JSON.stringify({
              status: 'paid',
              order_id,
              capture_id: captureId,
              group_id,
              call_triggered: !kickoff.skipped,
              trigger_result: kickoff,
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (call_id && session_id) {
          await db
            .prepare(
              `UPDATE concierge_calls SET paypal_order_id = ?, paypal_capture_id = ?, payment_status = 'paid', guest_name = ?, guest_email = ?, updated_at = datetime('now') WHERE id = ? AND session_id = ?`
            )
            .bind(order_id, captureId, guest_name || null, guest_email || null, call_id, session_id)
            .run();
        }
        return new Response(
          JSON.stringify({ status: 'paid', order_id, capture_id: captureId }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ status: 'failed', detail: 'Payment not completed' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('Payment error:', e);
    return new Response(
      JSON.stringify({ error: 'Payment processing failed', detail: e?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
