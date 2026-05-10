import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

export const GET: APIRoute = async ({ request, locals, url }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  const status = url.searchParams.get('status');
  const query = status
    ? `SELECT * FROM outreach_leads WHERE status = ? ORDER BY updated_at DESC`
    : `SELECT * FROM outreach_leads ORDER BY updated_at DESC`;
  const result = status
    ? await db.prepare(query).bind(status).all()
    : await db.prepare(query).all();

  return new Response(JSON.stringify({ leads: result?.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { action } = body;

  // ── Add a single lead ────────────────────────────────────────────────────
  if (action === 'add_lead') {
    if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });
    const { hotel_name, phone, country, email, notes } = body;
    if (!hotel_name || !phone) {
      return new Response(JSON.stringify({ error: 'hotel_name and phone are required' }), { status: 400 });
    }
    await db.prepare(
      `INSERT INTO outreach_leads (hotel_name, phone, country, email, notes) VALUES (?, ?, ?, ?, ?)`
    ).bind(hotel_name, phone, country || '', email || '', notes || '').run();
    const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
    return new Response(JSON.stringify({ success: true, id: row?.id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Bulk import from CSV text ────────────────────────────────────────────
  // Expected format: hotel_name,phone,country,email
  if (action === 'import_csv') {
    if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });
    const { csv } = body;
    if (!csv) return new Response(JSON.stringify({ error: 'csv is required' }), { status: 400 });

    const lines = (csv as string).split('\n').map((l: string) => l.trim()).filter(Boolean);
    let imported = 0;
    let skipped = 0;
    for (const line of lines) {
      const cols = line.split(',').map((c: string) => c.trim().replace(/^"|"$/g, ''));
      const [hotel_name, phone, country, email] = cols;
      if (!hotel_name || !phone) { skipped++; continue; }
      await db.prepare(
        `INSERT OR IGNORE INTO outreach_leads (hotel_name, phone, country, email) VALUES (?, ?, ?, ?)`
      ).bind(hotel_name, phone, country || '', email || '').run().catch(() => { skipped++; });
      imported++;
    }
    return new Response(JSON.stringify({ success: true, imported, skipped }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Trigger outreach call for a lead ────────────────────────────────────
  if (action === 'call_lead') {
    if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });
    const { lead_id } = body;
    if (!lead_id) return new Response(JSON.stringify({ error: 'lead_id is required' }), { status: 400 });

    if (!env?.TELNYX_API_KEY || !env?.TELNYX_FROM_NUMBER || !env?.TELNYX_CONNECTION_ID) {
      return new Response(JSON.stringify({ error: 'Telnyx not configured' }), { status: 503 });
    }

    const lead: any = await db.prepare(`SELECT * FROM outreach_leads WHERE id = ?`).bind(lead_id).first();
    if (!lead) return new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 });

    const logResult = await db.prepare(
      `INSERT INTO call_logs (hotel_id, status, note, created_at) VALUES (NULL, 'calling', ?, datetime('now'))`
    ).bind(`Outreach: ${lead.hotel_name}`).run();
    const logRow: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
    const callLogId = logRow?.id || null;

    const baseUrl = env.SITE_URL || 'https://daydreamhub-1sv.pages.dev';
    const stateObj = {
      phase: 'outreach',
      lead_id: lead_id,
      call_log_id: callLogId,
      hotel_name: lead.hotel_name,
    };
    const stateBytes = new TextEncoder().encode(JSON.stringify(stateObj));
    let bin = ''; stateBytes.forEach(b => bin += String.fromCharCode(b));
    const clientState = btoa(bin);

    try {
      const res = await fetch('https://api.telnyx.com/v2/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connection_id: env.TELNYX_CONNECTION_ID,
          to: lead.phone,
          from: env.TELNYX_FROM_NUMBER,
          from_display_name: 'DayDreamHub',
          webhook_url: `${baseUrl}/api/webhooks/telnyx-voice?lid=${callLogId || ''}`,
          webhook_url_method: 'POST',
          client_state: clientState,
          timeout_secs: 30,
        }),
      });
      const data: any = await res.json();
      if (!res.ok) {
        await db.prepare(`UPDATE call_logs SET status='failed', error_detail=? WHERE id=?`)
          .bind(JSON.stringify(data), callLogId).run().catch(() => {});
        return new Response(JSON.stringify({ error: 'Telnyx error', details: data }), { status: res.status });
      }
      const callSid = data?.data?.call_control_id || data?.data?.call_session_id || null;
      if (callLogId && callSid) {
        await db.prepare(`UPDATE call_logs SET telnyx_call_id=? WHERE id=?`).bind(callSid, callLogId).run();
      }
      await db.prepare(
        `UPDATE outreach_leads SET status='calling', call_log_id=?, updated_at=datetime('now') WHERE id=?`
      ).bind(callLogId, lead_id).run();

      return new Response(JSON.stringify({ success: true, call_log_id: callLogId, call_sid: callSid }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e: any) {
      await db.prepare(`UPDATE call_logs SET status='failed', error_detail=? WHERE id=?`)
        .bind(e.message, callLogId).run().catch(() => {});
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  // ── Update lead notes / status ───────────────────────────────────────────
  if (action === 'update_lead') {
    if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });
    const { lead_id, notes, status } = body;
    if (!lead_id) return new Response(JSON.stringify({ error: 'lead_id is required' }), { status: 400 });
    await db.prepare(
      `UPDATE outreach_leads SET notes=COALESCE(?,notes), status=COALESCE(?,status), updated_at=datetime('now') WHERE id=?`
    ).bind(notes ?? null, status ?? null, lead_id).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  // ── Delete lead ──────────────────────────────────────────────────────────
  if (action === 'delete_lead') {
    if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });
    const { lead_id } = body;
    if (!lead_id) return new Response(JSON.stringify({ error: 'lead_id is required' }), { status: 400 });
    await db.prepare(`DELETE FROM outreach_leads WHERE id=?`).bind(lead_id).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
};
