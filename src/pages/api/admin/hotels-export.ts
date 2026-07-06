import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/apiAuth';

function formatTimestampForFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const escaped = str.replace(/"/g, '""');
  return /[",\n\r]/.test(str) ? `"${escaped}"` : escaped;
}

const HOTEL_CSV_COLUMNS: { header: string; key: string }[] = [
  { header: 'id', key: 'id' },
  { header: 'name', key: 'name' },
  { header: 'name_ja', key: 'name_ja' },
  { header: 'country', key: 'country' },
  { header: 'city', key: 'city' },
  { header: 'property_type', key: 'property_type' },
  { header: 'status', key: 'status' },
  { header: 'owner_name', key: 'owner_name' },
  { header: 'owner_login_email', key: 'owner_login_email' },
  { header: 'notification_email', key: 'email' },
  { header: 'plan_count', key: 'plan_count' },
  { header: 'active_bookings', key: 'active_bookings' },
  { header: 'created_at', key: 'created_at' },
];

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const { admin, response } = await requireAdmin(request, jwtSecret);
  if (response) return response;

  const db = env?.DB;
  if (!db) {
    return new Response('Database not available', { status: 500 });
  }

  const url = new URL(request.url);
  const countryFilter = url.searchParams.get('country') || '';
  const cityFilter = url.searchParams.get('city') || '';
  const statusFilter = url.searchParams.get('status') || '';
  const searchQuery = url.searchParams.get('q') || '';
  const sortBy = url.searchParams.get('sort') || 'name';
  const sortOrder = url.searchParams.get('order') || 'asc';
  const ownerFilter = url.searchParams.get('owner') || '';

  try {
    const validSortCols: Record<string, string> = {
      name: 'h.name',
      country: 'h.country',
      city: 'h.city',
      created_at: 'h.created_at',
      bookings: 'active_bookings',
      plans: 'plan_count',
      owner: 'h.email',
    };
    const orderCol = validSortCols[sortBy] || 'h.name';
    const orderDir = sortOrder === 'desc' ? 'DESC' : 'ASC';

    let query = `
      SELECT h.*,
        (SELECT COUNT(*) FROM plans p WHERE p.hotel_id = h.id) as plan_count,
        (SELECT COUNT(*) FROM bookings b WHERE b.hotel_id = h.id AND b.status IN ('pending', 'confirmed')) as active_bookings,
        u.email as owner_login_email,
        u.name as owner_name
      FROM hotels h
      LEFT JOIN users u ON u.email = h.email AND u.role IN ('owner', 'inactive')
      WHERE 1=1
    `;
    const binds: any[] = [];

    if (searchQuery) {
      const isNumeric = /^\d+$/.test(searchQuery.trim());
      if (isNumeric) {
        query += ' AND (h.id = ? OR h.name LIKE ? OR h.name_ja LIKE ?)';
        binds.push(parseInt(searchQuery), `%${searchQuery}%`, `%${searchQuery}%`);
      } else {
        query += ' AND (h.name LIKE ? OR h.name_ja LIKE ? OR CAST(h.id AS TEXT) LIKE ?)';
        binds.push(`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`);
      }
    }
    if (countryFilter) {
      query += ' AND h.country = ?';
      binds.push(countryFilter);
    }
    if (cityFilter) {
      query += ' AND h.city = ?';
      binds.push(cityFilter);
    }
    if (statusFilter === 'active') {
      query += " AND h.status = 'active'";
    } else if (statusFilter === 'demo') {
      query += " AND h.status = 'demo'";
    } else if (statusFilter === 'inactive') {
      query += " AND h.status = 'inactive'";
    }
    if (ownerFilter === 'assigned') {
      query += " AND h.email IS NOT NULL AND h.email != '' AND h.email IN (SELECT email FROM users WHERE role IN ('owner', 'inactive'))";
    } else if (ownerFilter === 'unassigned') {
      query += " AND (h.email IS NULL OR h.email = '' OR h.email NOT IN (SELECT email FROM users WHERE role IN ('owner', 'inactive')))";
    }

    query += ` ORDER BY ${orderCol} ${orderDir}`;

    const result = binds.length
      ? await db.prepare(query).bind(...binds).all()
      : await db.prepare(query).all();

    const hotels = result?.results || [];
    const headerLine = HOTEL_CSV_COLUMNS.map((c) => csvEscape(c.header)).join(',');
    const dataLines = hotels.map((hotel: any) => HOTEL_CSV_COLUMNS.map((c) => csvEscape(hotel[c.key])).join(','));
    const csv = [headerLine, ...dataLines].join('\r\n');
    const bom = '\uFEFF';

    return new Response(`${bom}${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="hotels-${formatTimestampForFilename()}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return new Response(`Failed to export hotels: ${e?.message || 'Unknown error'}`, { status: 500 });
  }
};
