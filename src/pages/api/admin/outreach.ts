import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

const normalizePhone = (value: string) =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-().+]/g, '');

const normalizeHotelName = (value: string) => (value || '').trim().toLowerCase();

async function getContext(request: Request, locals: any) {
  const runtime = locals?.runtime;
  const env = runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  return { env, db, admin };
}

export const GET: APIRoute = async ({ request, locals, url }) => {
  const { db, admin } = await getContext(request, locals);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  const status = url.searchParams.get('status');
  const listId = Number(url.searchParams.get('list_id') || '0');

  const listExists = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='outreach_lists'`).first();

  let leadsQuery = `SELECT l.* FROM outreach_leads l`;
  const binds: any[] = [];

  if (listExists && listId > 0) {
    leadsQuery += ` JOIN outreach_list_members m ON m.lead_id = l.id AND m.list_id = ?`;
    binds.push(listId);
  }

  if (status) {
    leadsQuery += binds.length ? ` WHERE l.status = ?` : ` WHERE l.status = ?`;
    binds.push(status);
  }

  leadsQuery += ` ORDER BY l.updated_at DESC`;

  const leadsResult = await db.prepare(leadsQuery).bind(...binds).all();

  let lists: any[] = [];
  if (listExists) {
    const listRows = await db.prepare(
      `SELECT ol.*,
              COALESCE(SUM(CASE WHEN l.status IN ('interested','appointment_set') THEN 1 ELSE 0 END),0) AS success_count,
              COALESCE(SUM(CASE WHEN l.status IN ('not_interested','declined') THEN 1 ELSE 0 END),0) AS rejected_count,
              COALESCE(SUM(CASE WHEN l.status IN ('calling') THEN 1 ELSE 0 END),0) AS calling_count,
              COALESCE(SUM(CASE WHEN l.status IN ('new','no_answer') OR l.status IS NULL THEN 1 ELSE 0 END),0) AS pending_count
       FROM outreach_lists ol
       LEFT JOIN outreach_list_members m ON m.list_id = ol.id AND m.status != 'removed'
       LEFT JOIN outreach_leads l ON l.id = m.lead_id
       GROUP BY ol.id
       ORDER BY ol.created_at DESC`
    ).all();
    lists = listRows?.results || [];
  }

  return new Response(JSON.stringify({ leads: leadsResult?.results || [], lists }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const { env, db, admin } = await getContext(request, locals);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { action } = body;

  if (action === 'add_lead') {
    const { hotel_name, phone, country, email, notes, list_id } = body;
    if (!hotel_name || !phone) {
      return new Response(JSON.stringify({ error: 'hotel_name and phone are required' }), { status: 400 });
    }
    const phone_norm = normalizePhone(phone);
    const hotel_name_norm = normalizeHotelName(hotel_name);

    const existing: any = await db
      .prepare(`SELECT id FROM outreach_leads WHERE phone_norm = ? OR hotel_name_norm = ? LIMIT 1`)
      .bind(phone_norm, hotel_name_norm)
      .first();

    let leadId = existing?.id;
    if (!leadId) {
      await db
        .prepare(
          `INSERT INTO outreach_leads (hotel_name, phone, phone_norm, hotel_name_norm, country, email, notes, first_list_id, last_list_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(hotel_name, phone, phone_norm, hotel_name_norm, country || '', email || '', notes || '', list_id || null, list_id || null)
        .run();
      const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
      leadId = row?.id;
    }

    if (list_id) {
      await db
        .prepare(`INSERT OR IGNORE INTO outreach_list_members (list_id, lead_id, status) VALUES (?, ?, 'active')`)
        .bind(Number(list_id), Number(leadId))
        .run()
        .catch(() => {});
      await db
        .prepare(`UPDATE outreach_leads SET last_list_id = ? WHERE id = ?`)
        .bind(Number(list_id), Number(leadId))
        .run()
        .catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, id: leadId, reused: !!existing?.id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'import_csv') {
    const { csv, list_name, file_name } = body;
    if (!csv) return new Response(JSON.stringify({ error: 'csv is required' }), { status: 400 });

    const hasLists = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='outreach_lists'`).first();

    const lines = (csv as string)
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);

    let listId: number | null = null;
    if (hasLists) {
      await db
        .prepare(
          `INSERT INTO outreach_lists (name, source_type, file_name, total_rows, status)
           VALUES (?, 'csv', ?, ?, 'active')`
        )
        .bind(list_name || `Upload ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, file_name || '', lines.length)
        .run();
      const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
      listId = Number(row?.id || 0) || null;
    }

    let imported = 0;
    let duplicateRows = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cols = line.split(',').map((c: string) => c.trim().replace(/^"|"$/g, ''));
      const [hotel_name, phone, country, email] = cols;
      if (!hotel_name || !phone) {
        duplicateRows++;
        continue;
      }

      const phone_norm = normalizePhone(phone);
      const hotel_name_norm = normalizeHotelName(hotel_name);

      const existing: any = await db
        .prepare(`SELECT id FROM outreach_leads WHERE phone_norm = ? OR hotel_name_norm = ? LIMIT 1`)
        .bind(phone_norm, hotel_name_norm)
        .first();

      let leadId = existing?.id;
      if (!leadId) {
        await db
          .prepare(
            `INSERT INTO outreach_leads (hotel_name, phone, phone_norm, hotel_name_norm, country, email, first_list_id, last_list_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(hotel_name, phone, phone_norm, hotel_name_norm, country || '', email || '', listId, listId)
          .run();
        const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
        leadId = row?.id;
        imported++;
      } else {
        duplicateRows++;
      }

      if (listId && leadId) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO outreach_list_members (list_id, lead_id, source_row_no, duplicate_reason, status)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(
            listId,
            leadId,
            i + 1,
            existing?.id ? 'existing_lead' : '',
            existing?.id ? 'duplicate' : 'active'
          )
          .run()
          .catch(() => {});
        await db
          .prepare(`UPDATE outreach_leads SET last_list_id = ? WHERE id = ?`)
          .bind(listId, leadId)
          .run()
          .catch(() => {});
      }
    }

    if (listId) {
      await db
        .prepare(
          `UPDATE outreach_lists
           SET imported_rows = ?, duplicate_rows = ?,
               status = CASE WHEN ? = 0 THEN 'duplicate_only' ELSE status END,
               updated_at = datetime('now')
           WHERE id = ?`
        )
        .bind(imported, duplicateRows, imported, listId)
        .run()
        .catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, imported, skipped: duplicateRows, list_id: listId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'call_next') {
    const { list_id } = body;
    const listId = Number(list_id || 0);

    const nextLead: any = listId
      ? await db
          .prepare(
            `SELECT l.*
             FROM outreach_leads l
             JOIN outreach_list_members m ON m.lead_id = l.id AND m.list_id = ?
             WHERE l.status IN ('new','no_answer')
             ORDER BY l.updated_at ASC, l.id ASC
             LIMIT 1`
          )
          .bind(listId)
          .first()
      : await db
          .prepare(`SELECT * FROM outreach_leads WHERE status IN ('new','no_answer') ORDER BY updated_at ASC, id ASC LIMIT 1`)
          .first();

    if (!nextLead) {
      return new Response(JSON.stringify({ success: true, done: true, message: 'No callable lead found' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // re-use call_lead flow
    body.action = 'call_lead';
    body.lead_id = nextLead.id;
  }

  if (action === 'call_lead') {
    const { lead_id } = body;
    if (!lead_id) return new Response(JSON.stringify({ error: 'lead_id is required' }), { status: 400 });

    if (!env?.TELNYX_API_KEY || !env?.TELNYX_FROM_NUMBER || !env?.TELNYX_CONNECTION_ID) {
      return new Response(JSON.stringify({ error: 'Telnyx not configured' }), { status: 503 });
    }

    const lead: any = await db.prepare(`SELECT * FROM outreach_leads WHERE id = ?`).bind(lead_id).first();
    if (!lead) return new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 });

    const logResult = await db
      .prepare(`INSERT INTO call_logs (hotel_id, status, note, created_at) VALUES (NULL, 'calling', ?, datetime('now'))`)
      .bind(`Outreach: ${lead.hotel_name}`)
      .run();
    const callLogId = (logResult as any)?.meta?.last_row_id || null;

    const baseUrl = env.SITE_URL || 'https://daydreamhub-1sv.pages.dev';
    const stateObj = {
      phase: 'outreach',
      lead_id,
      call_log_id: callLogId,
      hotel_name: lead.hotel_name,
    };
    const stateBytes = new TextEncoder().encode(JSON.stringify(stateObj));
    let bin = '';
    stateBytes.forEach((b) => (bin += String.fromCharCode(b)));
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
        await db
          .prepare(`UPDATE call_logs SET status='failed', error_detail=? WHERE id=?`)
          .bind(JSON.stringify(data), callLogId)
          .run()
          .catch(() => {});
        return new Response(JSON.stringify({ error: 'Telnyx error', details: data }), { status: res.status });
      }
      const callSid = data?.data?.call_control_id || data?.data?.call_session_id || null;
      if (callLogId && callSid) {
        await db.prepare(`UPDATE call_logs SET telnyx_call_id=? WHERE id=?`).bind(callSid, callLogId).run();
      }
      await db
        .prepare(`UPDATE outreach_leads SET status='calling', call_log_id=?, updated_at=datetime('now') WHERE id=?`)
        .bind(callLogId, lead_id)
        .run();

      return new Response(JSON.stringify({ success: true, lead_id, call_log_id: callLogId, call_sid: callSid }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e: any) {
      await db
        .prepare(`UPDATE call_logs SET status='failed', error_detail=? WHERE id=?`)
        .bind(e.message, callLogId)
        .run()
        .catch(() => {});
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  if (action === 'update_lead') {
    const { lead_id, notes, status } = body;
    if (!lead_id) return new Response(JSON.stringify({ error: 'lead_id is required' }), { status: 400 });
    await db
      .prepare(`UPDATE outreach_leads SET notes=COALESCE(?,notes), status=COALESCE(?,status), updated_at=datetime('now') WHERE id=?`)
      .bind(notes ?? null, status ?? null, lead_id)
      .run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (action === 'get_lead_detail') {
    const { lead_id } = body;
    if (!lead_id) return new Response(JSON.stringify({ error: 'lead_id is required' }), { status: 400 });
    const lead: any = await db.prepare(`SELECT * FROM outreach_leads WHERE id=?`).bind(Number(lead_id)).first();
    if (!lead) return new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 });

    const callLog = lead.call_log_id
      ? await db.prepare(`SELECT id, status, note, error_detail, created_at, updated_at FROM call_logs WHERE id=?`).bind(lead.call_log_id).first().catch(() => null)
      : null;

    return new Response(JSON.stringify({ success: true, lead, call_log: callLog }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'delete_lead') {
    const { lead_id } = body;
    if (!lead_id) return new Response(JSON.stringify({ error: 'lead_id is required' }), { status: 400 });
    await db.prepare(`DELETE FROM outreach_leads WHERE id=?`).bind(lead_id).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
};
