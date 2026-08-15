import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/apiAuth';

// Write the phone numbers an admin approved on /admin/hotel-phone-update.
//
// Deliberately narrow: it takes an explicit list of {hotel_id, phone,
// notify_phone} that a person looked at and ticked, and writes only the fields
// present in each row. No matching happens here — the page did that and showed
// its work — so a bad match cannot be applied by accident from elsewhere.
const json = { 'Content-Type': 'application/json' };

export const POST: APIRoute = async ({ request, locals }) => {
  const { response } = await requireAdmin(request, (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret');
  if (response) return response;

  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json }); }

  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (!rows.length) return new Response(JSON.stringify({ error: 'rows required' }), { status: 400, headers: json });

  // A number we would dial: a plus, then 7-15 digits.
  const ok = (v: any) => typeof v === 'string' && /^\+\d{7,15}$/.test(v.trim());

  let updated = 0;
  const skipped: any[] = [];

  for (const r of rows) {
    const id = Number(r?.hotel_id);
    if (!Number.isFinite(id) || id <= 0) { skipped.push({ row: r, why: 'bad hotel id' }); continue; }

    const sets: string[] = [];
    const binds: any[] = [];
    if (r.phone !== undefined && r.phone !== null && String(r.phone).trim() !== '') {
      if (!ok(r.phone)) { skipped.push({ hotel_id: id, why: `phone "${r.phone}" is not in international form` }); continue; }
      sets.push('phone = ?'); binds.push(String(r.phone).trim());
    }
    if (r.notify_phone !== undefined && r.notify_phone !== null && String(r.notify_phone).trim() !== '') {
      if (!ok(r.notify_phone)) { skipped.push({ hotel_id: id, why: `notify_phone "${r.notify_phone}" is not in international form` }); continue; }
      sets.push('notify_phone = ?'); binds.push(String(r.notify_phone).trim());
    }
    if (!sets.length) { skipped.push({ hotel_id: id, why: 'nothing to write' }); continue; }

    try {
      await db.prepare(`UPDATE hotels SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
      updated++;
    } catch (e: any) {
      skipped.push({ hotel_id: id, why: e?.message || String(e) });
    }
  }

  return new Response(JSON.stringify({ success: true, updated, skipped }), { headers: json });
};
