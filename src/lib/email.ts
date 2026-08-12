function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const SITE_URL = 'https://daydreamhub.com';

const MONTH_NAMES_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(dateStr: string): string {
  return formatDateYyyyMmmDd(dateStr);
}

// "2026-08-12" → "2026-Aug-12". Owners and guests read these emails from
// everywhere, and 08/12 means August 12 in some countries and 8 December in
// others; spelling the month out settles it.
function formatDateYyyyMmmDd(dateStr: string): string {
  if (!dateStr) return dateStr;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  const monthIdx = Number(m[2]) - 1;
  const mon = MONTH_NAMES_SHORT_EN[monthIdx];
  if (!mon) return dateStr;
  return `${m[1]}-${mon}-${m[3]}`;
}

function hotelLink(hotelName: string, hotelSlug?: string): string {
  const name = escapeHtml(hotelName);
  if (hotelSlug) {
    return `<a href="${SITE_URL}/hotel/${hotelSlug}" style="color:#0d9488;text-decoration:none;font-weight:600">${name}</a>`;
  }
  return `<strong>${name}</strong>`;
}

function formatQuotedPriceUsd(price?: string): string {
  if (!price) return '';
  const num = String(price).replace(/[^\d.]/g, '');
  if (!num) return `$${price} USD`;
  return `$${num} USD`;
}

// "EGP 2,565 (≈ $49.98 USD)" when a payment-time fx snapshot exists; plain USD otherwise.
function formatAmountDual(totalUsd: number, localCurrency?: string | null, localAmount?: number | null): string {
  const usd = `$${Number(totalUsd || 0).toFixed(2)} USD`;
  if (!localCurrency || localCurrency === 'USD' || localAmount == null) return usd;
  return `${localCurrency} ${localAmount} (≈ ${usd})`;
}

// "2 adults, 1 child, 1 infant" — infants are listed because add-ons can now be
// priced for them, so leaving them out would make an add-on line unexplainable.
function describeParty(adults: number, children: number, infants?: number): string {
  const parts = [`${adults} adult${adults === 1 ? '' : 's'}`];
  if (children > 0) parts.push(`${children} child${children === 1 ? '' : 'ren'}`);
  if (Number(infants) > 0) parts.push(`${infants} infant${Number(infants) === 1 ? '' : 's'}`);
  return parts.join(', ');
}

// An add-on as it was charged, copied from booking_options so the email shows
// what the guest actually paid rather than today's price for the option.
export type BookingOptionLine = {
  name: string;
  pricing_type?: string | null;
  quantity?: number | null;
  child_quantity?: number | null;
  infant_quantity?: number | null;
  amount_usd?: number | null;
  amount_local?: number | null;
};

// "1 adult + 1 child", "3 guests", "1 booking" — who the charge covered, so the
// hotel can see at a glance how many breakfasts to lay out.
function optionCoverage(o: BookingOptionLine): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (o.pricing_type === 'per_adult_child') {
    if (Number(o.quantity) > 0) parts.push(plural(Number(o.quantity), 'adult', 'adults'));
    if (Number(o.child_quantity) > 0) parts.push(plural(Number(o.child_quantity), 'child', 'children'));
    if (Number(o.infant_quantity) > 0) parts.push(plural(Number(o.infant_quantity), 'infant', 'infants'));
  } else if (o.pricing_type === 'per_person') {
    parts.push(plural(Number(o.quantity) || 0, 'guest', 'guests'));
  } else {
    parts.push(plural(Number(o.quantity) || 1, 'booking', 'bookings'));
  }
  return parts.join(' + ');
}

