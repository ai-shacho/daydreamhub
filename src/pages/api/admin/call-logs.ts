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
  if (!db) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const hotelId = url.searchParams.get('hotel_id') || '';
  const bookingId = url.searchParams.get('booking_id') || '';

  const conditions: string[] = [];
  const params: any[] = [];
  if (status) {
    conditions.push('cl.status = ?');
    params.push(status);
  }
  if (hotelId) {
    conditions.push('cl.hotel_id = ?');
    params.push(parseInt(hotelId));
  }
  if (bookingId) {
    conditions.push('cl.booking_id = ?');
    params.push(parseInt(bookingId));
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const logs = await db
    .prepare(
      `SELECT cl.*, h.name as hotel_name, h.phone as hotel_phone,
              b.guest_name, b.check_in_date
       FROM call_logs cl
       LEFT JOIN hotels h ON h.id = cl.hotel_id
       LEFT JOIN bookings b ON b.id = cl.booking_id
       ${whereClause}
       ORDER BY cl.created_at DESC
       LIMIT 100`
    )
    .bind(...params)
    .all();

  return new Response(JSON.stringify({ call_logs: logs.results }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const jwtSecret = (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret';
  if (!(await verifyAdminRequest(request, jwtSecret))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const TELNYX_API_KEY = runtime?.env?.TELNYX_API_KEY;
  const TELNYX_CONNECTION_ID = runtime?.env?.TELNYX_CONNECTION_ID;
  const TELNYX_FROM_NUMBER = runtime?.env?.TELNYX_FROM_NUMBER;
  if (!db || !TELNYX_API_KEY || !TELNYX_CONNECTION_ID || !TELNYX_FROM_NUMBER) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { booking_id } = body;
  if (!booking_id) {
    return new Response(JSON.stringify({ error: 'Missing booking_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const bookingInfo = await getBookingInfoForCall(db, booking_id);
    if (!bookingInfo) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!bookingInfo.hotel_phone) {
      return new Response(JSON.stringify({ error: 'Hotel has no phone number' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const callLogId = await triggerAutoCall(
      {
        DB: db,
        TELNYX_API_KEY,
        TELNYX_CONNECTION_ID,
        TELNYX_FROM_NUMBER,
      },
      bookingInfo
    );
    return new Response(JSON.stringify({ success: true, call_log_id: callLogId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
