import type { APIRoute } from 'astro';

// Temporary bulk SQL endpoint - secured by CRON_SECRET
export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const cronSecret = runtime?.env?.CRON_SECRET || '';

  // Auth via Bearer token (same as cron jobs)
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!cronSecret || token !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  if (!db) {
    return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { sql } = body;
  if (!sql) {
    return new Response(JSON.stringify({ error: 'sql required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const statements = sql.split(/;\s*\n|;\s*$/).map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  let success = 0, failed = 0, changes = 0;

  for (const stmt of statements) {
    try {
      const res = await db.prepare(stmt).run();
      success++;
      changes += res?.meta?.changes ?? 0;
    } catch (err) {
      failed++;
      console.error('Bulk SQL error:', stmt.slice(0, 80), err);
    }
  }

  return new Response(JSON.stringify({ success, failed, changes, total: statements.length }), { headers: { 'Content-Type': 'application/json' } });
};
