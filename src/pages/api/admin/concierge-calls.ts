import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const url = new URL(request.url);
  const groupId = url.searchParams.get('group_id');
  const sessionId = url.searchParams.get('session_id');
  if (!db) {
    return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });
  }

  if (sessionId) {
    try {
      const result = await db
        .prepare(
          `SELECT role, content, message_type, created_at
           FROM concierge_messages
           WHERE session_id = ?
           ORDER BY created_at ASC
           LIMIT 200`
        )
        .bind(sessionId)
        .all();
      return new Response(JSON.stringify({ messages: result?.results || [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  if (!groupId) {
    return new Response(JSON.stringify({ error: 'Missing group_id or session_id' }), {
      status: 400,
    });
  }

  try {
    const result = await db
      .prepare(
        `SELECT id, call_order, hotel_name, hotel_phone, hotel_source, hotel_id,
                status, outcome, ai_summary, availability_info, price_quoted, recommendation_reason,
                telnyx_call_id, guest_name, guest_email, confirmation_email_sent,
                duration_seconds, created_at, updated_at
         FROM concierge_calls
         WHERE call_group_id = ?
         ORDER BY call_order ASC`
      )
      .bind(parseInt(groupId))
      .all();
    return new Response(JSON.stringify({ calls: result?.results || [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
