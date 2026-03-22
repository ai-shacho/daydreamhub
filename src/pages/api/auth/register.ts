import type { APIRoute } from 'astro';

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
  try {
    const body = await request.json();
    const email = (body.email || '').toLowerCase().trim();
    const password = body.password || '';
    // Support both { name } and { first_name, last_name }
    const name = body.name
      || [body.first_name, body.last_name].filter(Boolean).join(' ')
      || 'Guest';

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: json });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), { status: 400, headers: json });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), { status: 400, headers: json });
    }

    const env = (locals as any).runtime?.env;
    const db = env?.DB;
    if (!db) {
      return new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503, headers: json });
    }

    // Check if email already exists
    const existing = await db
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first();

    if (existing) {
      return new Response(JSON.stringify({ error: 'An account with this email already exists' }), { status: 409, headers: json });
    }

    const passwordHash = await hashPassword(password);

    await db
      .prepare(
        'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
      )
      .bind(name, email, passwordHash, 'user')
      .run();

    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: json });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: json });
  }
};