// The add-on list as one table cell, so every Booking Details table can drop it
// in without each template re-deriving the wording.
function optionsCellHtml(
  options: BookingOptionLine[] | undefined,
  localCurrency?: string | null,
): string {
  if (!options || !options.length) return '';
  return options
    .map((o) => {
      const amount = formatAmountDual(Number(o.amount_usd || 0), localCurrency, o.amount_local ?? null);
      return `<div style="margin:0 0 3px">${escapeHtml(o.name)} <span style="color:#6b7280">(${escapeHtml(optionCoverage(o))})</span> — ${escapeHtml(amount)}</div>`;
    })
    .join('');
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
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ success: boolean; error?: string }> {
  const toArray = Array.isArray(params.to) ? params.to : [params.to];
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: toArray,
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

type OwnerBookingData = {
  bookingId: number;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  guestNationality?: string | null;
  checkInDate: string;
  planName: string;
  adults: number;
  children: number;
  infants: number;
  totalPriceUsd: number;
  localCurrency?: string | null;
  localAmount?: number | null;
  fxRate?: number | null;
  notes?: string;
  options?: BookingOptionLine[];
  hotelName: string;
  hotelEmail: string | string[];
};

// The booking table the owner needs in order to decide. Shared by the first
// notification and every reminder so the two can never disagree.
function ownerBookingTable(data: OwnerBookingData): string {
  const hasFx = !!(data.localCurrency && data.localCurrency !== 'USD' && data.localAmount != null);
  const rows: [string, string][] = [
    ['Booking ID', `#${data.bookingId}`],
    ['Guest Name', data.guestName],
    ['Guest Email', data.guestEmail],
    ['Guest Phone', data.guestPhone || '-'],
    ['Nationality', data.guestNationality || '-'],
    ['Check-in Date', formatDateYyyyMmmDd(data.checkInDate)],
    ['Plan', data.planName],
    ['Adults', String(data.adults)],
    ['Children', String(data.children)],
    ['Infants', String(data.infants)],
    ['Total', formatAmountDual(data.totalPriceUsd, data.localCurrency, data.localAmount)],
    ...(hasFx ? [['Exchange Rate', `1 USD = ${data.fxRate} ${data.localCurrency} (at payment time; payment was processed in USD)`] as [string, string]] : []),
    ['Notes', data.notes || '-'],
  ];
  // Add-ons sit next to the guest counts: the hotel is the one who has to
  // deliver them, so they belong in the same table, not a footnote.
  const addOnsCell = optionsCellHtml(data.options, data.localCurrency);
  const cells: [string, string][] = rows.map(([label, value]) => [label, escapeHtml(value)]);
  if (addOnsCell) {
    cells.splice(cells.findIndex(([l]) => l === 'Total'), 0, ['Add-ons', addOnsCell]);
  }
  return cells
    .map(
      ([label, cell], i) =>
        `<tr><td style="padding:8px 10px;border:1px solid #e2e8f0;font-weight:600;background:${i % 2 ? '#f8fafc' : '#f1f5f9'};width:38%;font-size:13px;color:#334155">${escapeHtml(label)}</td><td style="padding:8px 10px;border:1px solid #e2e8f0;font-size:13px;background:#ffffff;color:#1f2937">${cell}</td></tr>`
    )
    .join('');
}

function ownerActionButtons(): string {
  return `
    <div style="text-align:center;margin:24px 0">
      <a href="${SITE_URL}/owner/bookings" style="display:inline-block;padding:14px 32px;background:#b45309;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">
        Confirm or Decline &rarr; Owner Portal
      </a>
      <p style="margin:10px 0 0;font-size:12px;color:#9ca3af">Sign in with your owner account to respond.</p>
    </div>`;
}

// The owner-facing shell: same shape as the guest emails (coloured band, one
// card, one action) so a hotel that gets both recognises them as the same
// product rather than the plain table this used to be.
function ownerEmailShell(opts: {
  headerBg: string;
  emoji: string;
  title: string;
  subtitle: string;
  intro: string;
  urgencyBox: string;
  data: OwnerBookingData;
}): string {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:${opts.headerBg};color:white;padding:28px 24px;text-align:center;border-radius:8px 8px 0 0">
    <p style="margin:0 0 12px;font-size:13px;letter-spacing:1px;text-transform:uppercase;opacity:0.85">DayDreamHub</p>
    <div style="font-size:36px;margin-bottom:8px">${opts.emoji}</div>
    <h1 style="margin:0;font-size:22px;font-weight:700">${opts.title}</h1>
    <p style="margin:6px 0 0;opacity:0.9;font-size:14px">${opts.subtitle}</p>
  </div>

  <div style="padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#ffffff">
    <p style="font-size:16px;margin-top:0">${opts.intro}</p>

    ${opts.urgencyBox}

    <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:20px;margin:20px 0">
      <h2 style="margin:0 0 16px;font-size:16px;color:#334155">📋 Booking Details</h2>
      <table style="border-collapse:collapse;width:100%">
        ${ownerBookingTable(opts.data)}
      </table>
    </div>

    ${ownerActionButtons()}

    <p style="color:#6b7280;font-size:12px;line-height:1.7">
      Guests are told to expect an answer within 24 hours, so the sooner you respond the better —
      and if the room is not available, declining helps them more than waiting does.
    </p>
    <div style="background:#f1f5f9;border-left:3px solid #94a3b8;border-radius:4px;padding:12px 14px;margin:16px 0;color:#475569;font-size:12px;line-height:1.7">
      <strong>Send-only address.</strong> This mailbox does not receive mail. A reply to this message
      reaches no one — not DayDreamHub, and not the guest.
      To contact the guest, open <strong>Messages</strong> in the Owner Portal: the thread stays attached
      to the booking and DayDreamHub can see it if you need us to step in.
    </div>

    ${emailFooter()}
  </div>
</div>`;
}

export async function sendBookingNotificationToHotel(
  apiKey: string,
  data: OwnerBookingData
): Promise<{ success: boolean; error?: string }> {
  const subject = `[Action Required] DayDreamHub booking #${data.bookingId} — new request from ${data.guestName} · ${formatDateYyyyMmmDd(data.checkInDate)}`;
  const html = ownerEmailShell({
    headerBg: '#b45309',
    emoji: '🔔',
    title: 'Action Required: New Booking',
    subtitle: 'A guest has paid and is waiting for your decision.',
    intro: `A new booking request has come in through DayDreamHub for <strong>${escapeHtml(data.hotelName)}</strong>.`,
    urgencyBox: `
    <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:14px 16px;margin:16px 0;font-size:13px;color:#78350f">
      ⏳ <strong>Please confirm or decline within 24 hours.</strong> The guest has already been charged and
      cannot use the room until you respond.
    </div>`,
    data,
  });
  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.hotelEmail,
    subject,
    html,
  });
}

