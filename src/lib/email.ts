function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const SITE_URL = 'https://daydreamhub.com';

const MONTH_NAMES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function formatDate(dateStr: string): string {
  if (!dateStr) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const month = MONTH_NAMES_EN[parseInt(parts[1]) - 1] || parts[1];
  return `${month} ${parseInt(parts[2])}, ${parts[0]}`;
}

function hotelLink(hotelName: string, hotelSlug?: string): string {
  const name = escapeHtml(hotelName);
  if (hotelSlug) {
    return `<a href="${SITE_URL}/hotel/${hotelSlug}" style="color:#0d9488;text-decoration:none;font-weight:600">${name}</a>`;
  }
  return `<strong>${name}</strong>`;
}

function emailFooter(): string {
  return `
    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;text-align:center">
      <a href="${SITE_URL}" style="text-decoration:none">
        <span style="font-size:18px;font-weight:700;color:#4b5563">DayDream</span><span style="font-size:18px;font-weight:700;color:#5ba8c8">Hub</span>
      </a>
      <p style="color:#9ca3af;font-size:11px;margin:8px 0 0;line-height:1.6">
        Day-Use Hotel Booking Worldwide<br>
        <a href="${SITE_URL}" style="color:#9ca3af">${SITE_URL.replace('https://', '')}</a>
        &nbsp;|&nbsp; <a href="${SITE_URL}/contact" style="color:#9ca3af">Contact Us</a>
        &nbsp;|&nbsp; <a href="${SITE_URL}/faq" style="color:#9ca3af">FAQ</a>
      </p>
      <p style="color:#d1d5db;font-size:10px;margin:12px 0 0">
        &copy; 2026 Day Dream Hub.com LLC All Rights Reserved.
      </p>
    </div>`;
}

async function sendEmail(params: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ success: boolean; error?: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      reply_to: params.replyTo,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `Resend API error: ${res.status} ${text}` };
  }
  return { success: true };
}

