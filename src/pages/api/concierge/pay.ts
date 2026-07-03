import type { APIRoute } from 'astro';
import { getAccessToken, createOrder, captureOrder } from '../../../lib/paypal';
import { initiateNextGroupCall } from '../../../lib/tools';
import { sendConciergeCallStartedEmail } from '../../../lib/email';

const CALL_FEE_USD = 7;

async function sendCallStartedEmailIfPossible(env: any, db: any, groupId: number) {
  const resendKey = env?.RESEND_API_KEY;
  if (!resendKey) return { skipped: true, reason: 'resend_not_configured' };

  const groupRow: any = await db.prepare(
    'SELECT guest_name, guest_email FROM concierge_call_groups WHERE id = ?'
  ).bind(groupId).first();
  const guestEmail = groupRow?.guest_email;
  if (!guestEmail) return { skipped: true, reason: 'guest_email_missing' };

  const callRows = await db.prepare(
    'SELECT hotel_name, request_details FROM concierge_calls WHERE call_group_id = ? ORDER BY call_order ASC'
  ).bind(groupId).all();
  const hotelNames: string[] = ((callRows?.results as any[]) || []).map((r: any) => r.hotel_name || 'Hotel');
  const firstDetails = (() => { try { return JSON.parse((callRows?.results as any[])?.[0]?.request_details || '{}'); } catch { return {}; } })();

  await sendConciergeCallStartedEmail(resendKey, {
    guestName: groupRow?.guest_name || 'Guest',
    guestEmail,
    hotelNames,
    date: firstDetails.check_in_date,
    checkIn: firstDetails.check_in_time,
    checkOut: firstDetails.check_out_time,
    guests: Number(firstDetails.guests || ((firstDetails.adults || 1) + (firstDetails.children || 0))),
  });

  return { skipped: false };
}

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

      if (group_id) {
        const existingGroup: any = await db
          .prepare('SELECT id, session_id, paypal_order_id, paypal_capture_id, payment_status FROM concierge_call_groups WHERE id = ?')
          .bind(group_id)
          .first();
        if (!existingGroup || (session_id && String(existingGroup.session_id || '') !== String(session_id))) {
          return new Response(JSON.stringify({ error: 'Group not found for session' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (existingGroup.payment_status === 'paid' && existingGroup.paypal_order_id === order_id) {
          // 既にpaid済みの再リクエストでは「Calling Hotels Now」メールを再送しない
          const emailResult: any = { skipped: true, reason: 'already_paid_idempotent' };

          const kickoff = await triggerInitialGroupCallIfNeeded(env, db, Number(group_id));
          return new Response(
            JSON.stringify({
              status: 'paid',
              order_id,
              capture_id: existingGroup.paypal_capture_id || null,
              group_id,
              call_triggered: !kickoff.skipped,
              trigger_result: kickoff,
              email_result: emailResult,
              idempotent: true,
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      const accessToken = await getAccessToken(env.PAYPAL_CLIENT_ID, env.PAYPAL_SECRET, mode);
      const captureResult = await captureOrder(accessToken, order_id, mode);
      if (captureResult.status === 'COMPLETED') {
        const captureId =
          captureResult.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;
        if (group_id) {
          const preGroupState: any = await db
            .prepare('SELECT payment_status, session_id FROM concierge_call_groups WHERE id = ?')
            .bind(group_id)
            .first();
          if (!preGroupState || (session_id && String(preGroupState.session_id || '') !== String(session_id))) {
            return new Response(JSON.stringify({ error: 'Group not found for session' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          const wasAlreadyPaid = String(preGroupState?.payment_status || '') === 'paid';

          const updateResult = await db
            .prepare(
              `UPDATE concierge_call_groups SET paypal_order_id = ?, paypal_capture_id = ?, payment_status = 'paid', guest_name = ?, guest_email = ?, updated_at = datetime('now') WHERE id = ?`
            )
            .bind(order_id, captureId, guest_name || null, guest_email || null, group_id)
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

          let emailResult: any = { skipped: true, reason: 'already_paid_before_capture' };
          if (!wasAlreadyPaid) {
            emailResult = { skipped: true, reason: 'not_attempted' };
            try {
              emailResult = await sendCallStartedEmailIfPossible(env, db, Number(group_id));
            } catch (e) {
              console.error('[concierge/pay] call started email failed:', e);
              emailResult = { skipped: true, reason: 'email_failed' };
            }
          }

          const kickoff = await triggerInitialGroupCallIfNeeded(env, db, Number(group_id));
          return new Response(
            JSON.stringify({
              status: 'paid',
              order_id,
              capture_id: captureId,
              group_id,
              call_triggered: !kickoff.skipped,
              trigger_result: kickoff,
              email_result: emailResult,
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
        JSON.stringify({ status: 'pending', detail: 'Payment not completed yet' }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    const message = e?.message || 'Payment processing failed';
    const transient = /PAYER_ACTION_REQUIRED|ORDER_NOT_APPROVED|UNPROCESSABLE_ENTITY|INSTRUMENT_DECLINED|not approved/i.test(message);
    if (transient) {
      return new Response(
        JSON.stringify({ status: 'pending', detail: message }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      );
    }
    console.error('Payment error:', e);
    return new Response(
      JSON.stringify({ error: 'Payment processing failed', detail: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