// How long a booking has gone unanswered, and how hard the email pushes.
export type ReminderStage = 6 | 12 | 24;

const REMINDER_COPY: Record<ReminderStage, {
  subjectTag: string;
  subjectPhrase: string;
  headerBg: string;
  emoji: string;
  title: string;
  subtitle: string;
  box: string;
}> = {
  6: {
    subjectTag: '[Reminder]',
    subjectPhrase: 'your guest is waiting for confirmation',
    headerBg: '#b45309',
    emoji: '⏳',
    title: 'Your Guest Is Waiting',
    subtitle: 'This booking has been open for 6 hours.',
    box: `
    <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;padding:14px 16px;margin:16px 0;font-size:13px;color:#78350f">
      ⏳ <strong>A guest paid 6 hours ago and is still waiting to hear from you.</strong> Guests are told to
      expect an answer within 24 hours, so a reply now leaves them plenty of time to plan. If the room is not
      available, declining lets them book somewhere else while they still can.
    </div>`,
  },
  12: {
    subjectTag: '[Please Respond]',
    subjectPhrase: 'your guest has been waiting half a day',
    headerBg: '#c2410c',
    emoji: '📩',
    title: 'Still Waiting After 12 Hours',
    subtitle: 'Half a day has passed since this guest booked.',
    box: `
    <div style="background:#ffedd5;border:1px solid #fb923c;border-radius:6px;padding:14px 16px;margin:16px 0;font-size:13px;color:#7c2d12">
      📩 <strong>Your guest has been waiting half a day for an answer.</strong> They have already paid and
      cannot make any other arrangements until they hear from you. Please open the Owner Portal and confirm
      or decline — either answer helps them; silence does not.
    </div>`,
  },
  24: {
    subjectTag: '[Urgent]',
    subjectPhrase: 'your guest has been waiting a full day',
    headerBg: '#b91c1c',
    emoji: '🚨',
    title: 'Waiting a Full Day',
    subtitle: 'Please respond to this guest today.',
    box: `
    <div style="background:#fee2e2;border:1px solid #f87171;border-radius:6px;padding:14px 16px;margin:16px 0;font-size:13px;color:#7f1d1d">
      🚨 <strong>A full day has gone by and this guest still has no answer.</strong> They were told to expect
      one within 24 hours, and their trip is on hold until you reply. Please confirm the booking now if you
      can take it, or decline it so we can refund them and they can find another room.
    </div>`,
  },
};

// Reminder for a booking the owner has not acted on. Sent by the reminder cron,
// which is also what stops the same stage going out twice.
export async function sendOwnerBookingReminder(
  apiKey: string,
  stage: ReminderStage,
  data: OwnerBookingData
): Promise<{ success: boolean; error?: string }> {
  const copy = REMINDER_COPY[stage];
  const subject = `${copy.subjectTag} DayDreamHub booking #${data.bookingId} — ${copy.subjectPhrase} · ${formatDateYyyyMmmDd(data.checkInDate)}`;
  const html = ownerEmailShell({
    headerBg: copy.headerBg,
    emoji: copy.emoji,
    title: copy.title,
    subtitle: copy.subtitle,
    intro: `DayDreamHub booking <strong>#${data.bookingId}</strong> at <strong>${escapeHtml(data.hotelName)}</strong> is still awaiting your confirmation.`,
    urgencyBox: copy.box,
    data,
  });
  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.hotelEmail,
    subject,
    html,
  });
}

