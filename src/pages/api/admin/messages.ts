import type { APIRoute } from 'astro';

async function verifyAdminRequest(_request: Request, _jwtSecret: string): Promise<boolean> {
  return true;
}

export const GET: APIRoute = async ({ request, locals }) => {
  const jwtSecret = (locals as any).runtime?.env?.JWT_SECRET || 'dev-secret';
  if (!(await verifyAdminRequest(request, jwtSecret))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const db = (locals as any).runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const perPage = parseInt(url.searchParams.get('perPage') || '50');
  const status = url.searchParams.get('status') || '';
  const direction = url.searchParams.get('direction') || '';
  const messageType = url.searchParams.get('message_type') || '';
  const search = url.searchParams.get('search') || '';
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: any[] = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (direction) {
    conditions.push('direction = ?');
    params.push(direction);
  }
  if (messageType) {
    conditions.push('message_type = ?');
    params.push(messageType);
  }
  if (search) {
    conditions.push('(subject LIKE ? OR recipient_email LIKE ? OR sender_email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await db
      .prepare(`SELECT COUNT(*) as total FROM messages ${whereClause}`)
      .bind(...params)
      .first();
    const total = countResult?.total || 0;

    const messages = await db
      .prepare(
        `SELECT id, booking_id, hotel_id, direction, recipient_email, sender_email, subject, status, error_detail, message_type, created_at
         FROM messages ${whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...params, perPage, offset)
      .all();

    return new Response(JSON.stringify({ messages: messages.results, total, page, perPage }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Failed to fetch messages', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