export async function sendWelcomeEmail(
  apiKey: string,
  data: {
    name: string;
    email: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const subject = 'Welcome to DaydreamHub 🌿';
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#46a3c2;color:white;padding:32px 24px;text-align:center;border-radius:8px 8px 0 0">
    <div style="font-size:40px;margin-bottom:12px">🌿</div>
    <h1 style="margin:0;font-size:24px;font-weight:700">Welcome to DaydreamHub!</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:15px">Your account has been created successfully.</p>
  </div>

  <div style="padding:32px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#ffffff">
    <p style="font-size:16px;margin-top:0">Hi <strong>${escapeHtml(data.name)}</strong> 👋</p>
    <p style="color:#374151;line-height:1.6">
      Thank you for joining DaydreamHub — the easiest way to book day-use hotel rooms worldwide.
      Enjoy a pool, spa, workspace, or simply a place to relax between flights.
    </p>

    <div style="background:#eef7fb;border:1px solid #b3d9e8;border-radius:8px;padding:20px;margin:24px 0">
      <h2 style="margin:0 0 14px;font-size:15px;color:#46a3c2;font-weight:700">✅ What you can do now</h2>
      <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.8">
        <li>Search hotels by city or country</li>
        <li>Book day-use rooms with instant payment</li>
        <li>Save your favourite hotels to your wishlist</li>
        <li>Manage all bookings from <strong>My Page</strong></li>
      </ul>
    </div>

    <div style="text-align:center;margin:28px 0">
      <a href="${SITE_URL}/search"
         style="display:inline-block;padding:14px 32px;background:#46a3c2;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">
        Find a Hotel →
      </a>
    </div>

    ${emailFooter()}
  </div>
</div>`;

  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.email,
    subject,
    html,
  });
}

export async function sendStaffInvitationEmail(
  apiKey: string,
  data: {
    name: string;
    email: string;
    staffRole: 'co_owner' | 'booking_manager';
    hotelName: string;
    inviterName?: string;
    invitationLink: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const roleLabel = data.staffRole === 'co_owner' ? 'Co-owner' : 'Booking Manager';
  const roleDesc = data.staffRole === 'co_owner'
    ? 'You have <strong>full access</strong> — same permissions as the hotel owner, including hotel editing, reports, and staff management.'
    : 'You can <strong>manage bookings, calendar, messages, and reviews</strong>. Hotel editing, reports, and staff management are restricted.';
  const subject = `You're invited to DaydreamHub Owner Portal 🏨`;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#46a3c2;color:white;padding:32px 24px;text-align:center;border-radius:8px 8px 0 0">
    <div style="font-size:40px;margin-bottom:12px">🏨</div>
    <h1 style="margin:0;font-size:24px;font-weight:700">You've Been Invited!</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:15px">Join the DaydreamHub Owner Portal</p>
  </div>
  <div style="padding:32px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#fff">
    <p style="font-size:16px;margin-top:0">Hi <strong>${escapeHtml(data.name)}</strong> 👋</p>
    <p style="color:#374151;line-height:1.6">
      ${data.inviterName ? `<strong>${escapeHtml(data.inviterName)}</strong> has invited you` : 'You have been invited'} to join <strong>${escapeHtml(data.hotelName)}</strong> on DaydreamHub Owner Portal as a <strong>${roleLabel}</strong>.
    </p>

    <div style="background:#eef7fb;border:1px solid #b3d9e8;border-radius:8px;padding:20px;margin:24px 0">
      <h2 style="margin:0 0 10px;font-size:14px;color:#46a3c2;font-weight:700">👤 Your Role: ${roleLabel}</h2>
      <p style="margin:0;color:#374151;font-size:13px;line-height:1.6">${roleDesc}</p>
    </div>

    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:20px;margin:24px 0">
      <h2 style="margin:0 0 10px;font-size:14px;color:#92400e;font-weight:700">🔑 Set Your Password</h2>
      <p style="margin:0 0 12px;color:#374151;font-size:13px;line-height:1.6">
        Click the button below to create your password and activate your account. This link will expire in <strong>7 days</strong>.
      </p>
    </div>

    <div style="text-align:center;margin:28px 0">
      <a href="${data.invitationLink}"
         style="display:inline-block;padding:14px 32px;background:#46a3c2;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">
        Set Password & Activate Account →
      </a>
    </div>

    <p style="color:#6b7280;font-size:12px;margin-top:24px;border-top:1px solid #f3f4f6;padding-top:16px;word-break:break-all">
      If the button does not work, copy and paste this link into your browser:<br>
      <a href="${data.invitationLink}" style="color:#46a3c2">${data.invitationLink}</a>
    </p>
    <p style="color:#9ca3af;font-size:11px;margin-top:12px">
      Your login email: <strong>${escapeHtml(data.email)}</strong>
    </p>
    ${emailFooter()}
  </div>
</div>`;

  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.email,
    subject,
    html,
  });
}

export async function sendOwnerAccountEmail(
  apiKey: string,
  data: { name: string; email: string; password: string }
): Promise<{ success: boolean; error?: string }> {
  const subject = 'Your DaydreamHub Owner Account is Ready 🏨';
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#46a3c2;color:white;padding:32px 24px;text-align:center;border-radius:8px 8px 0 0">
    <div style="font-size:40px;margin-bottom:12px">🏨</div>
    <h1 style="margin:0;font-size:24px;font-weight:700">Welcome to DaydreamHub Owner Portal!</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:15px">Your hotel management account has been created.</p>
  </div>
  <div style="padding:32px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#fff">
    <p style="font-size:16px;margin-top:0">Hi <strong>${escapeHtml(data.name)}</strong> 👋</p>
    <p style="color:#374151;line-height:1.6">Your owner account for DaydreamHub has been set up. You can now manage your hotel listings, bookings, and more.</p>
    <div style="background:#eef7fb;border:1px solid #b3d9e8;border-radius:8px;padding:20px;margin:24px 0">
      <h2 style="margin:0 0 14px;font-size:15px;color:#46a3c2;font-weight:700">🔑 Your Login Details</h2>
      <table style="font-size:14px;color:#374151">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email:</td><td style="font-weight:600">${escapeHtml(data.email)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Password:</td><td style="font-weight:600">${escapeHtml(data.password)}</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:28px 0">
      <a href="${SITE_URL}/login?redirect=/owner"
         style="display:inline-block;padding:14px 32px;background:#46a3c2;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">
        Log in to Owner Portal →
      </a>
    </div>
    <p style="color:#6b7280;font-size:12px;margin-top:24px;border-top:1px solid #f3f4f6;padding-top:16px">
      We recommend changing your password after your first login.
    </p>
    ${emailFooter()}
  </div>
</div>`;

  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.email,
    subject,
    html,
  });
}

