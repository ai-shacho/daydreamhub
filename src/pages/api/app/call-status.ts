import type { APIRoute } from 'astro';
import { currencyForPhone } from '../../../lib/phoneCurrency';

// Status of an AI inquiry call group, for the app's contact-free flow: the
// guest gave no email at inquiry time, so the quote is delivered here instead.
// Auth: the caller must present the session_id the group was created under —
// a client-generated UUID that acts as the bearer secret.

export const GET: APIRoute = async ({ url, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503 });

  const group = url.searchParams.get('group') || '';
  const session = url.searchParams.get('session') || '';
  if (!group || !session || session.length < 8) {
    return new Response(JSON.stringify({ error: 'group and session required' }), { status: 400 });
  }

  try {
    const g: any = await db
      .prepare('SELECT id, status FROM concierge_call_groups WHERE id = ? AND session_id = ?')
      .bind(group, session)
      .first();
    if (!g) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });

    const rows = await db
      .prepare(
        `SELECT id, hotel_name, hotel_phone, status, outcome, price_quoted, accept_token, guest_accepted_at
           FROM concierge_calls WHERE call_group_id = ? ORDER BY call_order ASC, id ASC`
      )
      .bind(group)
      .all();

    const calls = [];
    for (const c of (rows.results || []) as any[]) {
      let token = c.accept_token || null;
      const priced = c.price_quoted != null && String(c.price_quoted) !== '';
      // The token normally gets minted when the quote email goes out; with no
      // email on file we mint it here so the app can hand off to /concierge/accept.
      if (priced && !token) {
        token = crypto.randomUUID().replace(/-/g, '');
        await db
          .prepare('UPDATE concierge_calls SET accept_token = ? WHERE id = ? AND (accept_token IS NULL OR accept_token = "")')
          .bind(token, c.id)
          .run()
          .catch(() => {});
      }
      calls.push({
        hotel: c.hotel_name,
        status: c.status || 'pending',
        outcome: c.outcome || null,
        price: priced ? c.price_quoted : null,
        currency: priced ? currencyForPhone(c.hotel_phone).currency || 'USD' : null,
        accept_token: priced ? token : null,
        accepted: !!c.guest_accepted_at,
      });
    }

    return new Response(JSON.stringify({ group_status: g.status, calls }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