export async function sendConciergeCallStartedEmail(
  apiKey: string,
  data: {
    guestName: string;
    guestEmail: string;
    hotelNames: string[];
    date?: string;
    checkIn?: string;
    checkOut?: string;
    guests?: number;
  }
): Promise<{ success: boolean; error?: string }> {
  const count = data.hotelNames.length;
  const subject = `🔔 We're calling ${count} hotel${count === 1 ? '' : 's'} for you - DaydreamHub`;
  const hotelList = data.hotelNames
    .map((n, i) => `<li style="margin:4px 0">${i + 1}. ${escapeHtml(n)}</li>`)
    .join('');
  const detailsRows = [
    data.date ? `<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Date</td><td style="padding:6px 12px;border:1px solid #ddd">${escapeHtml(formatDateYyyyMmmDd(data.date))}</td></tr>` : '',
    (data.checkIn || data.checkOut) ? `<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Time</td><td style="padding:6px 12px;border:1px solid #ddd">${escapeHtml(data.checkIn || '?')}–${escapeHtml(data.checkOut || '?')}</td></tr>` : '',
    data.guests ? `<tr><td style="padding:6px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Guests</td><td style="padding:6px 12px;border:1px solid #ddd">${data.guests}</td></tr>` : '',
  ].filter(Boolean).join('');
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#0ea5e9;color:white;padding:24px;text-align:center;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:22px">📞 Calling Hotels Now</h1>
    <p style="margin:8px 0 0;opacity:0.9">DaydreamHub AI Concierge</p>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <p style="font-size:16px">Hello ${escapeHtml(data.guestName || 'there')},</p>
    <p>Our AI concierge has just started calling the following ${count === 1 ? 'hotel' : `${count} hotels`} on your behalf:</p>
    <ol style="padding-left:20px;margin:12px 0">${hotelList}</ol>
    ${detailsRows ? `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">${detailsRows}</table>` : ''}
    <div style="margin:16px 0;padding:14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px">
      <strong>⏱ Estimated time: 5–10 minutes</strong><br>
      <span style="font-size:13px;color:#475569">We'll call each hotel one by one and stop as soon as one confirms. You'll receive a follow-up email with the result.</span>
    </div>
    <p style="color:#666;font-size:13px">No action is needed from you right now. If you don't hear back within 30 minutes, please contact us.</p>
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
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Date</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(formatDateYyyyMmmDd(data.date))}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Check-in</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.checkIn)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Check-out</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.checkOut)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Guests</td><td style="padding:8px 12px;border:1px solid #ddd">${data.guests}</td></tr>
      ${data.priceQuoted ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Quoted Price</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(formatQuotedPriceUsd(data.priceQuoted))}</td></tr>` : ''}
    </table>
    <div style="margin:16px 0;padding:12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:4px">
      <strong>Important:</strong> Payment is made directly at the hotel upon check-in. Please note that depending on the hotel, you may be required to pay in the local currency. The $7 service fee was for the AI booking call only.
    </div>
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
    localCurrency?: string | null;
    localAmount?: number | null;
    status: 'confirmed' | 'cancelled';
    cancelReason?: string;
    hotelSlug?: string;
    infants?: number;
    options?: BookingOptionLine[];
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

  const guestCount = describeParty(data.adults, data.children, data.infants);

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
        ${optionsCellHtml(data.options, data.localCurrency)
          ? `<tr><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-weight:600;background:${isConfirmed ? '#f0fdfa' : '#f9fafb'};font-size:13px">Add-ons</td><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-size:13px">${optionsCellHtml(data.options, data.localCurrency)}</td></tr>`
          : ''}
        <tr><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-weight:600;background:${isConfirmed ? '#f0fdfa' : '#f9fafb'};font-size:13px">Amount</td><td style="padding:7px 10px;border:1px solid ${isConfirmed ? '#d1fae5' : '#e5e7eb'};font-size:13px"><strong>${formatAmountDual(data.totalPriceUsd, data.localCurrency, data.localAmount)}</strong></td></tr>
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
    localCurrency?: string | null;
    localAmount?: number | null;
    notes?: string;
    infants?: number;
    options?: BookingOptionLine[];
    cancellationHours?: number | null;
  }
): Promise<{ success: boolean; error?: string }> {
  const subject = `Booking Request Received #${data.bookingId} — DaydreamHub`;
  const guestCount = describeParty(data.adults, data.children, data.infants);
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#0d9488;color:white;padding:28px 24px;text-align:center;border-radius:8px 8px 0 0">
    <div style="font-size:36px;margin-bottom:8px">🏨</div>
    <h1 style="margin:0;font-size:22px;font-weight:700">Booking Request Received!</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">We've notified the hotel and are awaiting confirmation.</p>
  </div>

  <div style="padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#ffffff">
    <p style="font-size:16px;margin-top:0">Hello <strong>${escapeHtml(data.guestName)}</strong>,</p>
    <p style="color:#374151">Your payment of <strong>${formatAmountDual(data.totalPriceUsd, data.localCurrency, data.localAmount)}</strong> has been received (processed in USD). The hotel will confirm your booking shortly — we'll send you another email once confirmed.</p>

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
        ${optionsCellHtml(data.options, data.localCurrency)
          ? `<tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Add-ons</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px">${optionsCellHtml(data.options, data.localCurrency)}</td></tr>`
          : ''}
        <tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Total Paid</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px"><strong style="color:#0d9488">${formatAmountDual(data.totalPriceUsd, data.localCurrency, data.localAmount)}</strong></td></tr>
        ${data.notes ? `<tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Notes</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px">${escapeHtml(data.notes)}</td></tr>` : ''}
        <tr><td style="padding:7px 10px;border:1px solid #d1fae5;font-weight:600;background:#f0fdfa;font-size:13px">Cancellation Policy</td><td style="padding:7px 10px;border:1px solid #d1fae5;font-size:13px">${data.cancellationHours === 0 ? '❌ Non-refundable' : `✅ Free cancellation up to ${data.cancellationHours ?? 24}h before check-in<br><span style="color:#6b7280;font-size:12px">Counted in the hotel\u2019s local time, not your own time zone.</span>`}</td></tr>
      </table>
    </div>

    <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:6px;padding:14px 16px;margin:16px 0;font-size:13px">
      ⏳ <strong>Awaiting hotel confirmation.</strong> You'll receive a confirmation email once the hotel accepts your booking. This usually takes less than 24 hours.
    </div>

    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:14px 16px;margin:16px 0;font-size:13px;color:#7c2d12">
      <strong>Need to change your booking?</strong>
      <ul style="margin:8px 0 0;padding-left:18px">
        <li style="margin-bottom:4px">Removing an add-on or reducing the number of guests isn't possible &mdash; please cancel and book again. We can't refund the difference on an existing booking.</li>
        <li style="margin-bottom:4px">To add an add-on, either cancel and book again, or ask the hotel directly on arrival and pay them for it there.</li>
        <li style="margin-bottom:4px">Whether it can be arranged on arrival is up to the hotel &mdash; check with them first via Messages in your DayDreamHub inbox.</li>
        <li>Any refund when you cancel follows the cancellation policy above.</li>
      </ul>
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