export async function sendBookingNotificationToHotel(
  apiKey: string,
  data: {
    bookingId: number;
    guestName: string;
    guestEmail: string;
    guestPhone?: string;
    checkInDate: string;
    planName: string;
    adults: number;
    children: number;
    infants: number;
    totalPriceUsd: number;
    notes?: string;
    hotelName: string;
    hotelEmail: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const subject = `New Booking #${data.bookingId} - ${data.guestName} on ${data.checkInDate}`;
  const rows: [string, string][] = [
    ['Booking ID', `#${data.bookingId}`],
    ['Guest Name', data.guestName],
    ['Guest Email', data.guestEmail],
    ['Guest Phone', data.guestPhone || '-'],
    ['Check-in Date', data.checkInDate],
    ['Plan', data.planName],
    ['Adults', String(data.adults)],
    ['Children', String(data.children)],
    ['Infants', String(data.infants)],
    ['Total (USD)', `$${data.totalPriceUsd.toFixed(2)}`],
    ['Notes', data.notes || '-'],
  ];
  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">${escapeHtml(label)}</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(value)}</td></tr>`
    )
    .join('');
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#333">New Booking Received</h2>
  <p>A new booking has been made at <strong>${escapeHtml(data.hotelName)}</strong>.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    ${tableRows}
  </table>
  <div style="margin:24px 0;padding:16px;background:#fff3cd;border:1px solid #ffc107;border-radius:4px">
    <strong>⚡ Action Required:</strong> Please log in to your Owner Portal to confirm or decline this booking within 24 hours.
  </div>
  <div style="text-align:center;margin:20px 0">
    <a href="${SITE_URL}/owner/bookings" style="display:inline-block;padding:12px 28px;background:#0d9488;color:white;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px">
      Confirm or Decline → Owner Portal
    </a>
  </div>
  <p style="color:#666;font-size:12px">This is an automated notification from DaydreamHub. Reply to this email to contact the guest directly.</p>
</div>`;
  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.hotelEmail,
    subject,
    html,
    replyTo: data.guestEmail,
  });
}

export async function sendConciergeConfirmation(
  apiKey: string,
  data: {
    guestName: string;
    guestEmail: string;
    hotelName: string;
    hotelPhone: string;
    date: string;
    checkIn: string;
    checkOut: string;
    guests: number;
    priceQuoted?: string;
    aiSummary?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const subject = `Your Hotel Booking at ${data.hotelName} - DaydreamHub`;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#059669;color:white;padding:24px;text-align:center;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:24px">Booking Confirmed!</h1>
    <p style="margin:8px 0 0;opacity:0.9">DaydreamHub AI Concierge</p>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <p style="font-size:16px">Hello ${escapeHtml(data.guestName)},</p>
    <p>Your hotel booking has been confirmed by AI phone call. Here are the details:</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0">
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Hotel</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.hotelName)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Phone</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.hotelPhone)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Date</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.date)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Check-in</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.checkIn)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Check-out</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.checkOut)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Guests</td><td style="padding:8px 12px;border:1px solid #ddd">${data.guests}</td></tr>
      ${data.priceQuoted ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Quoted Price</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.priceQuoted)}</td></tr>` : ''}
    </table>
    <div style="margin:16px 0;padding:12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:4px">
      <strong>Important:</strong> The hotel room charge is paid directly at the hotel upon check-in. The $7 service fee was for the AI booking call only.
    </div>
    ${data.aiSummary ? `<div style="margin:16px 0;padding:12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px"><strong>Call Summary:</strong><br>${escapeHtml(data.aiSummary)}</div>` : ''}
    <p style="color:#666;font-size:12px;margin-top:24px">DaydreamHub AI Concierge - <a href="${SITE_URL}">daydreamhub.com</a></p>
  </div>
