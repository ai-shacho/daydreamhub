import type { APIRoute } from 'astro';
import { verifyOwner } from '../../../lib/ownerAuth';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export const PUT: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'ddh-secret-2025';

  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 503, headers: json });
  }

  // 1. Verify owner authentication
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });
  }

  // 2. Parse request body
  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: json });
  }

  const { current_password, new_password } = body;

  // 3. Validate inputs
  if (!current_password || !new_password) {
    return new Response(
      JSON.stringify({ error: 'Current password and new password are required' }),
      { status: 400, headers: json }
    );
  }

  if (new_password.length < 8) {
    return new Response(
      JSON.stringify({ error: 'New password must be at least 8 characters' }),
      { status: 400, headers: json }
    );
  }

  // 4. Fetch current user's password hash from database
  const user = await db
    .prepare('SELECT id, password_hash FROM users WHERE id = ?')
    .bind(owner.sub)
    .first();

  if (!user) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: json });
  }

  // 5. Verify current password
  const currentHash = await hashPassword(current_password);
  if (currentHash !== (user as any).password_hash) {
    return new Response(
      JSON.stringify({ error: 'Current password is incorrect' }),
      { status: 400, headers: json }
    );
  }

  // 6. Hash new password and update
  const newHash = await hashPassword(new_password);
  await db
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(newHash, owner.sub)
    .run();

  // 7. Return success
  return new Response(
    JSON.stringify({ ok: true, message: 'Password changed successfully' }),
    { status: 200, headers: json }
  );
};
