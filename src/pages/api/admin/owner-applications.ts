import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/apiAuth';
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
  const { admin, response } = await requireAdmin(request, jwtSecret);
  if (response) return response;
  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: json });

  let data: any;
  try { data = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json }); }

  const { id, status, note, action } = data;
  const hotelId = data.hotel_id !== undefined && data.hotel_id !== null && data.hotel_id !== ''
    ? Number(data.hotel_id)
    : null;

  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: json });
  if (hotelId !== null && (!Number.isInteger(hotelId) || hotelId <= 0)) {
    return new Response(JSON.stringify({ error: 'hotel_id must be a positive integer' }), { status: 400, headers: json });
  }

  // --- 承認処理（Task #57: アカウント作成・認証情報通知をオプショナル化） ---
  // action:
  //   'approve'          … 標準承認（status=approved のみ）。create_account/send_credentials で拡張。
  //   'approve_and_send' … 後方互換。create_account=true 相当として扱う（送信は send_credentials 明示時のみ）。
  if (action === 'approve' || action === 'approve_and_send') {
    const app = await db.prepare('SELECT * FROM owner_applications WHERE id = ?').bind(Number(id)).first() as any;
    if (!app) return new Response(JSON.stringify({ error: 'Application not found' }), { status: 404, headers: json });

    // 明示指定時のみアカウント作成。後方互換で approve_and_send は作成扱い。
    const createAccount = data.create_account === true || action === 'approve_and_send';
    // 認証情報メールは明示指定時のみ（新運用では初期PW送付を常用しない）。
    const sendCredentials = data.send_credentials === true;

    const loginEmail = (app.contact_email || '').toLowerCase().trim();
    const ownerName = app.contact_name;

    let accountCreated = false;
    let credentialsSent = false;
    let plainPassword: string | null = null;

    try {
      if (createAccount) {
        // 既存アカウント確認（重複は維持）
        const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(loginEmail).first();
        if (existing) {
          return new Response(JSON.stringify({ error: 'An account with this email already exists.' }), { status: 409, headers: json });
        }
        const password = generatePassword();
        plainPassword = password;
        const passwordHash = await hashPassword(password);
        await db.prepare(
          "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'owner', datetime('now'))"
        ).bind(ownerName, loginEmail, passwordHash).run();
        accountCreated = true;

        // 認証情報メールは明示指定時のみ送信
        if (sendCredentials) {
          const resendKey = env?.RESEND_API_KEY;
          if (resendKey) {
            await sendOwnerAccountEmail(resendKey, { name: ownerName, email: loginEmail, password });
            credentialsSent = true;
          }
        }
      }

      // 申込ステータスを approved に更新
      await db.prepare(
        'UPDATE owner_applications SET status = ?, note = ? WHERE id = ?'
      ).bind('approved', note ?? app.note ?? '', Number(id)).run();

      // hotel_id が指定された場合は同一フローでオーナー割り当て
      if (hotelId !== null) {
        const hotel = await db.prepare('SELECT id, name, email FROM hotels WHERE id = ?').bind(hotelId).first() as any;
        if (!hotel) {
          return new Response(JSON.stringify({ error: `Hotel not found: ${hotelId}` }), { status: 404, headers: json });
        }
        if (hotel.email) {
          return new Response(JSON.stringify({ error: `Hotel #${hotelId} is already assigned to ${hotel.email}` }), { status: 409, headers: json });
        }

        await db.prepare('UPDATE hotels SET email = ?, is_active = 1 WHERE id = ?').bind(loginEmail, hotelId).run();

        // 既存の割り当て通知と同等のメール送信
        const resendKey = env?.RESEND_API_KEY;
        if (resendKey) {
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'DaydreamHub <noreply@daydreamhub.com>',
              to: [loginEmail],
              subject: `Hotel Assigned: ${hotel.name || `Hotel #${hotelId}`} — DaydreamHub`,
              html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
                <div style="background:#4f46e5;color:white;padding:24px;text-align:center;border-radius:8px 8px 0 0">
                  <h1 style="margin:0;font-size:20px">🏨 Hotel Assigned to Your Account</h1>
                </div>
                <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;background:#fff">
                  <p>Hi <strong>${ownerName}</strong>,</p>
                  <p><strong>${hotel.name || `Hotel #${hotelId}`}</strong> has been assigned to your DaydreamHub owner account.</p>
                  <p>You can now manage this hotel from the Owner Portal:</p>
                  <div style="text-align:center;margin:24px 0">
                    <a href="${env?.SITE_URL || 'https://daydreamhub.com'}/login?redirect=/owner" style="display:inline-block;padding:12px 28px;background:#4f46e5;color:white;text-decoration:none;border-radius:8px;font-weight:700">Go to Owner Portal →</a>
                  </div>
                </div>
              </div>`,
            }),
          }).catch((err) => console.error('Assign owner email failed:', err));
        }
      }

      const mode = accountCreated ? 'approved_with_account' : 'approved';
      const message = accountCreated
        ? (credentialsSent
            ? 'アカウントを作成し、認証情報メールを送信しました。'
            : 'アカウントを作成しました。初期パスワードは画面表示で一度のみ確認してください。')
        : '申込を承認しました（ステータス更新のみ）。アカウントが必要な場合はAdminのUsers管理から作成・パスワード設定を実施してください。';

      return new Response(JSON.stringify({
        success: true,
        mode,
        account_created: accountCreated,
        credentials_sent: credentialsSent,
        email: createAccount ? loginEmail : undefined,
        generated_password: createAccount ? plainPassword : undefined,
        hotel_assigned: hotelId !== null,
        hotel_id: hotelId ?? undefined,
        message,
      }), { headers: json });
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
