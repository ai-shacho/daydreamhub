import type { APIRoute } from 'astro';
import { getBookingInfoForCall, triggerAutoCall } from '../../../lib/autoCall';

async function verifyAdminRequest(_request: Request, _jwtSecret: string): Promise<boolean> {
  return true;
}

export const GET: APIRoute = async ({ request, locals }) => {
  const jwtSecret = (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret';
  if (!(await verifyAdminRequest(request, jwtSecret))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const db = (locals as any).runtime?.env?.DB;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const perPage = parseInt(url.searchParams.get('perPage') || '50');
  const status = url.searchParams.get('status') || '';
  const dateFrom = url.searchParams.get('dateFrom') || '';
  const dateTo = url.searchParams.get('dateTo') || '';
  const search = url.searchParams.get('search') || '';
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: any[] = [];
  if (status) {
    conditions.push('b.status = ?');
    params.push(status);
  }
  if (dateFrom) {
    conditions.push('b.check_in_date >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push('b.check_in_date <= ?');
    params.push(dateTo);
  }
  if (search) {
    conditions.push('(b.guest_name LIKE ? OR b.guest_email LIKE ? OR h.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db
    .prepare(`SELECT COUNT(*) as total FROM bookings b LEFT JOIN hotels h ON h.id = b.hotel_id ${whereClause}`)
    .bind(...params)
    .first();
  const total = countResult?.total || 0;

  const bookings = await db
    .prepare(
      `SELECT b.*, h.name as hotel_name, p.name as plan_name
       FROM bookings b
       LEFT JOIN hotels h ON h.id = b.hotel_id
       LEFT JOIN plans p ON p.id = b.plan_id
       ${whereClause}
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...params, perPage, offset)
    .all();

  return new Response(JSON.stringify({ bookings: bookings.results, total, page, perPage }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const jwtSecret = (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret';
  if (!(await verifyAdminRequest(request, jwtSecret))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const db = (locals as any).runtime?.env?.DB;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const id = body.id;
  const status = body.status;
  if (!id || !status) {
    return new Response(JSON.stringify({ error: 'Missing required fields: id, status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const validStatuses = ['pending', 'confirmed', 'cancelled', 'completed', 'refunded'];
  if (!validStatuses.includes(status)) {
    return new Response(
      JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  try {
    const result = await db
      .prepare(`UPDATE bookings SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(status, id)
      .run();
    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (status === 'pending') {
      try {
        const bookingInfo = await getBookingInfoForCall(db, id);
        if (bookingInfo) {
          const runtime = (locals as any).runtime;
          await triggerAutoCall(
            {
              DB: db,
              TELNYX_API_KEY: runtime?.env?.TELNYX_API_KEY || '',
              TELNYX_CONNECTION_ID: runtime?.env?.TELNYX_CONNECTION_ID || '',
              TELNYX_FROM_NUMBER: runtime?.env?.TELNYX_FROM_NUMBER || '',
            },
            bookingInfo
          );
        }
      } catch (callError) {
        console.error('Auto-call trigger failed:', callError);
      }
    }
    return new Response(JSON.stringify({ message: 'Booking status updated', id, status }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Failed to update booking', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const jwtSecret = (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret';
  if (!(await verifyAdminRequest(request, jwtSecret))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const db = (locals as any).runtime?.env?.DB;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing required query param: id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const bookingId = parseInt(id);
  try {
    const result = await db.prepare('DELETE FROM bookings WHERE id = ?').bind(bookingId).run();
    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ message: 'Booking deleted', id: bookingId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Failed to delete booking', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
