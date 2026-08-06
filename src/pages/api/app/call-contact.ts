import type { APIRoute } from 'astro';

// Attach guest contact details to an inquiry-call quote right before the
// accept/payment step. The app's inquiry flow is contact-free; name and email
// are only collected once the guest decides to book, and the confirmation
// emails need them. Auth: possession of the accept token.

export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const token = String(body.token || '').trim();
  const name = String(body.name || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().slice(0, 120);
  const phone = String(body.phone || '').trim().slice(0, 40);
  if (!token || token.length < 8 || !name || !/.+@.+\..+/.test(email)) {
    return new Response(JSON.stringify({ error: 'token, name and valid email required' }), { status: 400 });
  }

  try {
    const call: any = await db
      .prepare('SELECT id, call_group_id, request_details FROM concierge_calls WHERE accept_token = ?')
      .bind(token)
      .first();
    if (!call) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });

    // Apply to the whole group so whichever hotel gets booked can notify.
    const rows = await db
      .prepare('SELECT id, request_details FROM concierge_calls WHERE call_group_id = ?')
      .bind(call.call_group_id)
      .all();
    for (const c of (rows.results || []) as any[]) {
      let details: any = {};
      try { details = JSON.parse(c.request_details || '{}'); } catch {}
      details.guest_name = name;
      details.guest_email = email;
      if (phone) details.guest_phone = phone;
      await db
        .prepare(
          `UPDATE concierge_calls SET guest_name = ?, guest_email = ?, request_details = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .bind(name, email, JSON.stringify(details), c.id)
        .run();
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
