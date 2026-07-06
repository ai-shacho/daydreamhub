import type { APIRoute } from 'astro';
import { getBookingInfoForCall, triggerAutoCall } from '../../../lib/autoCall';
import { verifyAdmin } from '../../../lib/adminAuth';

export const GET: APIRoute = async ({ request, locals }) => {
  const jwtSecret = (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
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

  const unionBase = `
    SELECT * FROM (
      SELECT
        b.id,
        b.guest_name,
        b.guest_email,
        b.adults,
        b.children,
        b.infants,
        b.check_in_date,
        b.total_price_usd,
        b.status,
        b.created_at,
        h.name as hotel_name,
        p.name as plan_name,
        'regular' as source
      FROM bookings b
      LEFT JOIN hotels h ON h.id = b.hotel_id
      LEFT JOIN plans p ON p.id = b.plan_id

      UNION ALL

      SELECT
        c.id,
        c.guest_name,
        c.guest_email,
        COALESCE(json_extract(c.request_details, '$.guests'), 1) as adults,
        0 as children,
        0 as infants,
        json_extract(c.request_details, '$.date') as check_in_date,
        c.price_quoted as total_price_usd,
        c.outcome as status,
        c.created_at,
        c.hotel_name,
        'AI Concierge' as plan_name,
        'concierge' as source
      FROM concierge_calls c
      WHERE c.guest_email IS NOT NULL
        AND c.outcome IN ('booked', 'available', 'success')
    ) u`;

  const conditions: string[] = [];
  const params: any[] = [];
  if (status) {
    conditions.push('u.status = ?');
    params.push(status);
  }
  if (dateFrom) {
    conditions.push('u.check_in_date >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push('u.check_in_date <= ?');
    params.push(dateTo);
  }
  if (search) {
    conditions.push('(u.guest_name LIKE ? OR u.guest_email LIKE ? OR u.hotel_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db
    .prepare(`SELECT COUNT(*) as total FROM (${unionBase} ${whereClause}) x`)
    .bind(...params)
    .first();
  const total = countResult?.total || 0;

  const bookings = await db
    .prepare(
      `${unionBase}
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...params, perPage, offset)
    .all();

  return new Response(JSON.stringify({ bookings: bookings.results, total, page, perPage }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

const updateBookingStatus: APIRoute = async ({ request, locals }) => {
  const jwtSecret = (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
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
              TWILIO_ACCOUNT_SID: runtime?.env?.TWILIO_ACCOUNT_SID || '',
              TWILIO_AUTH_TOKEN: runtime?.env?.TWILIO_AUTH_TOKEN || '',
              TWILIO_FROM_NUMBER: runtime?.env?.TWILIO_FROM_NUMBER || '',
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

export const PATCH: APIRoute = async ({ request, locals }) => {
  const jwtSecret = (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
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

  const id = Number(body?.id);
  const hasPriceUpdate = Object.prototype.hasOwnProperty.call(body || {}, 'total_price_usd');

  if (!id || Number.isNaN(id)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (hasPriceUpdate) {
    const price = Number(body.total_price_usd);

    if (!Number.isFinite(price) || price < 0) {
      return new Response(JSON.stringify({ error: 'total_price_usd must be a number greater than or equal to 0' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const result = await db
        .prepare(`UPDATE bookings SET total_price_usd = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(price, id)
        .run();

      if (result.meta.changes === 0) {
        return new Response(JSON.stringify({ error: 'Booking not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({ message: 'Booking price updated', id, total_price_usd: price }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return new Response(JSON.stringify({ error: 'Failed to update booking price', details: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const status = body?.status;
  if (!status) {
    return new Response(JSON.stringify({ error: 'Missing required fields: status or total_price_usd' }), {
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
              TWILIO_ACCOUNT_SID: runtime?.env?.TWILIO_ACCOUNT_SID || '',
              TWILIO_AUTH_TOKEN: runtime?.env?.TWILIO_AUTH_TOKEN || '',
              TWILIO_FROM_NUMBER: runtime?.env?.TWILIO_FROM_NUMBER || '',
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

export const PUT = updateBookingStatus;

export const DELETE: APIRoute = async ({ request, locals }) => {
  const jwtSecret = (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
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
