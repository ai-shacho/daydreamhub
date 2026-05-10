import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  const url = new URL(request.url);
  const planId = url.searchParams.get('planId');

  if (!planId) {
    return new Response(JSON.stringify({ error: 'planId required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!db) {
    return new Response(JSON.stringify({ blocked: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Get hotel_id from plan
    const plan = await db.prepare('SELECT hotel_id FROM plans WHERE id = ?').bind(Number(planId)).first();
    if (!plan) {
      return new Response(JSON.stringify({ blocked: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const hotelId = plan.hotel_id;
    const today = new Date().toISOString().split('T')[0];

    // Fetch dates blocked for this hotel (all plans) OR this specific plan
    const result = await db.prepare(
      `SELECT DISTINCT blocked_date FROM blocked_dates
       WHERE hotel_id = ?
         AND (plan_id IS NULL OR plan_id = ?)
         AND blocked_date >= ?
       ORDER BY blocked_date`
    ).bind(hotelId, Number(planId), today).all();

    const blocked = (result?.results || []).map((r: any) => r.blocked_date);

    return new Response(JSON.stringify({ blocked }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // 5分キャッシュ
      },
    });
  } catch (e) {
    console.error('availability error:', e);
    return new Response(JSON.stringify({ blocked: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
