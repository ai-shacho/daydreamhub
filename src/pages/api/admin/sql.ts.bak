import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';

  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
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
  if (!sql || typeof sql !== 'string') {
    return new Response(JSON.stringify({ error: 'sql field is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Split by semicolons, filter empty
  const statements = sql
    .split(/;\s*\n|;\s*$/)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  const results: any[] = [];

  for (const stmt of statements) {
    try {
      const isSelect = /^\s*(SELECT|PRAGMA|EXPLAIN)/i.test(stmt);
      if (isSelect) {
        const res = await db.prepare(stmt).all();
        results.push({
          sql: stmt,
          rows: res?.results || [],
          meta: res?.meta,
        });
      } else {
        const res = await db.prepare(stmt).run();
        results.push({
          sql: stmt,
          changes: res?.meta?.changes ?? 0,
          meta: res?.meta,
        });
      }
    } catch (err) {
      results.push({
        sql: stmt,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return new Response(JSON.stringify({ results }), { headers: { 'Content-Type': 'application/json' } });
};
