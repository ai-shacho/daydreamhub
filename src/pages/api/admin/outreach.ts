import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

const normalizePhone = (value: string) =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-().+]/g, '');

const normalizeHotelName = (value: string) => (value || '').trim().toLowerCase();

const VALID_LEAD_STATUSES = new Set([
  'new',
  'calling',
  'interested',
  'appointment_set',
  'contact_obtained',
  'not_interested',
  'declined',
  'no_answer',
  'voicemail',
]);

const LEGACY_STATUS_MAP: Record<string, string> = {
  'not interested': 'not_interested',
  notinterested: 'not_interested',
  appointment: 'appointment_set',
  'appointment set': 'appointment_set',
  'contact obtained': 'contact_obtained',
  contacted: 'contact_obtained',
};

const TEST_BYPASS_DEDUPE_ON_IMPORT = true;

function normalizeLeadStatus(raw: any): string | null {
  const input = String(raw ?? '').trim().toLowerCase();
  if (!input) return null;
  const mapped = LEGACY_STATUS_MAP[input] || input;
  return VALID_LEAD_STATUSES.has(mapped) ? mapped : null;
}

const COUNTRY_TIMEZONE_MAP: Record<string, string> = {
  japan: 'Asia/Tokyo',
  usa: 'America/New_York',
  'united states': 'America/New_York',
  canada: 'America/Toronto',
  uk: 'Europe/London',
  'united kingdom': 'Europe/London',
  france: 'Europe/Paris',
  germany: 'Europe/Berlin',
  italy: 'Europe/Rome',
  spain: 'Europe/Madrid',
  australia: 'Australia/Sydney',
  singapore: 'Asia/Singapore',
  thailand: 'Asia/Bangkok',
  indonesia: 'Asia/Jakarta',
  philippines: 'Asia/Manila',
  india: 'Asia/Kolkata',
  uae: 'Asia/Dubai',
};

function estimateTimezone(country?: string | null): string {
  const key = String(country || '').trim().toLowerCase();
  return COUNTRY_TIMEZONE_MAP[key] || 'UTC';
}

function toSqlDateInTz(date: Date, timeZone: string): { dateTime: string; weekday: number | null; hour: number; year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const w = get('weekday').toLowerCase();
  const weekdayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const hh = Number(get('hour') || '0');
  return {
    dateTime: `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`,
    weekday: weekdayMap[w] ?? null,
    hour: hh,
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  };
}

function nextLocal9amUtcSql(now: Date, timeZone: string): string {
  const local = toSqlDateInTz(now, timeZone);
  const approxUtc = Date.UTC(local.year, local.month - 1, local.day + 1, 9, 0, 0);
  return new Date(approxUtc).toISOString().slice(0, 19).replace('T', ' ');
}

