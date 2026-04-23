import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';
import { sendOwnerAccountEmail } from '../../../lib/email';

const json = { 'Content-Type': 'application/json' };

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  let pw = '';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  for (const b of arr) pw += chars[b % chars.length];
  return pw;
}

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: json });

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';

  let query = 'SELECT * FROM owner_applications WHERE 1=1';
  const binds: any[] = [];
  if (status) { query += ' AND status = ?'; binds.push(status); }
  query += ' ORDER BY created_at DESC LIMIT 200';

  try {
    const result = binds.length
      ? await db.prepare(query).bind(...binds).all()
      : await db.prepare(query).all();
    return new Response(JSON.stringify({ applications: result?.results || [] }), { headers: json });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to fetch applications' }), { status: 500, headers: json });
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });

  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: json });

  let data: any;
  try { data = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json }); }

  const { id, status, note, action } = data;
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: json });

  // --- approve_and_send: アカウント作成＋メール送信＋ステータス更新 ---
  if (action === 'approve_and_send') {
    const app = await db.prepare('SELECT * FROM owner_applications WHERE id = ?').bind(Number(id)).first() as any;
    if (!app) return new Response(JSON.stringify({ error: 'Application not found' }), { status: 404, headers: json });

    const loginEmail = app.contact_email;
    const ownerName = app.contact_name;

    // 既存アカウント確認
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(loginEmail).first();
    if (existing) {
      return new Response(JSON.stringify({ error: 'An account with this email already exists.' }), { status: 409, headers: json });
    }

    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    try {
      // 1. users にオーナーアカウント作成
      await db.prepare(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
      ).bind(ownerName, loginEmail, passwordHash, 'owner').run();

      // 2. 申込時に作られた inactive ホテルの email を contact_email に更新（紐づけのため）
      await db.prepare(
        `UPDATE hotels SET email = ? WHERE name = ? AND is_active = 0 AND (email = ? OR email = '' OR email IS NULL)`
      ).bind(loginEmail, app.hotel_name, app.booking_email).run();

      // 3. owner_applications ステータスを approved に
      await db.prepare(
        'UPDATE owner_applications SET status = ?, note = ? WHERE id = ?'
      ).bind('approved', note || app.note || '', Number(id)).run();

      // 4. ログイン情報メール送信
      const resendKey = env?.RESEND_API_KEY;
      if (resendKey) {
        await sendOwnerAccountEmail(resendKey, { name: ownerName, email: loginEmail, password });
      }

      return new Response(JSON.stringify({ success: true, email: loginEmail, password }), { headers: json });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: 'Failed to approve', details: message }), { status: 500, headers: json });
    }
  }

  // --- 通常のステータス更新 ---
  if (!status) return new Response(JSON.stringify({ error: 'status required' }), { status: 400, headers: json });

  const updates: string[] = ['status = ?'];
  const params: any[] = [status];
  if (note !== undefined) { updates.push('note = ?'); params.push(note); }

  try {
    await db.prepare(`UPDATE owner_applications SET ${updates.join(', ')} WHERE id = ?`).bind(...params, Number(id)).run();
    return new Response(JSON.stringify({ success: true }), { headers: json });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to update' }), { status: 500, headers: json });
  }
};
