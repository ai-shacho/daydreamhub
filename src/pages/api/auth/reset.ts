import type { APIRoute } from 'astro';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// POST: request password reset (send email)
// PUT:  set new password (consume token)
export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  const resendApiKey = (locals as any).runtime?.env?.RESEND_API_KEY;

  if (!db) {
    return new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const { email } = await request.json();
  if (!email) {
    return new Response(JSON.stringify({ error: 'Email is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check user exists (don't reveal if not found — always return ok)
  let user: any = null;
  try { user = await db.prepare('SELECT id, name FROM users WHERE email = ?').bind(email).first(); } catch (_) {}

  if (user && resendApiKey) {
    // Ensure table exists (ignore error if already exists)
    try {
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS password_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, token TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, created_at INTEGER DEFAULT (unixepoch()))`
      ).run();
    } catch (_) { /* table already exists */ }

    // Delete old tokens for this email
    try { await db.prepare('DELETE FROM password_resets WHERE email = ?').bind(email).run(); } catch (_) {}

    // Generate token (expires in 1 hour)
    const token = generateToken();
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    await db.prepare('INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)')
      .bind(email, token, expiresAt).run();

    // Determine base URL
    const origin = request.headers.get('origin') || 'https://daydreamhub.com';
    const resetLink = `${origin}/auth/new-password?token=${token}`;

    // Send email via Resend
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'DaydreamHub <noreply@daydreamhub.com>',
        to: [email],
        subject: 'Reset your DaydreamHub password',
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:#0d9488;color:white;padding:28px 24px;text-align:center;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:22px">Password Reset</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">DaydreamHub</p>
  </div>
  <div style="padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#fff">
    <p>Hello${user.name ? ' ' + user.name : ''},</p>
    <p>We received a request to reset your password. Click the button below to set a new password:</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${resetLink}" style="display:inline-block;padding:12px 32px;background:#0d9488;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px">Reset Password</a>
    </div>
    <p style="color:#6b7280;font-size:13px">This link will expire in <strong>1 hour</strong>. If you did not request a password reset, please ignore this email.</p>
    <hr style="border:none;border-top:1px solid #f3f4f6;margin:20px 0"/>
    <p style="color:#9ca3af;font-size:12px">DaydreamHub — Day-Use Hotel Booking Worldwide</p>
  </div>
</div>`,
      }),
    });
  }

  // Always return success (don't reveal whether email exists)
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// PUT: verify token and set new password
export const PUT: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const { token, password } = await request.json();
  if (!token || !password) {
    return new Response(JSON.stringify({ error: 'Token and password are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (password.length < 8) {
    return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const now = Math.floor(Date.now() / 1000);
  const reset = await db.prepare(
    'SELECT email FROM password_resets WHERE token = ? AND expires_at > ?'
  ).bind(token, now).first();

  if (!reset) {
    return new Response(JSON.stringify({ error: 'Invalid or expired reset link. Please request a new one.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const hash = await hashPassword(password);
  await db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').bind(hash, reset.email).run();
  await db.prepare('DELETE FROM password_resets WHERE token = ?').bind(token).run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