function parseCsvRows(csv: string): { header: string[]; rows: string[][] } {
  const lines = (csv || '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return { header: [], rows: [] };
  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out.map((c) => c.replace(/^"|"$/g, '').trim());
  };

  const maybeHeader = parseLine(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = maybeHeader.some((h) => ['hotel_name', 'hotel', 'name', 'phone', 'country', 'email', 'timezone', 'tz'].includes(h));
  const header = hasHeader ? maybeHeader : ['hotel_name', 'phone', 'country', 'email', 'timezone'];
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows = dataLines.map(parseLine);
  return { header, rows };
}

async function chooseScriptVariant(db: any, leadId: number): Promise<string> {
  const variants = await db.prepare(`SELECT code FROM outreach_script_variants WHERE active = 1 ORDER BY code ASC`).all().catch(() => ({ results: [] }));
  const list = (variants?.results || []).map((v: any) => v.code).filter(Boolean);
  if (!list.length) return 'A';
  const idx = Math.abs(Number(leadId || 0)) % list.length;
  return list[idx] || 'A';
}

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

  const hasListTables = !!listExists;
  const listSelect = hasListTables ? `m.source_row_no,
    m.status AS list_member_status,` : `NULL AS source_row_no,
    NULL AS list_member_status,`;
  const listJoin = hasListTables ? `LEFT JOIN outreach_list_members m ON m.lead_id = l.id` : '';

  let leadsQuery = `SELECT l.*,
    ${listSelect}
    a.call_started_at_jst AS last_call_started_at_jst,
    a.call_started_at_local AS last_call_started_at_local,
    a.lead_timezone AS last_call_lead_timezone,
    a.call_started_weekday_jst AS last_call_weekday_jst,
    a.call_started_hour_jst AS last_call_hour_jst,
    a.call_started_weekday_local AS last_call_weekday_local,
    a.call_started_hour_local AS last_call_hour_local,
    a.outcome AS last_call_outcome,
    a.script_variant AS last_script_variant,
    COALESCE((SELECT COUNT(1) FROM outreach_call_attempts t WHERE t.lead_id = l.id), 0) AS total_attempts
    FROM outreach_leads l
    LEFT JOIN outreach_call_attempts a ON a.id = (
      SELECT oa.id FROM outreach_call_attempts oa
      WHERE oa.lead_id = l.id
      ORDER BY oa.created_at DESC, oa.id DESC
      LIMIT 1
    )
    ${listJoin}`;
  const binds: any[] = [];
  const where: string[] = [];

  if (hasListTables && listId > 0) {
    where.push(`m.list_id = ?`);
    // Table should show only valid/imported rows for the selected list.
    // Duplicates/invalid rows are excluded from list members with status='active'.
    where.push(`m.status = 'active'`);
    binds.push(listId);
  }

  if (status) {
    where.push(`l.status = ?`);
    binds.push(status);
  }

  if (where.length) {
    leadsQuery += ` WHERE ${where.join(' AND ')}`;
  }

  leadsQuery += hasListTables && listId > 0
    ? ` ORDER BY COALESCE(m.source_row_no, 999999999) ASC, l.id ASC`
    : ` ORDER BY l.updated_at DESC`;

  const leadsResult = await db.prepare(leadsQuery).bind(...binds).all();

  let lists: any[] = [];
  if (listExists) {
    const listRows = await db.prepare(
      `SELECT ol.*,
              COALESCE(SUM(CASE WHEN l.status IN ('interested','appointment_set') THEN 1 ELSE 0 END),0) AS success_count,
              COALESCE(SUM(CASE WHEN l.status IN ('not_interested','declined') THEN 1 ELSE 0 END),0) AS rejected_count,
              COALESCE(SUM(CASE WHEN l.status IN ('calling') THEN 1 ELSE 0 END),0) AS calling_count,
              COALESCE(SUM(CASE WHEN l.status IN ('new','no_answer','voicemail') OR l.status IS NULL THEN 1 ELSE 0 END),0) AS pending_count
       FROM outreach_lists ol
       LEFT JOIN outreach_list_members m ON m.list_id = ol.id AND m.status != 'removed'
       LEFT JOIN outreach_leads l ON l.id = m.lead_id
       GROUP BY ol.id
       ORDER BY ol.created_at DESC`
    ).all();
    lists = listRows?.results || [];
  }

  const variants = await db
    .prepare(`SELECT code, name, opening_line, followup_line, active FROM outreach_script_variants ORDER BY code ASC`)
    .all()
    .catch(() => ({ results: [] }));

  const variantStats = await db
    .prepare(`SELECT script_variant,
              COUNT(*) AS attempts,
              SUM(CASE WHEN outcome = 'interested' THEN 1 ELSE 0 END) AS interested,
              SUM(CASE WHEN outcome IN ('not_interested','no_answer','voicemail','failed') THEN 1 ELSE 0 END) AS unresolved
       FROM outreach_call_attempts
       GROUP BY script_variant
       ORDER BY script_variant ASC`)
    .all()
    .catch(() => ({ results: [] }));

  return new Response(JSON.stringify({ leads: leadsResult?.results || [], lists, variants: variants?.results || [], variant_stats: variantStats?.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const { env, db, admin } = await getContext(request, locals);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  let body: any = {};
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('multipart/form-data')) {
    const form = await request.formData();
    const action = String(form.get('action') || '');
    const list_name = String(form.get('list_name') || '');
    const file = form.get('file') as File | null;
    const csv = file ? await file.text() : '';
    body = { action, list_name, file_name: file?.name || '', csv };
  } else {
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
    }
  }

  let action = String(body?.action || '');

  if (action === 'upsert_variant') {
    const code = String(body.code || '').trim().toUpperCase();
    const name = String(body.name || '').trim();
    const opening = String(body.opening_line || '').trim();
    const followup = String(body.followup_line || '').trim();
    const active = Number(body.active ?? 1) ? 1 : 0;
    if (!code || !name || !opening) return new Response(JSON.stringify({ error: 'code, name, opening_line are required' }), { status: 400 });

    await db.prepare(
      `INSERT INTO outreach_script_variants (code, name, opening_line, followup_line, active, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(code) DO UPDATE SET
         name=excluded.name,
         opening_line=excluded.opening_line,
         followup_line=excluded.followup_line,
         active=excluded.active,
         updated_at=datetime('now')`
    ).bind(code, name, opening, followup, active).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (action === 'add_lead') {
    const { hotel_name, phone, country, email, notes, list_id, timezone } = body;
    if (!hotel_name || !phone) {
      return new Response(JSON.stringify({ error: 'hotel_name and phone are required' }), { status: 400 });
    }
    const phone_norm = normalizePhone(phone);
    const hotel_name_norm = normalizeHotelName(hotel_name);

    const existing: any = await db
      .prepare(`SELECT id FROM outreach_leads WHERE phone_norm = ? OR hotel_name_norm = ? LIMIT 1`)
      .bind(phone_norm, hotel_name_norm)
      .first();

    const tz = String(timezone || '').trim() || estimateTimezone(country || '');
    const tzSource = String(timezone || '').trim() ? 'manual' : 'country_guess';

    let leadId = existing?.id;
    if (!leadId) {
      await db
        .prepare(
          `INSERT INTO outreach_leads (hotel_name, phone, phone_norm, hotel_name_norm, country, email, notes, timezone, timezone_source, first_list_id, last_list_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(hotel_name, phone, phone_norm, hotel_name_norm, country || '', email || '', notes || '', tz, tzSource, list_id || null, list_id || null)
        .run();
      const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
      leadId = row?.id;
    }

    if (list_id) {
      await db.prepare(`INSERT OR IGNORE INTO outreach_list_members (list_id, lead_id, status) VALUES (?, ?, 'active')`).bind(Number(list_id), Number(leadId)).run().catch(() => {});
      await db.prepare(`UPDATE outreach_leads SET last_list_id = ? WHERE id = ?`).bind(Number(list_id), Number(leadId)).run().catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, id: leadId, reused: !!existing?.id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'import_csv' || action === 'import_csv_file') {
    const { csv, list_name, file_name } = body;
    if (!csv) return new Response(JSON.stringify({ error: 'csv is required' }), { status: 400 });

    const hasLists = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='outreach_lists'`).first();
    const { header, rows } = parseCsvRows(String(csv || ''));
    const indexOf = (keys: string[]) => header.findIndex((h) => keys.includes(h));
    const idxName = indexOf(['hotel_name', 'hotel', 'name']);
    const idxPhone = indexOf(['phone', 'phone_number', 'tel']);
    const idxCountry = indexOf(['country']);
    const idxEmail = indexOf(['email']);
    const idxTimezone = indexOf(['timezone', 'tz']);

    let listId: number | null = null;
    if (hasLists) {
      await db.prepare(`INSERT INTO outreach_lists (name, source_type, file_name, total_rows, status) VALUES (?, 'csv', ?, ?, 'active')`)
        .bind(list_name || `Upload ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, file_name || '', rows.length)
        .run();
      const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
      listId = Number(row?.id || 0) || null;
    }

    let imported = 0;
    let duplicateRows = 0;
    let invalidRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const cols = rows[i];
      const hotel_name = idxName >= 0 ? cols[idxName] : cols[0];
      const phone = idxPhone >= 0 ? cols[idxPhone] : cols[1];
      const country = idxCountry >= 0 ? cols[idxCountry] : cols[2];
      const email = idxEmail >= 0 ? cols[idxEmail] : cols[3];
      const timezone = idxTimezone >= 0 ? cols[idxTimezone] : cols[4];

      const hotelNameTrimmed = String(hotel_name || '').trim();
      const phoneTrimmed = String(phone || '').trim();
      if (!hotelNameTrimmed || !phoneTrimmed) {
        invalidRows++;
        continue;
      }

      // Basic phone format validation: keep only reasonably callable rows.
      const digitsOnly = phoneTrimmed.replace(/\D/g, '');
      if (digitsOnly.length < 6) {
        invalidRows++;
        continue;
      }

      const phone_norm = normalizePhone(phoneTrimmed);
      const hotel_name_norm = normalizeHotelName(hotelNameTrimmed);
      const bypassDedupe = TEST_BYPASS_DEDUPE_ON_IMPORT;

      const existing: any = bypassDedupe
        ? null
        : await db.prepare(`SELECT id FROM outreach_leads WHERE phone_norm = ? OR hotel_name_norm = ? LIMIT 1`).bind(phone_norm, hotel_name_norm).first();

      const tz = String(timezone || '').trim() || estimateTimezone(country || '');
      const tzSource = String(timezone || '').trim() ? 'csv' : (country ? 'country_guess' : 'unknown');

      let leadId = existing?.id;
      if (!leadId) {
        const phoneNormForInsert = bypassDedupe && phone_norm
          ? `${phone_norm}__import_${Date.now()}_${i}`
          : phone_norm;

        await db.prepare(
          `INSERT INTO outreach_leads (hotel_name, phone, phone_norm, hotel_name_norm, country, email, timezone, timezone_source, first_list_id, last_list_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(hotelNameTrimmed, phoneTrimmed, phoneNormForInsert, hotel_name_norm, country || '', email || '', tz, tzSource, listId, listId).run();
        const row: any = await db.prepare(`SELECT last_insert_rowid() as id`).first();
        leadId = row?.id;
        imported++;
      } else {
        duplicateRows++;
      }

      if (listId && leadId) {
        await db.prepare(`INSERT OR IGNORE INTO outreach_list_members (list_id, lead_id, source_row_no, duplicate_reason, status) VALUES (?, ?, ?, ?, ?)`)
          .bind(listId, leadId, i + 1, existing?.id ? 'existing_lead' : '', existing?.id ? 'duplicate' : 'active')
          .run().catch(() => {});
        await db.prepare(`UPDATE outreach_leads SET last_list_id = ? WHERE id = ?`).bind(listId, leadId).run().catch(() => {});
      }
    }

    if (listId) {
      try {
        await db.prepare(
          `UPDATE outreach_lists
           SET imported_rows = ?, duplicate_rows = ?, invalid_rows = ?,
               status = CASE
                 WHEN ? = 0 AND ? > 0 AND ? = 0 THEN 'invalid_only'
                 WHEN ? = 0 THEN 'duplicate_only'
                 ELSE status
               END,
               updated_at = datetime('now')
           WHERE id = ?`
        ).bind(imported, duplicateRows, invalidRows, imported, invalidRows, duplicateRows, imported, listId).run();
      } catch {
        // Backward compatibility for environments where invalid_rows migration is not applied yet.
        await db.prepare(
          `UPDATE outreach_lists
           SET imported_rows = ?, duplicate_rows = ?,
               status = CASE WHEN ? = 0 THEN 'duplicate_only' ELSE status END,
               updated_at = datetime('now')
           WHERE id = ?`
        ).bind(imported, duplicateRows, imported, listId).run().catch(() => {});
      }
    }

    return new Response(JSON.stringify({ success: true, imported, duplicate_rows: duplicateRows, invalid_rows: invalidRows, skipped: duplicateRows + invalidRows, list_id: listId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'call_next') {
    const listId = Number(body.list_id || 0);

    const listJoin = listId > 0 ? `JOIN outreach_list_members m ON m.lead_id = l.id AND m.list_id = ${listId} AND m.status = 'active'` : '';
    const baseWhere = `l.do_not_call = 0 AND l.status IN ('new','no_answer','voicemail') AND (l.next_callable_at IS NULL OR l.next_callable_at <= datetime('now'))`;

    // 1) First pass: never called leads first
    const uncalled: any = await db.prepare(
      `SELECT l.*
       FROM outreach_leads l
       ${listJoin}
       LEFT JOIN outreach_call_attempts a ON a.lead_id = l.id
       WHERE ${baseWhere}
       GROUP BY l.id
       HAVING COUNT(a.id) = 0
       ORDER BY l.updated_at ASC, l.id ASC
       LIMIT 1`
    ).first();

    let nextLead = uncalled;

    // 2) After one full pass, retry unresolved leads with attempts < 3
    if (!nextLead) {
      const recall: any = await db.prepare(
        `SELECT l.*, COUNT(a.id) AS attempt_count
         FROM outreach_leads l
         ${listJoin}
         LEFT JOIN outreach_call_attempts a ON a.lead_id = l.id
         WHERE ${baseWhere}
           AND l.status IN ('no_answer','voicemail')
         GROUP BY l.id
         HAVING COUNT(a.id) < 3
         ORDER BY COALESCE(l.next_callable_at, '1970-01-01 00:00:00') ASC, l.updated_at ASC, l.id ASC
         LIMIT 1`
      ).first();
      nextLead = recall;
    }

    if (!nextLead) {
      return new Response(JSON.stringify({ success: true, done: true, message: 'No callable lead found' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    action = 'call_lead';
    body.action = 'call_lead';
    body.lead_id = nextLead.id;
  }

  if (action === 'call_lead') {
    const { lead_id } = body;
    if (!lead_id) return new Response(JSON.stringify({ error: 'lead_id is required' }), { status: 400 });

    const voiceProvider = String(env?.VOICE_PROVIDER || '').toLowerCase() === 'twilio' ? 'twilio' : 'telnyx';
    if (voiceProvider === 'telnyx' && (!env?.TELNYX_API_KEY || !env?.TELNYX_FROM_NUMBER || !env?.TELNYX_CONNECTION_ID)) {
      return new Response(JSON.stringify({ error: 'Telnyx not configured' }), { status: 503 });
    }
    if (voiceProvider === 'twilio' && (!env?.TWILIO_ACCOUNT_SID || !env?.TWILIO_AUTH_TOKEN || !env?.TWILIO_FROM_NUMBER)) {
      return new Response(JSON.stringify({ error: 'Twilio not configured' }), { status: 503 });
    }

    const lead: any = await db.prepare(`SELECT * FROM outreach_leads WHERE id = ?`).bind(lead_id).first();
    if (!lead) return new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 });

    const localTz = String(lead.timezone || '').trim() || estimateTimezone(lead.country);
    const localNow = toSqlDateInTz(new Date(), localTz);
    if (localNow.hour < 9 || localNow.hour >= 17) {
      const nextAt = nextLocal9amUtcSql(new Date(), localTz);
      await db.prepare(`UPDATE outreach_leads SET next_callable_at=?, timezone=?, timezone_source=CASE WHEN COALESCE(timezone_source,'')='' THEN 'country_guess' ELSE timezone_source END, updated_at=datetime('now') WHERE id=?`)
        .bind(nextAt, localTz, lead_id)
        .run().catch(() => {});
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'outside_local_window', next_callable_at: nextAt, timezone: localTz }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const variantCode = await chooseScriptVariant(db, Number(lead_id));

    const logResult = await db.prepare(`INSERT INTO call_logs (hotel_id, status, note, created_at) VALUES (NULL, 'calling', ?, datetime('now'))`)
      .bind(`Outreach: ${lead.hotel_name} [variant:${variantCode}]`).run();
    const callLogId = (logResult as any)?.meta?.last_row_id || null;

    const baseUrl = 'https://daydreamhub.com';

    try {
      let callSid: string | null = null;
      if (voiceProvider === 'twilio') {
        const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
        const form = new URLSearchParams();
        form.set('To', lead.phone);
        form.set('From', env.TWILIO_FROM_NUMBER);
        form.set('Url', `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId || ''}`);
        form.set('Method', 'POST');
        form.set('StatusCallback', `${baseUrl}/api/webhooks/twilio-voice?lid=${callLogId || ''}&event=status`);
        form.set('StatusCallbackMethod', 'POST');
        form.set('StatusCallbackEvent', 'initiated');
        form.append('StatusCallbackEvent', 'ringing');
        form.append('StatusCallbackEvent', 'answered');
        form.append('StatusCallbackEvent', 'completed');

        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`, {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        });
        const text = await res.text();
        const data: any = text ? JSON.parse(text) : {};
        if (!res.ok) {
          await db.prepare(`UPDATE call_logs SET status='failed', error_detail=? WHERE id=?`).bind(JSON.stringify(data || text), callLogId).run().catch(() => {});
          return new Response(JSON.stringify({ error: 'Twilio error', details: data || text }), { status: res.status });
        }
        callSid = data?.sid ? `twilio:${data.sid}` : null;
      } else {
        const stateObj = { phase: 'outreach', lead_id, call_log_id: callLogId, hotel_name: lead.hotel_name, script_variant: variantCode };
        const stateBytes = new TextEncoder().encode(JSON.stringify(stateObj));
        let bin = '';
        stateBytes.forEach((b) => (bin += String.fromCharCode(b)));
        const clientState = btoa(bin);

        const res = await fetch('https://api.telnyx.com/v2/calls', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
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
          await db.prepare(`UPDATE call_logs SET status='failed', error_detail=? WHERE id=?`).bind(JSON.stringify(data), callLogId).run().catch(() => {});
          return new Response(JSON.stringify({ error: 'Telnyx error', details: data }), { status: res.status });
        }
        callSid = data?.data?.call_session_id || data?.data?.call_control_id || null;
      }
      if (callLogId && callSid) {
        await db.prepare(`UPDATE call_logs SET telnyx_call_id=? WHERE id=?`).bind(callSid, callLogId).run();
      }
      const now = new Date();
      const jst = toSqlDateInTz(now, 'Asia/Tokyo');
      const local = toSqlDateInTz(now, localTz);

      await db.prepare(`UPDATE outreach_leads SET status='calling', call_log_id=?, assigned_script_variant=?, timezone=?, next_callable_at=NULL, updated_at=datetime('now') WHERE id=?`)
        .bind(callLogId, variantCode, localTz, lead_id)
        .run();

      await db.prepare(`INSERT INTO outreach_call_attempts (
          lead_id, call_log_id, telnyx_call_id, outcome,
          call_started_at_utc, call_started_at_jst, call_started_weekday_jst, call_started_hour_jst,
          lead_timezone, call_started_at_local, call_started_weekday_local, call_started_hour_local,
          script_variant, script_prompt_version,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'in_progress', datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, 'v1', datetime('now'), datetime('now'))`)
        .bind(lead_id, callLogId, callSid, jst.dateTime, jst.weekday, jst.hour, localTz, local.dateTime, local.weekday, local.hour, variantCode)
        .run().catch(() => {});

      return new Response(JSON.stringify({ success: true, lead_id, call_log_id: callLogId, call_sid: callSid, script_variant: variantCode }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e: any) {
      await db.prepare(`UPDATE call_logs SET status='failed', error_detail=? WHERE id=?`).bind(e.message, callLogId).run().catch(() => {});
      await db.prepare(`INSERT INTO outreach_call_attempts (lead_id, call_log_id, outcome, raw_hangup_reason, call_started_at_utc, lead_timezone, script_variant, script_prompt_version, created_at, updated_at)
                  VALUES (?, ?, 'failed', ?, datetime('now'), ?, ?, 'v1', datetime('now'), datetime('now'))`)
        .bind(lead_id, callLogId, e.message || 'telnyx_error', localTz, variantCode)
        .run().catch(() => {});
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  if (action === 'update_lead') {
    const { lead_id, notes, status } = body;
    if (!lead_id) return new Response(JSON.stringify({ error: 'lead_id is required' }), { status: 400 });

    const normalizedStatus = status === undefined || status === null ? null : normalizeLeadStatus(status);
    if (status !== undefined && status !== null && !normalizedStatus) {
      return new Response(JSON.stringify({ error: 'Invalid status' }), { status: 400 });
    }

    const doNotCall = normalizedStatus && ['declined', 'not_interested'].includes(normalizedStatus) ? 1 : null;
    const needsRecall = normalizedStatus
      ? (['no_answer', 'voicemail'].includes(normalizedStatus)
        ? 1
        : (['declined', 'not_interested', 'interested', 'appointment_set', 'contact_obtained'].includes(normalizedStatus) ? 0 : null))
      : null;

    await db.prepare(`UPDATE outreach_leads
                SET notes=COALESCE(?,notes),
                    status=COALESCE(?,status),
                    do_not_call=COALESCE(?, do_not_call),
                    needs_recall=COALESCE(?, needs_recall),
                    updated_at=datetime('now')
                WHERE id=?`)
      .bind(notes ?? null, normalizedStatus ?? null, doNotCall, needsRecall, lead_id)
      .run();
    return new Response(JSON.stringify({ success: true, status: normalizedStatus }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (action === 'get_calling_status') {
    const listId = Number(body.list_id || 0);
    const listJoin = listId > 0 ? `JOIN outreach_list_members m ON m.lead_id = l.id AND m.list_id = ? AND m.status = 'active'` : '';
    const query = `SELECT COUNT(1) AS calling_count, MAX(updated_at) AS latest_update
      FROM outreach_leads l
      ${listJoin}
      WHERE l.status = 'calling'`;
    const row: any = listId > 0
      ? await db.prepare(query).bind(listId).first()
      : await db.prepare(query).first();
    return new Response(JSON.stringify({ success: true, calling_count: Number(row?.calling_count || 0), latest_update: row?.latest_update || null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'get_lead_detail') {
    const { lead_id } = body;
    if (!lead_id) return new Response(JSON.stringify({ error: 'lead_id is required' }), { status: 400 });
    const lead: any = await db.prepare(`SELECT * FROM outreach_leads WHERE id=?`).bind(Number(lead_id)).first();
    if (!lead) return new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 });

    const callLog = lead.call_log_id
      ? await db.prepare(`SELECT id, status, note, error_detail, created_at, updated_at FROM call_logs WHERE id=?`).bind(lead.call_log_id).first().catch(() => null)
      : null;

    const attempts = await db.prepare(`SELECT id, outcome, lead_timezone, call_started_at_local, script_variant, created_at FROM outreach_call_attempts WHERE lead_id=? ORDER BY created_at DESC LIMIT 10`)
      .bind(Number(lead_id)).all().catch(() => ({ results: [] }));

    return new Response(JSON.stringify({ success: true, lead, call_log: callLog, attempts: attempts?.results || [] }), {
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
