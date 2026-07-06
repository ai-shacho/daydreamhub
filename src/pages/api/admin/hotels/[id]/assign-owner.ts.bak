import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../../../lib/adminAuth';

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';

  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Hotel ID is required' }), {
      status: 400,
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

  const { owner_email } = body;
  if (!owner_email) {
    return new Response(JSON.stringify({ error: 'owner_email is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Check owner exists
    const owner = await db
      .prepare(`SELECT id, name, email FROM users WHERE email = ? AND role IN ('owner', 'inactive')`)
      .bind(owner_email)
      .first();

    if (!owner) {
      return new Response(
        JSON.stringify({ error: `No owner account found with email: ${owner_email}` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update hotel email and activate
    await db
      .prepare(`UPDATE hotels SET email = ?, is_active = 1 WHERE id = ?`)
      .bind(owner_email, id)
      .run();

    // Send hotel assignment notification to owner
    const resendKey = runtime?.env?.RESEND_API_KEY;
    if (resendKey) {
      const hotel = await db.prepare('SELECT name FROM hotels WHERE id = ?').bind(id).first();
      const hotelName = (hotel as any)?.name || `Hotel #${id}`;
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'DaydreamHub <noreply@daydreamhub.com>',
          to: [owner_email],
          subject: `Hotel Assigned: ${hotelName} — DaydreamHub`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
            <div style="background:#4f46e5;color:white;padding:24px;text-align:center;border-radius:8px 8px 0 0">
              <h1 style="margin:0;font-size:20px">🏨 Hotel Assigned to Your Account</h1>
            </div>
            <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#fff">
              <p>Hi <strong>${(owner as any).name}</strong>,</p>
              <p><strong>${hotelName}</strong> has been assigned to your DaydreamHub owner account.</p>
              <p>You can now manage this hotel from the Owner Portal:</p>
              <div style="text-align:center;margin:24px 0">
                <a href="${runtime?.env?.SITE_URL || 'https://daydreamhub.com'}/login?redirect=/owner" style="display:inline-block;padding:12px 28px;background:#4f46e5;color:white;text-decoration:none;border-radius:8px;font-weight:700">Go to Owner Portal →</a>
              </div>
            </div>
          </div>`,
        }),
      }).catch((err) => console.error('Assign owner email failed:', err));
    }

    return new Response(
      JSON.stringify({ success: true, owner: { name: owner.name, email: owner.email } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Database error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
