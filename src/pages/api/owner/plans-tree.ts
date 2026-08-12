import type { APIRoute } from 'astro';
import { requireOwner } from '../../../lib/apiAuth';

// Every plan the signed-in owner controls, grouped hotel → room type, so the
// add-on copy dialog can offer them as a checkbox tree. Same-name plans exist
// across properties, so the hotel and room type have to come with each entry.
export const GET: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'Database not available' }), { status: 503, headers: json });

  const { owner, response } = await requireOwner(request, env?.JWT_SECRET || 'dev-secret');
  if (response) return response;

  const rows: any[] = ((await db.prepare(
    `SELECT h.id AS hotel_id, h.name AS hotel_name, h.currency AS hotel_currency,
            p.id AS plan_id, p.name AS plan_name, p.room_type,
            (SELECT COUNT(*) FROM plan_options o WHERE o.plan_id = p.id) AS option_count
       FROM plans p
       JOIN hotels h ON h.id = p.hotel_id
      WHERE LOWER(TRIM(h.email)) = LOWER(TRIM(?))
      ORDER BY h.name COLLATE NOCASE, p.room_type COLLATE NOCASE, p.sort_order, p.id`
  ).bind(owner.email).all().catch(() => null))?.results) || [];

  const hotels: any[] = [];
  const byHotel = new Map<number, any>();
  for (const r of rows) {
    let h = byHotel.get(r.hotel_id);
    if (!h) {
      h = { id: r.hotel_id, name: r.hotel_name, currency: String(r.hotel_currency || 'USD').toUpperCase(), plans: [] };
      byHotel.set(r.hotel_id, h);
      hotels.push(h);
    }
    h.plans.push({
      id: r.plan_id,
      name: r.plan_name,
      room_type: r.room_type || '',
      option_count: Number(r.option_count || 0),
    });
  }

  return new Response(JSON.stringify({ hotels }), { headers: json });
};
