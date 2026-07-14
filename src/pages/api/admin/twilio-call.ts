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

function basicAuthHeader(accountSid: string, authToken: string): string {
  const raw = `${accountSid}:${authToken}`;
  const encoded = btoa(raw);
  return `Basic ${encoded}`;
}

const TWILIO_WEBHOOK_BASE_URL = 'https://daydreamhub.com';

function toHttpsOrigin(publicBaseUrl?: string | null, siteUrl?: string | null): string {
  const raw = String(publicBaseUrl || siteUrl || TWILIO_WEBHOOK_BASE_URL).trim();
  if (!raw) return TWILIO_WEBHOOK_BASE_URL;
  return raw.replace(/\/$/, '');
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const { admin, response } = await requireAdmin(request, jwtSecret);
  if (response) return response;

  const probe = envProbe(env);
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
      probe,
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
      probe,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (body?.action !== 'dial') {
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  }

  const toNumber = String(body?.to_number || '').trim();
  const phase = String(body?.phase || 'booking').trim().toLowerCase() === 'outreach' ? 'outreach' : 'booking';
  const hotelId = toPositiveInt(body?.hotel_id);
  const outreachLeadId = toPositiveInt(body?.lead_id);
  const note = String(body?.note || '').trim();

  if (!toNumber) {
    return new Response(JSON.stringify({ error: 'to_number is required', probe }), { status: 400 });
  }

  const conciergeMeta = {
    guest_name: String(body?.guest_name || 'Test Guest').trim() || 'Test Guest',
    guest_count: Math.max(1, Number(body?.guest_count || body?.guests || 1) || 1),
    check_in_date: String(body?.check_in_date || '').trim(),
    check_in_time: String(body?.check_in_time || '').trim(),
    check_out_time: String(body?.check_out_time || '').trim(),
  };

  const baseUrl = toHttpsOrigin(env?.PUBLIC_BASE_URL, env?.SITE_URL);

  try {
    let callLogId: number | null = null;
    let logNote = note || `Twilio test call to ${toNumber}`;

    if (phase === 'outreach') {
      logNote = note || `Twilio outreach test call to ${toNumber}`;
    } else {
      const packed = JSON.stringify(conciergeMeta);
      logNote = `${note || 'Twilio concierge test call'} [booking-test:${packed}]`;
    }

    if (db) {
      await db.prepare(`
        INSERT INTO call_logs (hotel_id, status, note, provider, phase, from_number, to_number, created_at, updated_at)
        VALUES (?1, 'queued', ?2, 'twilio', ?3, ?4, ?5, datetime('now'), datetime('now'))
      `).bind(hotelId, logNote, phase, fromNumber, toNumber).run();
      const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
      callLogId = row?.id || null;

      if (callLogId) {
        await db.prepare(`
          INSERT INTO call_log_events (call_log_id, provider, event_type, phase, note, payload_json, created_at)
          VALUES (?1, 'twilio', 'dial_requested', ?2, ?3, ?4, datetime('now'))
        `).bind(
          callLogId,
          phase,
          `Admin dial request to ${toNumber}`,
          JSON.stringify({ to_number: toNumber, from_number: fromNumber, note, hotel_id: hotelId, lead_id: outreachLeadId, probe })
        ).run().catch(() => {});
      }

      if (phase === 'outreach' && callLogId && outreachLeadId) {
        await db.prepare(`UPDATE outreach_leads SET call_log_id=?, status='calling', updated_at=datetime('now') WHERE id=?`)
          .bind(callLogId, outreachLeadId)
          .run()
          .catch(() => {});
      }
    }

    const twimlUrl = `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId || ''}&phase=${phase}`;
    const params = new URLSearchParams();
    params.set('To', toNumber);
    params.set('From', fromNumber);
    params.set('Url', twimlUrl);
    params.set('Method', 'POST');
    params.set('StatusCallback', `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId || ''}&event=status&phase=${phase}`);
    params.set('StatusCallbackMethod', 'POST');
    params.set('StatusCallbackEvent', 'initiated');
    params.append('StatusCallbackEvent', 'ringing');
    params.append('StatusCallbackEvent', 'answered');
    params.append('StatusCallbackEvent', 'completed');

    const twilioReqSummary = {
      url: `https://api.twilio.com/2010-04-01/Accounts/${maskSecret(accountSid)}/Calls.json`,
      to: toNumber,
      from: maskSecret(fromNumber),
      callback_url: `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId || ''}&phase=${phase}&event=status`,
    };

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(accountSid, authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

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
          VALUES (?1, 'twilio', 'dial_rejected', ?2, ?3, ?4, datetime('now'))
        `).bind(callLogId, phase, `Twilio rejected dial request: HTTP ${res.status}`, JSON.stringify(details)).run().catch(() => {});
      }
      return new Response(JSON.stringify({ success: false, error: 'Twilio dial failed', details }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const callSid = providerBody?.sid || null;
    if (db && callSid && callLogId) {
      await db.prepare(`UPDATE call_logs SET telnyx_call_id=?, last_event_type='dial_accepted', updated_at=datetime('now') WHERE id=?`)
        .bind(`twilio:${callSid}`, callLogId).run();
      await db.prepare(`
        INSERT INTO call_log_events (call_log_id, provider, event_type, phase, call_sid, note, payload_json, created_at)
        VALUES (?1, 'twilio', 'dial_accepted', ?2, ?3, ?4, ?5, datetime('now'))
      `).bind(
        callLogId,
        phase,
        callSid,
        'Twilio accepted outbound call request',
        JSON.stringify({ sid: callSid, to_number: toNumber, from_number: fromNumber, request: twilioReqSummary, probe })
      ).run().catch(() => {});
    }

    return new Response(JSON.stringify({
      success: true,
      call_sid: callSid,
      log_id: callLogId,
      provider: 'twilio',
      phase,
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
        VALUES (?1, 'twilio', 'dial_exception', ?2, ?3, ?4, datetime('now'))
      `).bind(callLogId, phase, 'Exception thrown while dialing Twilio', JSON.stringify(errorDetails)).run().catch(() => {});
    }
    return new Response(JSON.stringify({ success: false, error: 'Dial exception', details: errorDetails }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
