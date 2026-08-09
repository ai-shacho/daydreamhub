import type { APIRoute } from 'astro';
import { getVapidKeys, vapidHeader } from '../../../lib/webpush';

// Ops check for the VAPID signing path: pushes to a deliberately invalid FCM
// registration. A 404 means the push service accepted our signature and only
// rejected the subscription; 401/403 would mean the VAPID header is wrong.
export const GET: APIRoute = async ({ request, locals, url }) => {
  const env = (locals as any).runtime?.env;
  // Staging-only diagnostic; refuses to exist in production.
  const isStaging = String(env?.DDH_ENV || '').toLowerCase() === 'staging';
  const secret = env?.CRON_SECRET;
  const authed = secret && request.headers.get('Authorization') === `Bearer ${secret}`;
  if (!isStaging && !authed) return new Response(null, { status: 404 });
  // Also report the live inquiry-limit counters: a broken query there would
  // fail open, so it must be observable.
  const { checkInquiryLimits } = await import('../../../lib/inquiryLimits');
  const limits = await checkInquiryLimits(env, env?.DB, url.searchParams.get('session') || 'ops-probe');

  const keys = await getVapidKeys(env?.DB);
  if (!keys) return new Response(JSON.stringify({ error: 'no keys' }), { status: 500 });

  const endpoint = 'https://fcm.googleapis.com/fcm/send/selftest-invalid-registration';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(keys, new URL(endpoint).origin),
        TTL: '60',
        'Content-Length': '0',
      },
    });
    const text = await res.text().catch(() => '');
    return new Response(
      JSON.stringify({
        status: res.status,
        vapid_accepted: res.status !== 401 && res.status !== 403,
        detail: text.slice(0, 200),
        publicKeyLength: keys.publicKey.length,
        inquiryLimits: limits,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