export async function sendConciergeDeclineToGuest(
  apiKey: string,
  data: {
    guestName: string;
    guestEmail: string;
    hotelName: string;
    date: string;
    checkIn: string;
    checkOut: string;
    guests: number;
  }
): Promise<{ success: boolean; error?: string }> {
  const subject = `Your Booking Request at ${data.hotelName} Was Declined - DaydreamHub`;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#dc2626;color:white;padding:24px;text-align:center;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:24px">Booking Not Available</h1>
    <p style="margin:8px 0 0;opacity:0.9">DaydreamHub AI Concierge</p>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <p style="font-size:16px">Hello ${escapeHtml(data.guestName)},</p>
    <p>Unfortunately, <strong>${escapeHtml(data.hotelName)}</strong> was unable to accommodate your booking request via our AI phone call.</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0">
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Hotel</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.hotelName)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Date</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(formatDateYyyyMmmDd(data.date))}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Check-in</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.checkIn)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Check-out</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.checkOut)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Guests</td><td style="padding:8px 12px;border:1px solid #ddd">${data.guests}</td></tr>
    </table>
    <div style="margin:16px 0;padding:12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:4px">
      <strong>Refund Notice:</strong> Your $7 service fee will be refunded within 5–10 business days. No action is required on your part.
    </div>
    <p>We're sorry for the inconvenience. Please visit <a href="${SITE_URL}">daydreamhub.com</a> to search for other available hotels.</p>
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

export async function sendAdminRefundAlert(
  apiKey: string,
  data: {
    adminEmail: string;
    bookingId: number;
    guestName: string;
    guestEmail: string;
    hotelName: string;
    date: string;
    checkIn: string;
    checkOut: string;
    guests: number;
    paypalCaptureId?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const subject = `[Action Required] Refund $7 - Booking #${data.bookingId} Declined by Hotel`;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#92400e;color:white;padding:24px;text-align:center;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:22px">[Action Required] Manual Refund Needed</h1>
    <p style="margin:8px 0 0;opacity:0.9">AI Phone Call - Hotel Declined</p>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <p>The hotel declined the booking via AI phone call. Please process a <strong>$7 refund</strong> manually.</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0">
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Booking ID</td><td style="padding:8px 12px;border:1px solid #ddd">#${data.bookingId}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Guest</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.guestName)} (${escapeHtml(data.guestEmail)})</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Hotel</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.hotelName)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Date</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.date)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Check-in</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.checkIn)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Check-out</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.checkOut)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Guests</td><td style="padding:8px 12px;border:1px solid #ddd">${data.guests}</td></tr>
      ${data.paypalCaptureId ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">PayPal Capture ID</td><td style="padding:8px 12px;border:1px solid #ddd;font-family:monospace">${escapeHtml(data.paypalCaptureId)}</td></tr>` : ''}
    </table>
    <div style="margin:16px 0;padding:12px;background:#fee2e2;border:1px solid #fca5a5;border-radius:4px">
      <strong>Refund amount: $7.00</strong><br>
      Guest has already been notified that a refund is being processed.
    </div>
    <p style="color:#666;font-size:12px;margin-top:24px">DaydreamHub Admin Alert</p>
  </div>
</div>`;
  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.adminEmail,
    subject,
    html,
  });
}

// Sent to contact@daydreamhub.com when an owner submits a listing review request
export async function sendReviewRequestNotification(
  apiKey: string,
  data: { ownerName: string; ownerEmail: string; hotelName: string; hotelId: number }
): Promise<{ success: boolean; error?: string }> {
  const subject = `Listing Review Request: ${data.hotelName}`;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#0d9488;color:white;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">Listing Review Request</h1>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <p>An owner has completed their listing setup and is requesting review for publication.</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0">
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9;white-space:nowrap">Hotel</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.hotelName)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9;white-space:nowrap">Owner</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.ownerName)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9;white-space:nowrap">Email</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.ownerEmail)}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0">
      <a href="${SITE_URL}/admin/hotels/${data.hotelId}"
         style="display:inline-block;padding:12px 28px;background:#0d9488;color:white;text-decoration:none;border-radius:8px;font-weight:bold">
        Review in Admin →
      </a>
    </div>
    ${emailFooter()}
  </div>
</div>`;
  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: 'contact@daydreamhub.com',
    subject,
    html,
  });
}

