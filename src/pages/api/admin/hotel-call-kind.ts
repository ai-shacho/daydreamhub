import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/apiAuth';

// Set, by hand, what kind of business a listing is — and therefore whether the
// automated booking-request call belongs there at all.
//
// The checked classification in src/lib/data/hotelCallKind.ts is a starting
// point built from evidence found on the web. This is the correction: an admin
// who knows the property overrides it, and the override wins everywhere.
const json = { 'Content-Type': 'application/json' };

const KINDS = new Set(['hotel', 'apartment', 'spa_salon', 'private_host', 'not_real', 'unclear']);

export const POST: APIRoute = async ({ request, locals }) => {
  const { response, admin } = await requireAdmin(request, (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret');
  if (response) return response;

  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json }); }

  const id = Number(body?.hotel_id);
  if (!Number.isFinite(id) || id <= 0) {
    return new Response(JSON.stringify({ error: 'hotel_id required' }), { status: 400, headers: json });
  }

  // An empty value clears the override and hands the row back to the checked
  // classification, which is a real thing an admin may want to do.
  const raw = body?.kind;
  const kind = raw === null || raw === undefined || raw === '' ? null : String(raw);
  if (kind !== null && !KINDS.has(kind)) {
    return new Response(JSON.stringify({ error: `kind must be one of ${[...KINDS].join(', ')}, or empty to clear` }), { status: 400, headers: json });
  }

  const who = String((admin as any)?.email || 'admin');
  try {
    await db.prepare(
      `UPDATE hotels
          SET call_kind = ?,
              call_kind_set_by = ?,
              call_kind_set_at = ?
        WHERE id = ?`
    ).bind(kind, kind === null ? null : who, kind === null ? null : new Date().toISOString(), id).run();
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: json });
  }

  return new Response(JSON.stringify({ success: true, hotel_id: id, kind }), { headers: json });
};