</div>`;
  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.guestEmail,
    subject,
    html,
  });
}

export async function sendGuestBookingStatusUpdate(
  apiKey: string,
  data: {
    bookingId: number;
    guestName: string;
    guestEmail: string;
    hotelName: string;
    hotelCity: string;
    hotelCountry: string;
    planName: string;
    checkInDate: string;
    checkInTime: string;
    checkOutTime: string;
    adults: number;
    children: number;
    totalPriceUsd: number;
    status: 'confirmed' | 'cancelled';
    cancelReason?: string;
    hotelSlug?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const isConfirmed = data.status === 'confirmed';
  const subject = isConfirmed
    ? `✅ Booking Confirmed #${data.bookingId} — ${data.hotelName}`
    : `❌ Booking Cancelled #${data.bookingId} — ${data.hotelName}`;

  const headerBg = isConfirmed ? '#059669' : '#6b7280';
  const headerEmoji = isConfirmed ? '✅' : '❌';
  const headerTitle = isConfirmed ? 'Booking Confirmed!' : 'Booking Cancelled';
  const headerSub = isConfirmed
    ? 'Your day-use hotel booking has been confirmed.'
    : 'Unfortunately, your booking request could not be accommodated.';

  const guestCount = data.children > 0
    ? `${data.adults} adult${data.adults > 1 ? 's' : ''}, ${data.children} child${data.children > 1 ? 'ren' : ''}`
    : `${data.adults} adult${data.adults > 1 ? 's' : ''}`;

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:${headerBg};color:white;padding:28px 24px;text-align:center;border-radius:8px 8px 0 0">
    <div style="font-size:40px;margin-bottom:8px">${headerEmoji}</div>
    <h1 style="margin:0;font-size:22px;font-weight:700">${headerTitle}</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${headerSub}</p>
  </div>

  <div style="padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#ffffff">
    <p style="font-size:16px;margin-top:0">Hello <strong>${escapeHtml(data.guestName)}</strong>,</p>

    ${isConfirmed
      ? `<p style="color:#374151">Great news! <strong>${escapeHtml(data.hotelName)}</strong> has confirmed your booking. Please arrive on time and present your booking ID at check-in.</p>`
      : `<p style="color:#374151">We're sorry, but <strong>${escapeHtml(data.hotelName)}</strong> was unable to accommodate your booking request.${data.cancelReason ? ` Reason: ${escapeHtml(data.cancelReason)}` : ''}</p>`
    }

    <div style="background:${isConfirmed ? '#f0fdfa' : '#f9fafb'};border:1px solid ${isConfirmed ? '#99f6e4' : '#e5e7eb'};border-radius:8px;padding:20px;margin:20px 0">
      <h2 style="margin:0 0 16px;font-size:16px;color:${isConfirmed ? '#0d9488' : '#6b7280'}">📋 Booking Details</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-weight:600;background:${isConfirmed ? '#f0fdfa' : '#f9fafb'};width:38%;font-size:13px">Booking ID</td><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-size:13px"><strong>#${data.bookingId}</strong></td></tr>
        <tr><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-weight:600;background:${isConfirmed ? '#f0fdfa' : '#f9fafb'};font-size:13px">Hotel</td><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-size:13px">${hotelLink(data.hotelName, data.hotelSlug)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-weight:600;background:${isConfirmed ? '#f0fdfa' : '#f9fafb'};font-size:13px">Location</td><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-size:13px">${escapeHtml(data.hotelCity)}, ${escapeHtml(data.hotelCountry)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-weight:600;background:${isConfirmed ? '#f0fdfa' : '#f9fafb'};font-size:13px">Plan</td><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-size:13px">${escapeHtml(data.planName)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-weight:600;background:${isConfirmed ? '#f0fdfa' : '#f9fafb'};font-size:13px">Date</td><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-size:13px">${formatDate(data.checkInDate)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-weight:600;background:${isConfirmed ? '#f0fdfa' : '#f9fafb'};font-size:13px">Time</td><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-size:13px">${escapeHtml(data.checkInTime)} – ${escapeHtml(data.checkOutTime)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-weight:600;background:${isConfirmed ? '#f0fdfa' : '#f9fafb'};font-size:13px">Guests</td><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-size:13px">${escapeHtml(guestCount)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-weight:600;background:${isConfirmed ? '#f0fdfa' : '#f9fafb'};font-size:13px">Amount</td><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-size:13px"><strong>$${data.totalPriceUsd.toFixed(2)} USD</strong></td></tr>
      </table>
    </div>

    ${isConfirmed
      ? `<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:6px;padding:14px 16px;margin:16px 0;font-size:13px">
          📍 <strong>Please show this email or your booking ID (#${data.bookingId}) at the hotel front desk.</strong>
        </div>
        <div style="text-align:center;margin:24px 0">
          <a href="${SITE_URL}/mypage" style="display:inline-block;padding:12px 28px;background:#059669;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">View My Booking</a>
        </div>`
      : `<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:6px;padding:14px 16px;margin:16px 0;font-size:13px">
          💳 If you were charged, a full refund will be processed within 5-10 business days.
        </div>
        <div style="text-align:center;margin:24px 0">
          <a href="${SITE_URL}/search" style="display:inline-block;padding:12px 28px;background:#0d9488;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">Find Another Hotel</a>
        </div>`
    }

    ${emailFooter()}
  </div>
</div>`;

  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.guestEmail,
    subject,
    html,
  });
}

export async function sendGuestBookingConfirmation(
  apiKey: string,
  data: {
    bookingId: number;
    guestName: string;
    guestEmail: string;
    hotelName: string;
    hotelCity: string;
    hotelCountry: string;
    planName: string;
    checkInDate: string;
    checkInTime: string;
    checkOutTime: string;
    adults: number;
    children: number;
    totalPriceUsd: number;
    notes?: string;
    cancellationHours?: number | null;
  }
): Promise<{ success: boolean; error?: string }> {
  const subject = `Booking Request Received #${data.bookingId} — DaydreamHub`;
  const guestCount = data.children > 0
    ? `${data.adults} adult${data.adults > 1 ? 's' : ''}, ${data.children} child${data.children > 1 ? 'ren' : ''}`
    : `${data.adults} adult${data.adults > 1 ? 's' : ''}`;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#0d9488;color:white;padding:28px 24px;text-align:center;border-radius:8px 8px 0 0">
    <div style="font-size:36px;margin-bottom:8px">🏨</div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Booking Request Received!</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">We've notified the hotel and are awaiting confirmation.</p>
  </div>

  <div style="padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#ffffff">
    <p style="font-size:16px;margin-top:0">Hello <strong>${escapeHtml(data.guestName)}</strong>,</p>
    <p style="color:#374151">Your payment of <strong>$${data.totalPriceUsd.toFixed(2)}</strong> has been received. The hotel will confirm your booking shortly — we'll send you another email once confirmed.</p>

    <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:20px;margin:20px 0">
      <h2 style="margin:0 0 16px;font-size:16px;color:#0d9488">📋 Booking Details</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;width:38%;font-size:13px">Booking ID</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px"><strong>#${data.bookingId}</strong></td></tr>
        <tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Hotel</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px">${escapeHtml(data.hotelName)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Location</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px">${escapeHtml(data.hotelCity)}, ${escapeHtml(data.hotelCountry)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Plan</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px">${escapeHtml(data.planName)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Date</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px">${formatDate(data.checkInDate)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Time</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px">${escapeHtml(data.checkInTime)} – ${escapeHtml(data.checkOutTime)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Guests</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px">${escapeHtml(guestCount)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Total Paid</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px"><strong style="color:#0d9488">$${data.totalPriceUsd.toFixed(2)} USD</strong></td></tr>
        ${data.notes ? `<tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Notes</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px">${escapeHtml(data.notes)}</td></tr>` : ''}
        <tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Cancellation Policy</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px">${data.cancellationHours === 0 ? '❌ Non-refundable' : `✅ Free cancellation up to ${data.cancellationHours ?? 24}h before check-in`}</td></tr>
      </table>
    </div>

    <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:6px;padding:14px 16px;margin:16px 0;font-size:13px">
      ⏳ <strong>Awaiting hotel confirmation.</strong> You'll receive a confirmation email once the hotel accepts your booking. This usually takes less than 24 hours.
    </div>

    <div style="text-align:center;margin:24px 0">
      <a href="${SITE_URL}/mypage" style="display:inline-block;padding:12px 28px;background:#0d9488;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">Check Booking Status</a>
    </div>

    ${emailFooter()}
  </div>
</div>`;
  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.guestEmail,
    subject,
    html,
  });
}

export async function sendPaymentFailureEmail(
  apiKey: string,
  data: {
    guestName: string;
    guestEmail: string;
    hotelName: string;
    planName: string;
    errorMessage: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const subject = `Payment Failed — DaydreamHub`;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#6b7280;color:white;padding:28px 24px;text-align:center;border-radius:8px 8px 0 0">
    <div style="font-size:40px;margin-bottom:8px">⚠️</div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Payment Failed</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">Your payment could not be processed</p>
  </div>

  <div style="padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#ffffff">
    <p style="font-size:16px;margin-top:0">Hello <strong>${escapeHtml(data.guestName)}</strong>,</p>
    <p style="color:#374151">We were unable to process your payment for the following booking:</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:20px 0">
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:7px 10px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;width:38%;font-size:13px">Hotel</td><td style="padding:7px 10px;border:1px solid #e5e7eb;font-size:13px">${escapeHtml(data.hotelName)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;font-size:13px">Plan</td><td style="padding:7px 10px;border:1px solid #e5e7eb;font-size:13px">${escapeHtml(data.planName)}</td></tr>
        <tr><td style="padding:7px 10px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;font-size:13px">Reason</td><td style="padding:7px 10px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280">${escapeHtml(data.errorMessage)}</td></tr>
      </table>
    </div>

    <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:6px;padding:14px 16px;margin:16px 0;font-size:13px">
      <strong>What to do next:</strong><br>
      Please return to the booking page and try again. If the problem persists, try using a different payment method.
      If you continue to experience issues, please contact our support team.
    </div>

    <div style="text-align:center;margin:24px 0">
      <a href="${SITE_URL}" style="display:inline-block;padding:12px 28px;background:#0d9488;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">Return to DaydreamHub</a>
    </div>

    ${emailFooter()}
  </div>
</div>`;

  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.guestEmail,
    subject,
    html,
  });
}

export async function sendAltChoiceEmail(
  apiKey: string,
  data: {
    bookingId: number;
    guestName: string;
    guestEmail: string;
    city: string;
    checkInDate: string;
    totalPriceUsd: number;
    paypalOrderId: string;
    baseUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const subject = `Booking #${data.bookingId} — Hotels Unavailable — Your Options`;
  const retryUrl = `${data.baseUrl}/api/bookings/${data.bookingId}/alt-choice?token=${encodeURIComponent(data.paypalOrderId)}&choice=retry`;
  const refundUrl = `${data.baseUrl}/api/bookings/${data.bookingId}/alt-choice?token=${encodeURIComponent(data.paypalOrderId)}&choice=refund`;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#d97706;color:white;padding:24px;text-align:center;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:24px">Hotels Unavailable</h1>
    <p style="margin:8px 0 0;opacity:0.9">DaydreamHub Booking #${data.bookingId}</p>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <p style="font-size:16px">Hello ${escapeHtml(data.guestName)},</p>
    <p>We contacted multiple hotels in <strong>${escapeHtml(data.city)}</strong> for your booking on <strong>${formatDate(data.checkInDate)}</strong>, but unfortunately none could confirm availability.</p>
    <p>You have two options:</p>
    <div style="margin:24px 0;text-align:center">
      <a href="${retryUrl}" style="display:inline-block;padding:14px 32px;background:#0d9488;color:white;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;margin:8px">Try 3 More Hotels</a>
      <br/>
      <a href="${refundUrl}" style="display:inline-block;padding:14px 32px;background:#6b7280;color:white;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;margin:8px">Refund My Payment ($${data.totalPriceUsd.toFixed(2)})</a>
    </div>
    <div style="margin:16px 0;padding:12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:4px">
      <strong>This offer expires in 24 hours.</strong> After that, a full refund will be issued automatically.
    </div>
    <p style="color:#666;font-size:12px;margin-top:24px">DaydreamHub - Day-Use Hotel Booking</p>
  </div>
</div>`;
  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.guestEmail,
    subject,
    html,
  });
}
