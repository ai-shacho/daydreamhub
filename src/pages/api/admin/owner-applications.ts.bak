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

    try {
      if (createAccount) {
        // 既存アカウント確認（重複は維持）
        const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(loginEmail).first();
        if (existing) {
          return new Response(JSON.stringify({ error: 'An account with this email already exists.' }), { status: 409, headers: json });
        }
        const password = generatePassword();
        const passwordHash = await hashPassword(password);
        await db.prepare(
          "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'owner', datetime('now'))"
        ).bind(ownerName, loginEmail, passwordHash).run();
        accountCreated = true;

        // 認証情報メールは明示指定時のみ送信（初期PWは画面に返さない）
        if (sendCredentials) {
          const resendKey = env?.RESEND_API_KEY;
          if (resendKey) {
            await sendOwnerAccountEmail(resendKey, { name: ownerName, email: loginEmail, password });
            credentialsSent = true;
          }
        }
      }

      // 申込ステータスを approved に更新（hotels 更新は Task #57 で廃止）
      await db.prepare(
        'UPDATE owner_applications SET status = ?, note = ? WHERE id = ?'
      ).bind('approved', note ?? app.note ?? '', Number(id)).run();

      const mode = accountCreated ? 'approved_with_account' : 'approved';
      const message = accountCreated
        ? (credentialsSent
            ? 'アカウントを作成し、認証情報メールを送信しました。'
            : 'アカウントを作成しました。初期パスワードは表示されません。ログイン不可の場合はAdminのUsers管理からパスワード再設定を実施してください。')
        : '申込を承認しました（ステータス更新のみ）。アカウントが必要な場合はAdminのUsers管理から作成・パスワード設定を実施してください。';

      return new Response(JSON.stringify({
        success: true,
        mode,
        account_created: accountCreated,
        credentials_sent: credentialsSent,
        email: createAccount ? loginEmail : undefined,
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
