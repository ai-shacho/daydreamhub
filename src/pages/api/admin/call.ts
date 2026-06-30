import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  if (!env?.TWILIO_ACCOUNT_SID || !env?.TWILIO_AUTH_TOKEN || !env?.TWILIO_FROM_NUMBER) {
    return new Response(JSON.stringify({ error: 'Twilio not configured' }), { status: 503 });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { action } = body;

  // Manual call to a hotel phone number
  if (action === 'dial') {
    const { to_number, hotel_id, note } = body;
    if (!to_number) {
      return new Response(JSON.stringify({ error: 'to_number is required' }), { status: 400 });
    }
    const baseUrl = 'https://daydreamhub.com';

    try {
      let callLogId: number | null = null;
      if (db) {
        await db.prepare(`
          INSERT INTO call_logs (hotel_id, status, note, provider, phase, from_number, to_number, created_at, updated_at)
          VALUES (?1, 'queued', ?2, 'twilio', 'booking', ?3, ?4, datetime('now'), datetime('now'))
        `).bind(hotel_id || null, note || `Call to ${to_number}`, env.TWILIO_FROM_NUMBER, to_number).run();
        const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
        callLogId = row?.id || null;
        if (callLogId) {
          await db.prepare(`
            INSERT INTO call_log_events (call_log_id, provider, event_type, phase, note, payload_json, created_at)
            VALUES (?1, 'twilio', 'dial_requested', 'booking', ?2, ?3, datetime('now'))
          `).bind(callLogId, `Admin dial request to ${to_number}`, JSON.stringify({ to_number, hotel_id, note: note || null })).run().catch(() => {});
        }
      }

      let callSid: string | null = null;
      const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
      const params = new URLSearchParams();
      params.set('To', to_number);
      params.set('From', env.TWILIO_FROM_NUMBER);
      params.set('Url', `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId || ''}`);
      params.set('Method', 'POST');
      params.set('StatusCallback', `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId || ''}&event=status`);
      params.set('StatusCallbackMethod', 'POST');
      params.set('StatusCallbackEvent', 'initiated');
      params.append('StatusCallbackEvent', 'ringing');
      params.append('StatusCallbackEvent', 'answered');
      params.append('StatusCallbackEvent', 'completed');

      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const text = await res.text();
      const data: any = text ? JSON.parse(text) : {};
      if (!res.ok) return new Response(JSON.stringify({ error: 'Twilio error', details: data || text }), { status: res.status });
      callSid = data?.sid || null;

      if (db && callSid && callLogId) {
        await db.prepare(`UPDATE call_logs SET telnyx_call_id = ?, last_event_type='dial_accepted', updated_at=datetime('now') WHERE id = ?`)
          .bind(`twilio:${callSid}`, callLogId).run();
        await db.prepare(`
          INSERT INTO call_log_events (call_log_id, provider, event_type, phase, call_sid, note, payload_json, created_at)
          VALUES (?1, 'twilio', 'dial_accepted', 'booking', ?2, ?3, ?4, datetime('now'))
        `).bind(callLogId, callSid, 'Twilio accepted outbound call request', JSON.stringify({ sid: callSid, to_number })).run().catch(() => {});
      }

      return new Response(JSON.stringify({
        success: true,
        call_sid: callSid,
        log_id: callLogId,
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // Get recent call logs
  if (action === 'logs') {
    if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });
    try {
      const result = await db.prepare(`
        SELECT cl.*, h.name as hotel_name
        FROM call_logs cl
        LEFT JOIN hotels h ON h.id = cl.hotel_id
        ORDER BY cl.created_at DESC LIMIT 50
      `).all();
      return new Response(JSON.stringify({ logs: result?.results || [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // Check Twilio config status
  if (action === 'status') {
    const cfg = {
      TWILIO_ACCOUNT_SID: env?.TWILIO_ACCOUNT_SID ? '✅ Set' : '❌ Not set',
      TWILIO_AUTH_TOKEN: env?.TWILIO_AUTH_TOKEN ? '✅ Set' : '❌ Not set',
      TWILIO_FROM_NUMBER: env?.TWILIO_FROM_NUMBER || '❌ Not set',
    };
    return new Response(JSON.stringify(cfg), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
};
