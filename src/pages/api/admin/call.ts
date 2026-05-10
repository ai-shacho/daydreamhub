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

  if (!env?.TELNYX_API_KEY) {
    return new Response(JSON.stringify({ error: 'TELNYX_API_KEY not configured' }), { status: 503 });
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
    const fromNumber = env.TELNYX_FROM_NUMBER;
    if (!fromNumber) {
      return new Response(JSON.stringify({ error: 'TELNYX_FROM_NUMBER not configured' }), { status: 503 });
    }
    const baseUrl = env.SITE_URL || 'https://daydreamhub-1sv.pages.dev';

    try {
      let callLogId: number | null = null;
      if (db) {
        await db.prepare(`
          INSERT INTO call_logs (hotel_id, status, note, created_at)
          VALUES (?1, 'queued', ?2, datetime('now'))
        `).bind(hotel_id || null, note || `Call to ${to_number}`).run();
        const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
        callLogId = row?.id || null;
      }

      const stateJson = JSON.stringify({
        call_log_id: callLogId,
        hotel_id: hotel_id || null,
        phase: 'ivr',
      });
      const bytes = new TextEncoder().encode(stateJson);
      let binary = '';
      bytes.forEach(b => binary += String.fromCharCode(b));
      const clientState = btoa(binary);

      const res = await fetch('https://api.telnyx.com/v2/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connection_id: env.TELNYX_CONNECTION_ID,
          to: to_number,
          from: fromNumber,
          from_display_name: 'DayDreamHub',
          webhook_url: `${baseUrl}/api/webhooks/telnyx-voice?lid=${callLogId || ''}`,
          webhook_url_method: 'POST',
          client_state: clientState,
          timeout_secs: 30,
        }),
      });

      const data: any = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: 'Telnyx error', details: data }), { status: res.status });
      }

      const callSid = data?.data?.call_session_id || data?.data?.call_control_id || null;
      if (db && callSid && callLogId) {
        await db.prepare(`UPDATE call_logs SET telnyx_call_id = ? WHERE id = ?`)
          .bind(callSid, callLogId).run();
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

  // Check Telnyx config status
  if (action === 'status') {
    const cfg = {
      TELNYX_API_KEY: env?.TELNYX_API_KEY ? '✅ Set' : '❌ Not set',
      TELNYX_FROM_NUMBER: env?.TELNYX_FROM_NUMBER || '❌ Not set',
      TELNYX_CONNECTION_ID: env?.TELNYX_CONNECTION_ID || '❌ Not set',
    };
    return new Response(JSON.stringify(cfg), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
};
