import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const apiKey = env?.RESEND_API_KEY;

  let data: Record<string, string>;
  try {
    data = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const required = ['hotel_name', 'booking_email', 'hotel_phone', 'contact_name', 'contact_email', 'contact_phone', 'contact_method', 'payment_method'];
  for (const field of required) {
    if (!data[field]?.trim()) {
      return new Response(JSON.stringify({ error: `Missing required field: ${field}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const escape = (s: string) =>
    (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9;white-space:nowrap">${escape(label)}</td><td style="padding:8px 12px;border:1px solid #ddd">${escape(value || '-')}</td></tr>`;

  const html = `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
  <div style="background:#0d9488;color:white;padding:24px;text-align:center;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:22px">New Owner Application</h1>
    <p style="margin:8px 0 0;opacity:0.9">DayDreamHub Property Listing Request</p>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <h3 style="color:#333;margin-top:0">Property Information</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px">
      ${row('Hotel Name', data.hotel_name)}
      ${row('Booking Management Email', data.booking_email)}
      ${row('Hotel Phone', data.hotel_phone)}
      ${row('Management Company', data.management_company)}
      ${row('Website URL', data.site_url)}
    </table>
    <h3 style="color:#333">Contact Person</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px">
      ${row('Name', data.contact_name)}
      ${row('Email', data.contact_email)}
      ${row('Direct Phone', data.contact_phone)}
      ${row('Other Contact Method', data.contact_method)}
      ${row('Messenger URL', data.messenger_url)}
      ${row('WhatsApp URL', data.whatsapp_url)}
      ${row('LINE URL', data.line_url)}
      ${row('Other SNS URL', data.other_sns_url)}
    </table>
    <h3 style="color:#333">Payment Information</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px">
      ${row('Preferred Payment Method', data.payment_method)}
      ${row('PayPal Account', data.paypal_account)}
      ${row('Wise Account', data.wise_account)}
      ${row('Payoneer Account', data.payoneer_account)}
    </table>
    <p style="color:#666;font-size:12px;margin-top:24px">Submitted via DayDreamHub Owner Application Form</p>
  </div>
</div>`;

  // Save to database
  const db = env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'DB binding not available', debug: 'env.DB is undefined' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    await db.prepare(`
      INSERT INTO owner_applications (
        hotel_name, booking_email, hotel_phone, management_company, site_url,
        contact_name, contact_email, contact_phone, contact_method,
        messenger_url, whatsapp_url, line_url, other_sns_url,
        payment_method, paypal_account, wise_account, payoneer_account
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      data.hotel_name, data.booking_email, data.hotel_phone,
      data.management_company || '', data.site_url || '',
      data.contact_name, data.contact_email, data.contact_phone,
      data.contact_method || '',
      data.messenger_url || '', data.whatsapp_url || '',
      data.line_url || '', data.other_sns_url || '',
      data.payment_method || '', data.paypal_account || '',
      data.wise_account || '', data.payoneer_account || ''
    ).run();

    // Register as inactive hotel
    const baseSlug = data.hotel_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const uniqueSlug = `${baseSlug}-${Date.now()}`;
    await db.prepare(`
      INSERT INTO hotels (name, slug, city, country, email, phone, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `).bind(
      data.hotel_name,
      uniqueSlug,
      data.city || '',
      data.country || '',
      data.booking_email || '',
      data.hotel_phone || ''
    ).run();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: 'DB insert failed', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!apiKey) {
    console.log('Owner application received (no RESEND_API_KEY):', data);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'DayDreamHub <noreply@daydreamhub.com>',
      to: ['contact@daydreamhub.com'],
      subject: `New Owner Application: ${data.hotel_name}`,
      html,
      reply_to: data.contact_email,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Resend error:', text);
    return new Response(JSON.stringify({ error: 'Failed to send email. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