// Sent to owner when admin reviews the listing and asks for changes before
// publishing. Clears the "under review" state so the owner can revise and
// re-submit. Includes the reviewer's feedback.
export async function sendListingChangesRequestedEmail(
  apiKey: string,
  data: { ownerName: string; ownerEmail: string; hotelName: string; hotelId: number; feedback: string }
): Promise<{ success: boolean; error?: string }> {
  const subject = `Changes requested for your listing – ${data.hotelName}`;
  const feedbackHtml = escapeHtml(data.feedback || '').replace(/\n/g, '<br>');
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#b45309;color:white;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">Changes requested</h1>
    <p style="margin:8px 0 0;opacity:0.9">${escapeHtml(data.hotelName)}</p>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#fff">
    <p style="font-size:16px;margin-top:0">Hi <strong>${escapeHtml(data.ownerName)}</strong> 👋</p>
    <p style="color:#374151;line-height:1.6">
      Thank you for submitting your listing for review. Before we can publish it, our team would like you to update a few things:
    </p>
    <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin:16px 0;color:#92400e;line-height:1.6">
      ${feedbackHtml || 'Please review your listing details and resubmit.'}
    </div>
    <p style="color:#374151;line-height:1.6">
      Please open your listing, make the updates, and click <strong>Request review</strong> again. We'll take another look right away.
    </p>
    <div style="text-align:center;margin:24px 0">
      <a href="${SITE_URL}/owner/hotels/${data.hotelId}"
         style="display:inline-block;padding:12px 28px;background:#4f46e5;color:white;text-decoration:none;border-radius:8px;font-weight:bold">
        Edit my listing →
      </a>
    </div>
    <p style="color:#6b7280;font-size:14px;line-height:1.6">
      Questions? Reply to this email or contact us at <a href="mailto:contact@daydreamhub.com" style="color:#4f46e5">contact@daydreamhub.com</a>.
    </p>
    ${emailFooter()}
  </div>
</div>`;
  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.ownerEmail,
    subject,
    html,
  });
}

// Sent to owner when admin sets is_active = 1 (listing approved)
export async function sendListingApprovedEmail(
  apiKey: string,
  data: { ownerName: string; ownerEmail: string; hotelName: string; hotelSlug: string }
): Promise<{ success: boolean; error?: string }> {
  const subject = `Your listing is now live! – ${data.hotelName}`;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#0d9488;color:white;padding:32px 24px;text-align:center;border-radius:8px 8px 0 0">
    <div style="font-size:40px;margin-bottom:12px">🎉</div>
    <h1 style="margin:0;font-size:24px;font-weight:700">Your listing is now live!</h1>
    <p style="margin:8px 0 0;opacity:0.9">${escapeHtml(data.hotelName)}</p>
  </div>
  <div style="padding:32px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#fff">
    <p style="font-size:16px;margin-top:0">Hi <strong>${escapeHtml(data.ownerName)}</strong> 👋</p>
    <p style="color:#374151;line-height:1.6">
      Great news! We've reviewed your listing and it's now published on DayDreamHub. Travelers can now find and book your property.
    </p>
    <p style="color:#374151;line-height:1.6">
      Next steps:
    </p>
    <ul style="color:#374151;line-height:2">
      <li>Make sure your calendar is up to date</li>
      <li>Respond promptly to booking requests</li>
      <li>Contact us anytime at <a href="mailto:contact@daydreamhub.com" style="color:#0d9488">contact@daydreamhub.com</a></li>
    </ul>
    <div style="text-align:center;margin:28px 0">
      <a href="${SITE_URL}/hotel/${escapeHtml(data.hotelSlug)}"
         style="display:inline-block;padding:14px 32px;background:#0d9488;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">
        View Your Listing →
      </a>
    </div>
    ${emailFooter()}
  </div>
</div>`;
  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.ownerEmail,
    subject,
    html,
  });
}

export type ConciergeResultEmailType = 'success' | 'no_answer' | 'declined' | 'all_failed' | 'over_budget';

