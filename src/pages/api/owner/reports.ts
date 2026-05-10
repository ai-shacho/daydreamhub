import type { APIRoute } from 'astro';
import { verifyOwner, getOwnerHotelIds } from '../../../lib/ownerAuth';

export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner)
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!db)
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '3m';
  const hotelFilter = url.searchParams.get('hotel_id') || '';

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (ownerHotelIds.length === 0)
    return new Response(JSON.stringify({ monthly: [], planBreakdown: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });

  let filteredIds = ownerHotelIds;
  if (hotelFilter) {
    const hid = parseInt(hotelFilter);
    if (ownerHotelIds.includes(hid)) filteredIds = [hid];
  }

  const now = new Date();
  let monthsBack = 3;
  if (period === '1m') monthsBack = 1;
  else if (period === '6m') monthsBack = 6;
  else if (period === '1y') monthsBack = 12;

  const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const startDateStr = startDate.toISOString().split('T')[0];

  const placeholders = filteredIds.map(() => '?').join(',');
  const monthlyResult = await db
    .prepare(
      `
    SELECT
      strftime('%Y-%m', check_in_date) as month,
      COUNT(*) as booking_count,
      SUM(CASE WHEN status = 'confirmed' THEN total_price_usd ELSE 0 END) as revenue,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_count,
      COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_count
    FROM bookings
    WHERE hotel_id IN (${placeholders})
      AND check_in_date >= ?
    GROUP BY strftime('%Y-%m', check_in_date)
    ORDER BY month
  `
    )
    .bind(...filteredIds, startDateStr)
    .all();

  const planResult = await db
    .prepare(
      `
    SELECT p.name, COUNT(*) as count,
      SUM(CASE WHEN b.status = 'confirmed' THEN b.total_price_usd ELSE 0 END) as revenue
    FROM bookings b
    LEFT JOIN plans p ON b.plan_id = p.id
    WHERE b.hotel_id IN (${placeholders})
      AND b.check_in_date >= date('now', 'start of month')
    GROUP BY p.id
    ORDER BY revenue DESC
  `
    )
    .bind(...filteredIds)
    .all();

  return new Response(
    JSON.stringify({
      monthly: monthlyResult?.results || [],
      planBreakdown: planResult?.results || [],
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
