import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const CRON_SECRET = runtime?.env?.CRON_SECRET;

  // 認証チェック
  const authHeader = request.headers.get('Authorization');
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!db) {
    return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // ① confirmed → completed（チェックイン日が今日より前）
  const completedResult = await db
    .prepare(`
      UPDATE bookings 
      SET status = 'completed', updated_at = datetime('now')
      WHERE status = 'confirmed'
        AND check_in_date < ?
    `)
    .bind(today)
    .run();

  // ② pending_confirmation → no_show（チェックイン日が今日より前 かつ オーナー未承認）
  const noShowResult = await db
    .prepare(`
      UPDATE bookings 
      SET status = 'no_show', updated_at = datetime('now')
      WHERE status = 'pending_confirmation'
        AND check_in_date < ?
    `)
    .bind(today)
    .run();

  return new Response(
    JSON.stringify({
      success: true,
      completed: completedResult.meta?.changes ?? 0,
      no_show: noShowResult.meta?.changes ?? 0,
      processed_at: new Date().toISOString(),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