// Two-call model: after call 1, the guest receives the hotel's quoted price and
// a button to accept it. Clicking the button (which then collects the $7 DDH fee)
// triggers call 2 to confirm the booking. The room price is paid on-site.
export async function sendConciergeQuoteEmail(
  apiKey: string,
  data: {
    guestName: string; guestEmail: string; hotelName: string;
    date: string; checkIn: string; checkOut: string; guests: number;
    price: string | number; priceCurrency: string; acceptUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const fmtQuoteDate = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  };
  const when = [fmtQuoteDate(data.date), [data.checkIn, data.checkOut].filter(Boolean).join(' – ')].filter(Boolean).join('  ·  ');
  const priceStr = `${data.price} ${escapeHtml(data.priceCurrency || '')}`.trim();
  const subject = `Your day-use quote for ${data.hotelName} — ${priceStr}`;
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#46a3c2;color:white;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">We found a price for you</h1>
    <p style="margin:8px 0 0;opacity:0.9">${escapeHtml(data.hotelName)}</p>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#fff">
    <p style="font-size:16px;margin-top:0">Hi <strong>${escapeHtml(data.guestName || 'there')}</strong>,</p>
    <p style="color:#374151;line-height:1.6">We called <strong>${escapeHtml(data.hotelName)}</strong> and they can offer your day-use stay at the price below.</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0">
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9;white-space:nowrap">Hotel</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.hotelName)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9;white-space:nowrap">When</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(when)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9;white-space:nowrap">Guests</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(String(data.guests))}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9;white-space:nowrap">Quoted price</td><td style="padding:8px 12px;border:1px solid #ddd;font-size:18px;font-weight:700;color:#37879f">${priceStr}</td></tr>
    </table>
    <p style="color:#374151;line-height:1.6">If this works for you, tap below to book. A <strong>$7 DayDreamHub booking fee</strong> applies; the room price above is paid directly to the hotel on-site. <strong>If the hotel cannot confirm your booking, this $7 fee is refunded in full.</strong></p>
    <div style="text-align:center;margin:24px 0">
      <a href="${data.acceptUrl}" style="display:inline-block;padding:14px 32px;background:#46a3c2;color:white;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px">
        Book at this price →
      </a>
    </div>
    <p style="color:#6b7280;font-size:13px;line-height:1.6">After you confirm, we call the hotel again to finalize your booking and email you the confirmation. If you have any questions, reply to this email or contact us at <a href="mailto:contact@daydreamhub.com" style="color:#46a3c2">contact@daydreamhub.com</a>.</p>
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

export async function sendConciergeResultEmail(
  apiKey: string,
  data: {
    guestName: string;
    guestEmail: string;
    resultType: ConciergeResultEmailType;
    hotelName?: string;
    hotelPhone?: string;
    date?: string;
    checkIn?: string;
    checkOut?: string;
    guests?: number;
    priceQuoted?: string;
    priceCurrency?: string;
    aiSummary?: string;
    attemptedHotels?: string[];
  }
): Promise<{ success: boolean; error?: string }> {
  const fmtQuoted = (p?: string): string => {
    const num = String(p ?? '').replace(/[^\d.]/g, '');
    const cur = (data.priceCurrency || 'USD').toUpperCase();
    if (!num) return String(p ?? '');
    return cur === 'USD' ? `$${num} USD` : `${cur} ${num}`;
  };
  const resultMeta = {
    success: {
      subject: `✅ Booking confirmed${data.hotelName ? ` - ${data.hotelName}` : ''} | DaydreamHub`,
      title: 'Booking Confirmed',
      color: '#059669',
      message: data.hotelName
        ? `Great news — we confirmed your booking with <strong>${escapeHtml(data.hotelName)}</strong>.`
        : 'Great news — we confirmed your booking.',
    },
    no_answer: {
      subject: `📞 We couldn't reach the hotel this time | DaydreamHub`,
      title: 'No Response from Hotel',
      color: '#6b7280',
      message: data.hotelName
        ? `We could not get a response from <strong>${escapeHtml(data.hotelName)}</strong> during this call attempt.`
        : 'We could not get a response from the hotel during this call attempt.',
    },
    declined: {
      subject: `❌ Hotel could not accept the request | DaydreamHub`,
      title: 'Request Not Accepted',
      color: '#dc2626',
      message: data.hotelName
        ? `<strong>${escapeHtml(data.hotelName)}</strong> could not accept this request.`
        : 'The hotel could not accept this request.',
    },
    over_budget: {
      subject: `💸 Offered prices exceeded your budget | DaydreamHub`,
      title: 'Over Budget',
      color: '#d97706',
      message: data.hotelName
        ? `<strong>${escapeHtml(data.hotelName)}</strong> had availability, but every offered plan was above your maximum budget${data.priceQuoted ? ` (lowest offer: ${escapeHtml(fmtQuoted(data.priceQuoted))})` : ''}, so we did not confirm the booking.`
        : `The hotel had availability, but every offered plan was above your maximum budget${data.priceQuoted ? ` (lowest offer: ${escapeHtml(fmtQuoted(data.priceQuoted))})` : ''}, so we did not confirm the booking.`,
    },
    all_failed: {
      subject: `⚠️ All contacted hotels were unavailable | DaydreamHub`,
      title: 'All Hotels Unavailable',
      color: '#d97706',
      message: 'We contacted all candidate hotels but none could confirm your request.',
    },
  }[data.resultType];

  const attemptedHotels = (data.attemptedHotels || [])
    .filter(Boolean)
    .map((h, i) => `<li style="margin:4px 0">${i + 1}. ${escapeHtml(h)}</li>`)
    .join('');

  const detailsRows = [
    data.hotelName ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Hotel</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.hotelName)}</td></tr>` : '',
    data.hotelPhone ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Hotel Phone</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.hotelPhone)}</td></tr>` : '',
    data.date ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Date</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(formatDateYyyyMmmDd(data.date))}</td></tr>` : '',
    (data.checkIn || data.checkOut) ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Time</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(data.checkIn || '?')} - ${escapeHtml(data.checkOut || '?')}</td></tr>` : '',
    data.guests ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Guests</td><td style="padding:8px 12px;border:1px solid #ddd">${data.guests}</td></tr>` : '',
    data.priceQuoted ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">Quoted Price</td><td style="padding:8px 12px;border:1px solid #ddd">${escapeHtml(fmtQuoted(data.priceQuoted))}</td></tr>` : '',
  ].filter(Boolean).join('');

  const actionNote = data.resultType === 'success'
    ? 'Please keep this email for reference when checking in. Payment is made directly at the hotel upon check-in. Please note that depending on the hotel, you may be required to pay in the local currency.'
    : data.resultType === 'no_answer'
      ? 'You can try another hotel search anytime on DaydreamHub. If we are unable to reach any of the selected hotels after attempting all of them, your $7 fee will be fully refunded.'
      : data.resultType === 'all_failed'
        ? 'We called all the selected hotels, but none were available or answered. Your $7 fee is being refunded.'
        : data.resultType === 'over_budget'
          ? 'If you would like, you can raise your maximum budget and request the call again — the lowest offered price above is a good reference.'
          : 'You can try another hotel search anytime on DaydreamHub.';

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:${resultMeta.color};color:white;padding:24px;text-align:center;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:24px">${resultMeta.title}</h1>
    <p style="margin:8px 0 0;opacity:0.9">DaydreamHub AI Concierge</p>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#fff">
    <p style="font-size:16px">Hello ${escapeHtml(data.guestName || 'there')},</p>
    <p>${resultMeta.message}</p>

    ${detailsRows ? `<table style="border-collapse:collapse;width:100%;margin:16px 0">${detailsRows}</table>` : ''}

    ${attemptedHotels ? `<div style="margin:16px 0;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px"><strong>Hotels contacted</strong><ol style="padding-left:20px;margin:8px 0">${attemptedHotels}</ol></div>` : ''}

    <div style="margin:16px 0;padding:12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:6px">
      ${escapeHtml(actionNote)}
    </div>

    ${data.resultType === 'success' ? `<div style="margin:12px 0;padding:12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px">
      If you wish to cancel your reservation, please call the hotel directly. When you contact them, please let the hotel know that the reservation was made via a DayDreamHub phone booking.
    </div>` : ''}

    ${emailFooter()}
  </div>
