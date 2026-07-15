import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/apiAuth';

function maskSecret(raw: any): string {
  const value = String(raw || '');
  if (!value) return 'not_set';
  if (value.length <= 6) return `${value.slice(0, 1)}***`;
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

// Force rebuild to reload Cloudflare Worker env vars (cache-bust marker: 2026-07-14-2)
function envProbe(env: any) {
  const callProvider = String(env?.CALL_PROVIDER || '').trim().toLowerCase() || 'auto';
  return {
    call_provider: callProvider,
    twilio: {
      account_sid_set: Boolean(env?.TWILIO_ACCOUNT_SID),
      account_sid_masked: maskSecret(env?.TWILIO_ACCOUNT_SID),
      auth_token_set: Boolean(env?.TWILIO_AUTH_TOKEN),
      from_number_set: Boolean(env?.TWILIO_FROM_NUMBER),
      from_number_masked: maskSecret(env?.TWILIO_FROM_NUMBER),
    },
    telnyx: {
      api_key_set: Boolean(env?.TELNYX_API_KEY),
      connection_id_set: Boolean(env?.TELNYX_CONNECTION_ID),
      from_number_set: Boolean(env?.TELNYX_FROM_NUMBER),
    },
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const { admin, response } = await requireAdmin(request, jwtSecret);
  if (response) return response;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { action } = body;

  // Manual call to a hotel phone number
  if (action === 'dial') {
    const probe = envProbe(env);
    const { to_number, hotel_id, note } = body;
    if (!to_number) {
      return new Response(JSON.stringify({ success: false, error: 'to_number is required', probe }), { status: 400 });
    }
    if (!env?.TWILIO_ACCOUNT_SID || !env?.TWILIO_AUTH_TOKEN || !env?.TWILIO_FROM_NUMBER) {
      return new Response(JSON.stringify({ success: false, error: 'Twilio not configured', probe }), { status: 503 });
    }

    const baseUrl = String(env?.PUBLIC_BASE_URL || env?.SITE_URL || 'https://daydreamhub.com').replace(/\/$/, '');

    let callLogId: number | null = null;
    try {
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
          `).bind(callLogId, `Admin dial request to ${to_number}`, JSON.stringify({ to_number, hotel_id, note: note || null, probe })).run().catch(() => {});
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
      params.set('Timeout', '120');
      params.set('StatusCallbackEvent', 'initiated');
      params.append('StatusCallbackEvent', 'ringing');
      params.append('StatusCallbackEvent', 'answered');
      params.append('StatusCallbackEvent', 'completed');

      const twilioCallUrl = `https://api.tokyo.us1.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`;
      const dialStartMs = Date.now();
      const twilioReqSummary = {
        url: `https://api.tokyo.us1.twilio.com/2010-04-01/Accounts/${maskSecret(env.TWILIO_ACCOUNT_SID)}/Calls.json`,
        to: to_number,
        from: maskSecret(env.TWILIO_FROM_NUMBER),
        callback_url: `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId || ''}&event=status`,
      };

      console.log(`[admin/call] twilio dial start`, { call_log_id: callLogId, to_number, at: new Date(dialStartMs).toISOString() });
      const res = await fetch(twilioCallUrl, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const dialElapsedMs = Date.now() - dialStartMs;
      console.log(`[admin/call] twilio dial finished`, { call_log_id: callLogId, status: res.status, elapsed_ms: dialElapsedMs });
      if (db && callLogId) {
        db.prepare(`
          INSERT INTO call_log_events (call_log_id, provider, event_type, phase, note, payload_json, created_at)
          VALUES (?1, 'twilio', 'dial_timing', 'booking', ?2, ?3, datetime('now'))
        `).bind(callLogId, `Twilio dial request completed in ${dialElapsedMs}ms`, JSON.stringify({ elapsed_ms: dialElapsedMs, status: res.status, url: twilioReqSummary.url })).run().catch(() => {});
      }
      const text = await res.text();
      let providerBody: any = null;
      try {
        providerBody = text ? JSON.parse(text) : {};
      } catch {
        providerBody = { raw_text: text };
      }

      if (!res.ok) {
        const details = {
          provider: 'twilio',
          provider_status: res.status,
          provider_status_text: res.statusText,
          provider_error_code: providerBody?.code || null,
          provider_error_message: providerBody?.message || null,
          provider_more_info: providerBody?.more_info || null,
          provider_response: providerBody,
          request: twilioReqSummary,
          probe,
          call_log_id: callLogId,
        };
        if (db && callLogId) {
          await db.prepare(`
            INSERT INTO call_log_events (call_log_id, provider, event_type, phase, note, payload_json, created_at)
            VALUES (?1, 'twilio', 'dial_rejected', 'booking', ?2, ?3, datetime('now'))
          `).bind(callLogId, `Twilio rejected dial request: HTTP ${res.status}`, JSON.stringify(details)).run().catch(() => {});
        }
        return new Response(JSON.stringify({ success: false, error: 'Twilio dial failed', details }), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      callSid = providerBody?.sid || null;

      if (db && callSid && callLogId) {
        await db.prepare(`UPDATE call_logs SET telnyx_call_id = ?, last_event_type='dial_accepted', updated_at=datetime('now') WHERE id = ?`)
          .bind(`twilio:${callSid}`, callLogId).run();
        await db.prepare(`
          INSERT INTO call_log_events (call_log_id, provider, event_type, phase, call_sid, note, payload_json, created_at)
          VALUES (?1, 'twilio', 'dial_accepted', 'booking', ?2, ?3, ?4, datetime('now'))
        `).bind(callLogId, callSid, 'Twilio accepted outbound call request', JSON.stringify({ sid: callSid, to_number, request: twilioReqSummary, probe })).run().catch(() => {});
      }

      return new Response(JSON.stringify({
        success: true,
        call_sid: callSid,
        log_id: callLogId,
        provider: 'twilio',
        provider_status: res.status,
        provider_response: {
          sid: providerBody?.sid || null,
          status: providerBody?.status || null,
          queue_time: providerBody?.queue_time || null,
        },
        probe,
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e: any) {
      const errorDetails = {
        provider: 'twilio',
        error_name: e?.name || 'Error',
        error_message: e?.message || String(e),
        stack: String(e?.stack || '').split('\n').slice(0, 5).join('\n'),
        call_log_id: callLogId,
        probe,
      };
      if (db && callLogId) {
        await db.prepare(`
          INSERT INTO call_log_events (call_log_id, provider, event_type, phase, note, payload_json, created_at)
          VALUES (?1, 'twilio', 'dial_exception', 'booking', ?2, ?3, datetime('now'))
        `).bind(callLogId, 'Exception thrown while dialing Twilio', JSON.stringify(errorDetails)).run().catch(() => {});
      }
      return new Response(JSON.stringify({ success: false, error: 'Dial exception', details: errorDetails }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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
      CALL_PROVIDER: env?.CALL_PROVIDER || 'auto',
      probe: envProbe(env),
    };
    return new Response(JSON.stringify(cfg), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
};