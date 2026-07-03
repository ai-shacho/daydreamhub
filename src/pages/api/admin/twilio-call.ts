import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

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

  const toNumber = String(body?.to_number || '').trim();
  const phase = String(body?.phase || 'booking').trim().toLowerCase() === 'outreach' ? 'outreach' : 'booking';
  const hotelId = toPositiveInt(body?.hotel_id);
  const outreachLeadId = toPositiveInt(body?.lead_id);
  const note = String(body?.note || '').trim();

  if (!toNumber) {
    return new Response(JSON.stringify({ error: 'to_number is required' }), { status: 400 });
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
          JSON.stringify({ to_number: toNumber, from_number: fromNumber, note, hotel_id: hotelId, lead_id: outreachLeadId })
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
        JSON.stringify({ sid: callSid, to_number: toNumber, from_number: fromNumber })
      ).run().catch(() => {});
    }

    return new Response(JSON.stringify({
      success: true,
      provider: 'twilio',
      phase,
      call_sid: callSid,
      log_id: callLogId,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Unknown error' }), { status: 500 });
  }
};
