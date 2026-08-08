import type { APIRoute } from 'astro';

// Called by the service worker when a (payload-less) push wakes it: returns
// what to display. Auth is possession of the subscription endpoint.
export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({}), { status: 503 });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({}), { status: 400 }); }
  const endpoint = String(body.endpoint || '').trim();
  if (!endpoint) return new Response(JSON.stringify({}), { status: 400 });

  try {
    const sub: any = await db
      .prepare('SELECT session_id, lang FROM app_push_subscriptions WHERE endpoint = ?')
      .bind(endpoint)
      .first();
    if (!sub) return new Response(JSON.stringify({}), { status: 404 });

    const isJa = String(sub.lang || '').startsWith('ja');
    const call: any = await db
      .prepare(
        `SELECT c.hotel_name, c.price_quoted, c.outcome, c.hotel_phone
           FROM concierge_calls c
           JOIN concierge_call_groups g ON g.id = c.call_group_id
          WHERE g.session_id = ?
          ORDER BY c.updated_at DESC LIMIT 1`
      )
      .bind(sub.session_id)
      .first();

    if (!call) return new Response(JSON.stringify({}), { status: 404 });

    const hotel = call.hotel_name || (isJa ? 'ホテル' : 'the hotel');
    const quoted = call.price_quoted != null && String(call.price_quoted) !== '';
    const title = quoted
      ? (isJa ? '料金の回答が届きました' : 'Price quote received')
      : (isJa ? '確認結果が届きました' : 'Inquiry result');
    const bodyText = quoted
      ? (isJa ? `${hotel}：${call.price_quoted} で利用できます。タップして予約に進めます。`
              : `${hotel}: ${call.price_quoted}. Tap to book.`)
      : (isJa ? `${hotel}：デイユースの確認がとれませんでした。` : `${hotel}: could not confirm day-use.`);

    return new Response(JSON.stringify({ title, body: bodyText, url: '/app' }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({}), { status: 500 });
  }
};