</div>`;

  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: data.guestEmail,
    subject: resultMeta.subject,
    html,
  });
}

export async function sendAdminBookingStatusUpdate(
  apiKey: string,
  data: {
    adminEmail: string;
    bookingId: number;
    guestName: string;
    guestEmail: string;
    hotelName: string;
    checkInDate: string;
    status: 'confirmed' | 'cancelled' | 'rejected';
    actor: 'guest' | 'owner';
    cancelReason?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  // Subject reflects both action and actor unambiguously
  let subjectTag: string;
  let actionLabel: string;
  let headerColor: string;

  if (data.status === 'confirmed') {
    subjectTag = '[Hotel Confirmed]';
    actionLabel = 'Confirmed by Hotel Owner';
    headerColor = '#065f46';
  } else if (data.actor === 'guest') {
    subjectTag = '[Guest Cancelled]';
    actionLabel = 'Cancelled by Guest';
    headerColor = '#7c3aed';
  } else {
    subjectTag = '[Hotel Rejected]';
    actionLabel = 'Rejected by Hotel Owner';
    headerColor = '#b91c1c';
  }

  const subject = `${subjectTag} #${data.bookingId} — ${escapeHtml(data.hotelName)}`;

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:${headerColor};color:white;padding:20px 24px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">${subjectTag} Booking #${data.bookingId}</h2>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">${actionLabel}</p>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#fff">
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;width:140px">Booking ID</td><td style="padding:8px 12px;border:1px solid #e5e7eb">#${data.bookingId}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb">Guest</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(data.guestName)} &lt;${escapeHtml(data.guestEmail)}&gt;</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb">Hotel</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(data.hotelName)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb">Check-in</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(data.checkInDate)}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb">Action By</td><td style="padding:8px 12px;border:1px solid #e5e7eb"><strong>${actionLabel}</strong></td></tr>
      ${data.cancelReason ? `<tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb">Reason</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(data.cancelReason)}</td></tr>` : ''}
    </table>
    <p style="margin-top:24px;color:#6b7280;font-size:12px">DaydreamHub Admin Notification</p>
  </div>
</div>`;

  // Always deliver to the monitored DDH inbox, plus the configured ADMIN_EMAIL
  // if it is a valid address (secrets can carry stray whitespace/newlines).
  const adminClean = String(data.adminEmail || '').trim();
  const to = [...new Set([
    'contact@daydreamhub.com',
    ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminClean) ? [adminClean] : []),
  ])];

  return sendEmail({
    apiKey,
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to,
    subject,
    html,
  });
}
