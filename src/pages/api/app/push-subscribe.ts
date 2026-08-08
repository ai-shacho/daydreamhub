import type { APIRoute } from 'astro';

// Register (or refresh) a device for inquiry-result notifications.
export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503 });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

  const endpoint = String(body.endpoint || '').trim();
  const session = String(body.session || '').trim();
  const lang = String(body.lang || 'en').slice(0, 5);
  if (!/^https:\/\/.{10,}/.test(endpoint) || !session) {
    return new Response(JSON.stringify({ error: 'endpoint and session required' }), { status: 400 });
  }

  try {
    await db.prepare(
      `INSERT INTO app_push_subscriptions (endpoint, session_id, lang, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(endpoint) DO UPDATE SET session_id = excluded.session_id, lang = excluded.lang, updated_at = datetime('now')`
    ).bind(endpoint, session, lang).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
