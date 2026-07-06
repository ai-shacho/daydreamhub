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
  const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()));
  const month = parseInt(url.searchParams.get('month') || String(new Date().getMonth() + 1));
  const hotelFilter = url.searchParams.get('hotel_id') || '';

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (ownerHotelIds.length === 0)
    return new Response(JSON.stringify({ bookings: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  let filteredIds = ownerHotelIds;
  if (hotelFilter) {
    const hid = parseInt(hotelFilter);
    if (ownerHotelIds.includes(hid)) filteredIds = [hid];
    else
      return new Response(JSON.stringify({ bookings: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
  }

  const placeholders = filteredIds.map(() => '?').join(',');
  const result = await db
    .prepare(
      `SELECT b.id, b.guest_name, b.check_in_date, b.status, b.total_price_usd, h.name as hotel_name, p.name as plan_name
     FROM bookings b
     LEFT JOIN hotels h ON b.hotel_id = h.id
     LEFT JOIN plans p ON b.plan_id = p.id
     WHERE b.hotel_id IN (${placeholders}) AND b.check_in_date >= ? AND b.check_in_date < ?
     ORDER BY b.check_in_date`
    )
    .bind(...filteredIds, startDate, endDate)
    .all();

  return new Response(JSON.stringify({ bookings: result?.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
