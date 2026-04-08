import type { APIRoute } from 'astro';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export const GET: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const url = new URL(request.url);
  const role = url.searchParams.get('role') || '';
  const search = url.searchParams.get('search') || '';

  let query = 'SELECT id, name, email, role, created_at FROM users WHERE 1=1';
  const binds: any[] = [];
  if (role) { query += ' AND role = ?'; binds.push(role); }
  if (search) { query += ' AND (name LIKE ? OR email LIKE ?)'; binds.push(`%${search}%`, `%${search}%`); }
  const limit = parseInt(new URL(request.url).searchParams.get('limit') || '200');
  query += ` ORDER BY created_at DESC LIMIT ${Math.min(limit, 1000)}`;

  try {
    const result = binds.length
      ? await db.prepare(query).bind(...binds).all()
      : await db.prepare(query).all();
    return new Response(JSON.stringify({ users: result?.results || [] }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch users' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let data: any;
  try { data = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { name, email, password, role = 'user' } = data;
  if (!name || !email || !password) {
    return new Response(JSON.stringify({ error: 'name, email, and password are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const passwordHash = await hashPassword(password);
    await db.prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)"
    ).bind(name, email, passwordHash, role).run();
    const user = await db.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').bind(email).first();
    return new Response(JSON.stringify({ success: true, id: user?.id, user: { name, email, role }, plainPassword: password }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('UNIQUE') || message.includes('unique')) {
      return new Response(JSON.stringify({ error: 'Email already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Failed to create user', details: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let data: any;
  try { data = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { id, name, email, password, role } = data;
  if (!id) return new Response(JSON.stringify({ error: 'id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const updates: string[] = [];
  const params: any[] = [];
  if (name) { updates.push('name = ?'); params.push(name); }
  if (email) { updates.push('email = ?'); params.push(email); }
  if (role) { updates.push('role = ?'); params.push(role); }
  if (password) {
    const passwordHash = await hashPassword(password);
    updates.push('password_hash = ?');
    params.push(passwordHash);
  }

  if (!updates.length) return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  try {
    await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params, Number(id)).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('UNIQUE') || message.includes('unique')) {
      return new Response(JSON.stringify({ error: 'Email already in use' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Failed to update user', details: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Prevent deleting admin accounts
  const user = await db.prepare('SELECT role FROM users WHERE id = ?').bind(Number(id)).first();
  if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  if ((user as any).role === 'admin') return new Response(JSON.stringify({ error: 'Cannot delete admin accounts' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  try {
    await db.prepare('DELETE FROM users WHERE id = ?').bind(Number(id)).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Failed to delete user', details: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
