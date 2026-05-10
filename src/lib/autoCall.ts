const COUNTRY_TIMEZONES: Record<string, string> = {
  // Asia
  'Thailand': 'Asia/Bangkok',
  'Japan': 'Asia/Tokyo',
  'Pakistan': 'Asia/Karachi',
  'India': 'Asia/Kolkata',
  'Philippines': 'Asia/Manila',
  'Vietnam': 'Asia/Ho_Chi_Minh',
  'Indonesia': 'Asia/Jakarta',
  'Malaysia': 'Asia/Kuala_Lumpur',
  'Singapore': 'Asia/Singapore',
  'South Korea': 'Asia/Seoul',
  'China': 'Asia/Shanghai',
  'Taiwan': 'Asia/Taipei',
  'Cambodia': 'Asia/Phnom_Penh',
  'Myanmar': 'Asia/Yangon',
  'Laos': 'Asia/Vientiane',
  'Nepal': 'Asia/Kathmandu',
  'Sri Lanka': 'Asia/Colombo',
  'Bangladesh': 'Asia/Dhaka',
  'UAE': 'Asia/Dubai',
  'United Arab Emirates': 'Asia/Dubai',
  'Saudi Arabia': 'Asia/Riyadh',
  'Turkey': 'Europe/Istanbul',
  // Europe
  'United Kingdom': 'Europe/London',
  'UK': 'Europe/London',
  'France': 'Europe/Paris',
  'Germany': 'Europe/Berlin',
  'Italy': 'Europe/Rome',
  'Spain': 'Europe/Madrid',
  'Netherlands': 'Europe/Amsterdam',
  'Portugal': 'Europe/Lisbon',
  'Greece': 'Europe/Athens',
  'Switzerland': 'Europe/Zurich',
  // Americas
  'United States': 'America/New_York',
  'USA': 'America/New_York',
  'Canada': 'America/Toronto',
  'Mexico': 'America/Mexico_City',
  'Brazil': 'America/Sao_Paulo',
  'Colombia': 'America/Bogota',
  'Argentina': 'America/Buenos_Aires',
  // Oceania
  'Australia': 'Australia/Sydney',
  'New Zealand': 'Pacific/Auckland',
};

function getLocalHour(country: string): number | null {
  const tz = COUNTRY_TIMEZONES[country];
  if (!tz) return null;
  const now = new Date();
  const localTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return localTime.getHours();
}

function isQuietHours(country: string): boolean {
  const hour = getLocalHour(country);
  if (hour === null) return false;
  return hour >= 0 && hour < 5;
}

function getNext5amUtc(country: string): string | null {
  const tz = COUNTRY_TIMEZONES[country];
  if (!tz) return null;
  const now = new Date();
  const localStr = now.toLocaleString('en-US', { timeZone: tz });
  const localNow = new Date(localStr);
  const target = new Date(localNow);
  target.setHours(5, 0, 0, 0);
  if (localNow >= target) {
    target.setDate(target.getDate() + 1);
  }
  const diffMs = target.getTime() - localNow.getTime();
  const utcTarget = new Date(now.getTime() + diffMs);
  return utcTarget.toISOString().replace('T', ' ').slice(0, 19);
}

export async function triggerAutoCall(env: any, booking: any): Promise<number | null> {
  if (!booking.hotel_phone) return null;
  const db = env.DB;
  const quiet = isQuietHours(booking.hotel_country);
  const scheduledAt = quiet ? getNext5amUtc(booking.hotel_country) : null;
  const status = quiet ? 'queued' : 'calling';
  const result = await db
    .prepare(
      `INSERT INTO call_logs (booking_id, hotel_id, status, attempt_number, scheduled_at, created_at)
       VALUES (?, ?, ?, 1, ?, datetime('now'))`
    )
    .bind(booking.booking_id, booking.hotel_id, status, scheduledAt)
    .run();
  const callLogId = result.meta.last_row_id;
  if (!quiet) {
    await initiateCall(env, callLogId, booking);
  }
  return callLogId;
}

export async function initiateCall(env: any, callLogId: number, booking: any): Promise<void> {
  const db = env.DB;
  const webhookUrl = (env?.SITE_URL || 'https://daydreamhub-1sv.pages.dev') + '/api/webhooks/telnyx-voice';
  try {
    const response = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: env.TELNYX_CONNECTION_ID,
        to: booking.hotel_phone,
        from: env.TELNYX_FROM_NUMBER,
        webhook_url: webhookUrl,
        webhook_url_method: 'POST',
        client_state: btoa(
          JSON.stringify({
            call_log_id: callLogId,
            booking_id: booking.booking_id,
            hotel_id: booking.hotel_id,
            plan_id: booking.plan_id,
            guest_name: booking.guest_name,
            check_in_date: booking.check_in_date,
            check_in_time: booking.check_in_time,
            check_out_time: booking.check_out_time,
            guests: booking.guests,
            plan_name: booking.plan_name,
            hotel_name: booking.hotel_name,
          })
        ),
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Telnyx API error: ${response.status} ${err}`);
    }
    const data: any = await response.json();
    const callControlId = data.data.call_control_id;
    await db
      .prepare(
        `UPDATE call_logs SET telnyx_call_id = ?, status = 'calling', started_at = datetime('now') WHERE id = ?`
      )
      .bind(callControlId, callLogId)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await db
      .prepare(
        `UPDATE call_logs SET status = 'failed', error_detail = ?, ended_at = datetime('now') WHERE id = ?`
      )
      .bind(message, callLogId)
      .run();
  }
}

export async function getBookingInfoForCall(db: any, bookingId: number): Promise<any | null> {
  const row = await db
    .prepare(
      `SELECT b.id as booking_id, b.hotel_id, b.plan_id, b.guest_name, b.check_in_date,
              b.check_in_time, b.check_out_time,
              (b.adults + b.children) as guests,
              h.name as hotel_name, h.phone as hotel_phone, h.country as hotel_country,
              p.name as plan_name
       FROM bookings b
       LEFT JOIN hotels h ON h.id = b.hotel_id
       LEFT JOIN plans p ON p.id = b.plan_id
       WHERE b.id = ?`
    )
    .bind(bookingId)
    .first();
  if (!row) return null;
  return {
    booking_id: row.booking_id,
    hotel_id: row.hotel_id,
    plan_id: row.plan_id,
    hotel_name: row.hotel_name || 'Hotel',
    hotel_phone: row.hotel_phone || '',
    hotel_country: row.hotel_country || '',
    guest_name: row.guest_name || 'Guest',
    check_in_date: row.check_in_date || '',
    check_in_time: row.check_in_time || '',
    check_out_time: row.check_out_time || '',
    guests: row.guests || 1,
    plan_name: row.plan_name || 'Room',
  };
}
