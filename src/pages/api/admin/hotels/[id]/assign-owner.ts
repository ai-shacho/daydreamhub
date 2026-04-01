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
      .prepare(`SELECT id, name, email FROM users WHERE email = ? AND role = 'owner'`)
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
