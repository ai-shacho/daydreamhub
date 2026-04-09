import type { APIRoute } from 'astro';
import { verifyOwner, getOwnerHotelIds } from '../../../lib/ownerAuth';
import { sendGuestBookingStatusUpdate } from '../../../lib/email';

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
  const statusFilter = url.searchParams.get('status') || '';
  const hotelFilter = url.searchParams.get('hotel_id') || '';
  const dateFrom = url.searchParams.get('from') || '';
  const dateTo = url.searchParams.get('to') || '';
  const format = url.searchParams.get('format') || 'json';

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (ownerHotelIds.length === 0) {
    if (format === 'csv')
      return new Response('No data', { headers: { 'Content-Type': 'text/csv' } });
    return new Response(JSON.stringify({ bookings: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const placeholders = ownerHotelIds.map(() => '?').join(',');
  let query = `SELECT b.*, h.name as hotel_name, p.name as plan_name
    FROM bookings b LEFT JOIN hotels h ON b.hotel_id = h.id LEFT JOIN plans p ON b.plan_id = p.id
    WHERE b.hotel_id IN (${placeholders})`;
  const binds: any[] = [...ownerHotelIds];

  if (statusFilter) {
    query += ' AND b.status = ?';
    binds.push(statusFilter);
  }
  if (hotelFilter) {
    const hid = parseInt(hotelFilter);
    if (ownerHotelIds.includes(hid)) {
      query += ' AND b.hotel_id = ?';
      binds.push(hid);
    }
  }
  if (dateFrom) {
    query += ' AND b.check_in_date >= ?';
    binds.push(dateFrom);
  }
  if (dateTo) {
    query += ' AND b.check_in_date <= ?';
    binds.push(dateTo);
  }
  query += ' ORDER BY b.created_at DESC';

  const result = await db.prepare(query).bind(...binds).all();
  const bookings: any[] = result?.results || [];

  if (format === 'csv') {
    const header =
      'ID,Guest Name,Guest Email,Guest Phone,Hotel,Plan,Check-in,Adults,Children,Infants,Amount,Status,Created';
    const rows = bookings.map(
      (b: any) =>
        `${b.id},"${(b.guest_name || '').replace(/"/g, '""')}","${b.guest_email || ''}","${b.guest_phone || ''}","${(b.hotel_name || '').replace(/"/g, '""')}","${(b.plan_name || '').replace(/"/g, '""')}",${b.check_in_date},${b.adults || 0},${b.children || 0},${b.infants || 0},${b.total_price_usd},${b.status},"${b.created_at || ''}"`
    );
    const csv = [header, ...rows].join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="bookings.csv"',
      },
    });
  }

  return new Response(JSON.stringify({ bookings }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PUT: APIRoute = async ({ request, locals }) => {
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

  const { id, status } = (await request.json()) as any;
  if (!id || !status)
    return new Response(JSON.stringify({ error: 'id and status required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!['confirmed', 'cancelled'].includes(status))
    return new Response(JSON.stringify({ error: 'Invalid status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  const booking = await db.prepare('SELECT hotel_id FROM bookings WHERE id = ?').bind(id).first();
  if (!booking || !ownerHotelIds.includes((booking as any).hotel_id)) {
    return new Response(JSON.stringify({ error: 'Booking not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  await db.prepare("UPDATE bookings SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, id).run();

  // ゲストへ承認/却下メール送信
  try {
    const RESEND_API_KEY = runtime?.env?.RESEND_API_KEY || '';
    if (RESEND_API_KEY) {
      const fullBooking = await db.prepare(`
        SELECT b.*, h.name as hotel_name, h.city, h.country, p.name as plan_name, p.check_in_time, p.check_out_time
        FROM bookings b
        LEFT JOIN hotels h ON h.id = b.hotel_id
        LEFT JOIN plans p ON p.id = b.plan_id
        WHERE b.id = ?
      `).bind(id).first() as any;

      if (fullBooking?.guest_email) {
        await sendGuestBookingStatusUpdate(RESEND_API_KEY, {
          bookingId: fullBooking.id,
          guestName: fullBooking.guest_name || '',
          guestEmail: fullBooking.guest_email,
          hotelName: fullBooking.hotel_name || '',
          hotelCity: fullBooking.city || '',
          hotelCountry: fullBooking.country || '',
          planName: fullBooking.plan_name || '',
          checkInDate: fullBooking.check_in_date || '',
          checkInTime: fullBooking.check_in_time || '',
          checkOutTime: fullBooking.check_out_time || '',
          adults: fullBooking.adults || 1,
          children: fullBooking.children || 0,
          totalPriceUsd: fullBooking.total_price_usd || 0,
          status: status as 'confirmed' | 'cancelled',
        });
      }
    }
      // DDH管理者へ通知
      const ADMIN_EMAIL = runtime?.env?.ADMIN_EMAIL || 'info@daydreamhub.com';
      try {
        const statusLabel = status === 'confirmed' ? 'Confirmed' : 'Rejected';
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'DaydreamHub <noreply@daydreamhub.com>',
            to: [ADMIN_EMAIL],
            subject: `[Booking ${statusLabel}] #${id} — ${fullBooking?.hotel_name || ''}`,
            html: `<div style="font-family:Arial,sans-serif"><h3>Booking ${statusLabel} by Owner</h3><table style="font-size:14px"><tr><td style="padding:4px 12px 4px 0;color:#888">Booking ID:</td><td>#${id}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Guest:</td><td>${fullBooking?.guest_name || ''} (${fullBooking?.guest_email || ''})</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Hotel:</td><td>${fullBooking?.hotel_name || ''}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Date:</td><td>${fullBooking?.check_in_date || ''}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#888">Status:</td><td><strong>${statusLabel}</strong></td></tr></table></div>`,
          }),
        });
      } catch {}
    }
  } catch (e) {
    console.error('Failed to send guest status email:', e);
    // メール失敗してもステータス更新は成功扱い
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
