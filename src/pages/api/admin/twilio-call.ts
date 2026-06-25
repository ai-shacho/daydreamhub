import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

function basicAuthHeader(accountSid: string, authToken: string): string {
  const raw = `${accountSid}:${authToken}`;
  const encoded = btoa(raw);
  return `Basic ${encoded}`;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const accountSid = env?.TWILIO_ACCOUNT_SID;
  const authToken = env?.TWILIO_AUTH_TOKEN;
  const fromNumber = env?.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return new Response(JSON.stringify({
      error: 'Twilio env not configured',
      missing: {
        TWILIO_ACCOUNT_SID: !accountSid,
        TWILIO_AUTH_TOKEN: !authToken,
        TWILIO_FROM_NUMBER: !fromNumber,
      },
    }), { status: 503 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  if (body?.action === 'status') {
    return new Response(JSON.stringify({
      TWILIO_ACCOUNT_SID: accountSid ? `✅ ${String(accountSid).slice(0, 6)}...` : '❌',
      TWILIO_AUTH_TOKEN: authToken ? '✅ Set' : '❌',
      TWILIO_FROM_NUMBER: fromNumber || '❌',
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (body?.action !== 'dial') {
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  }

  const { to_number, hotel_id, note } = body;
  if (!to_number) {
    return new Response(JSON.stringify({ error: 'to_number is required' }), { status: 400 });
  }

  const baseUrl = env?.SITE_URL || 'https://daydreamhub.pages.dev';

  try {
    let callLogId: number | null = null;
    if (db) {
      await db.prepare(`
        INSERT INTO call_logs (hotel_id, status, note, created_at)
        VALUES (?1, 'queued', ?2, datetime('now'))
      `).bind(hotel_id || null, note || `Twilio test call to ${to_number}`).run();
      const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
      callLogId = row?.id || null;
    }

    const twimlUrl = `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId || ''}`;
    const params = new URLSearchParams();
    params.set('To', to_number);
    params.set('From', fromNumber);
    params.set('Url', twimlUrl);
    params.set('Method', 'POST');
    params.set('StatusCallback', `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId || ''}&event=status`);
    params.set('StatusCallbackMethod', 'POST');
    params.set('StatusCallbackEvent', 'initiated');
    params.append('StatusCallbackEvent', 'ringing');
    params.append('StatusCallbackEvent', 'answered');
    params.append('StatusCallbackEvent', 'completed');

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(accountSid, authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (!res.ok) {
      if (db && callLogId) {
        await db.prepare(`UPDATE call_logs SET status='failed', error_detail=? WHERE id=?`)
          .bind(text.slice(0, 1000), callLogId).run().catch(() => {});
      }
      return new Response(JSON.stringify({ error: 'Twilio error', details: data || text }), { status: res.status });
    }

    const callSid = data?.sid || null;
    if (db && callSid && callLogId) {
      await db.prepare(`UPDATE call_logs SET telnyx_call_id=? WHERE id=?`)
        .bind(`twilio:${callSid}`, callLogId).run();
    }

    return new Response(JSON.stringify({
      success: true,
      provider: 'twilio',
      call_sid: callSid,
      log_id: callLogId,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Unknown error' }), { status: 500 });
  }
};
