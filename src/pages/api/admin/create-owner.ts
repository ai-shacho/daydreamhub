import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export const POST: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';

  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });
  }

  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), { status: 500, headers: json });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json });
  }

  const { name, email, password } = body;
  if (!name || !email || !password) {
    return new Response(JSON.stringify({ error: 'name, email, password are required' }), { status: 400, headers: json });
  }
  if (password.length < 8) {
    return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), { status: 400, headers: json });
  }

  try {
    // Check if email already exists
    const existing = await db.prepare('SELECT id, role FROM users WHERE email = ?').bind(email.toLowerCase().trim()).first();
    if (existing) {
      // If user exists but is not owner, update role to owner
      if (existing.role !== 'owner') {
        await db.prepare("UPDATE users SET role = 'owner' WHERE id = ?").bind(existing.id).run();
        return new Response(JSON.stringify({ success: true, message: 'Existing user upgraded to owner' }), { headers: json });
      }
      return new Response(JSON.stringify({ error: 'このメールアドレスは既に登録されています' }), { status: 409, headers: json });
    }

    const passwordHash = await hashPassword(password);
    await db.prepare(
      "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'owner', datetime('now'))"
    ).bind(name, email.toLowerCase().trim(), passwordHash).run();

    return new Response(JSON.stringify({ success: true }), { status: 201, headers: json });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Failed to create owner' }), { status: 500, headers: json });
  }
};
