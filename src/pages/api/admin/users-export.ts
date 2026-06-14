import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

function formatTimestampForFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const escaped = str.replace(/"/g, '""');
  return /[",\n\r]/.test(str) ? `"${escaped}"` : escaped;
}

const USER_CSV_COLUMNS: { header: string; key: string }[] = [
  { header: 'id', key: 'id' },
  { header: 'name', key: 'name' },
  { header: 'email', key: 'email' },
  { header: 'role', key: 'role' },
  { header: 'created_at', key: 'created_at' },
];

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = env?.DB;
  if (!db) {
    return new Response('Database not available', { status: 500 });
  }

  const url = new URL(request.url);
  const roleFilter = url.searchParams.get('role') || '';
  const search = url.searchParams.get('search') || '';

  let users: any[] = [];

  try {
    let query = `SELECT id, name, email, role, created_at FROM users WHERE 1=1`;
    const binds: any[] = [];

    if (roleFilter) {
      query += ' AND role = ?';
      binds.push(roleFilter);
    }
    if (search) {
      query += ' AND (name LIKE ? OR email LIKE ?)';
      binds.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT 200';

    const result = binds.length
      ? await db.prepare(query).bind(...binds).all()
      : await db.prepare(query).all();

    users = result?.results || [];
  } catch (e: any) {
    return new Response(`Failed to export users: ${e?.message || 'Unknown error'}`, { status: 500 });
  }

  const headerLine = USER_CSV_COLUMNS.map((c) => csvEscape(c.header)).join(',');
  const dataLines = users.map((user) => USER_CSV_COLUMNS.map((c) => csvEscape(user[c.key])).join(','));
  const csv = [headerLine, ...dataLines].join('\r\n');
  const bom = '\uFEFF';

  return new Response(`${bom}${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="users-${formatTimestampForFilename()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
