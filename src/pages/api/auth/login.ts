import type { APIRoute } from 'astro';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function createJWT(payload: Record<string, any>, secret: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${header}.${body}.${signature}`;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: json });
    }

    const env = (locals as any).runtime?.env;
    const db = env?.DB;
    if (!db) {
      return new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503, headers: json });
    }

    const user = await db
      .prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ?')
      .bind(email.toLowerCase().trim())
      .first();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401, headers: json });
    }

    const inputHash = await hashPassword(password);
    if (inputHash !== (user as any).password_hash) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401, headers: json });
    }

    // inactive users are treated as owner on login
    const effectiveRole = (user as any).role === 'inactive' ? 'owner' : (user as any).role;
    if ((user as any).role === 'inactive') {
      await db.prepare("UPDATE users SET role = 'owner' WHERE id = ?").bind((user as any).id).run();
    }

    const secret = env?.JWT_SECRET || 'ddh-secret-2025';
    const token = await createJWT(
      {
        sub: (user as any).id,
        email: (user as any).email,
        name: (user as any).name,
        role: effectiveRole,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 10, // 10 years
      },
      secret
    );

    const cookieValue = `ddh_token=${token}; Path=/; Max-Age=${60 * 60 * 24 * 365 * 10}; SameSite=Strict; HttpOnly; Secure`;

    return new Response(
      JSON.stringify({
        ok: true,
        user: { id: (user as any).id, name: (user as any).name, email: (user as any).email, role: effectiveRole },
      }),
      { status: 200, headers: { ...json, 'Set-Cookie': cookieValue } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: json });
  }
};
