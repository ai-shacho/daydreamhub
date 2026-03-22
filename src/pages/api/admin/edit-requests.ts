import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin)
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!db)
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status') || '';
  let query = `SELECT er.*, h.name as hotel_name, u.name as requester_name
    FROM hotel_edit_requests er
    LEFT JOIN hotels h ON er.hotel_id = h.id
    LEFT JOIN users u ON er.requested_by = u.id`;
  const binds: any[] = [];
  if (statusFilter) {
    query += ' WHERE er.status = ?';
    binds.push(statusFilter);
  }
  query += ' ORDER BY er.created_at DESC LIMIT 100';
  try {
    const result =
      binds.length > 0
        ? await db.prepare(query).bind(...binds).all()
        : await db.prepare(query).all();
    return new Response(JSON.stringify({ requests: result?.results || [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Failed to fetch edit requests', details: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin)
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!db)
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { id, action, admin_note } = body;
  if (!id || !action || !['approve', 'reject'].includes(action)) {
    return new Response(
      JSON.stringify({ error: 'Invalid request. Required: id, action (approve/reject)' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  try {
    const editReq = await db
      .prepare('SELECT * FROM hotel_edit_requests WHERE id = ?')
      .bind(id)
      .first();
    if (!editReq)
      return new Response(JSON.stringify({ error: 'Edit request not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    if (editReq.status !== 'pending')
      return new Response(JSON.stringify({ error: 'Request already processed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });

    if (action === 'approve') {
      const changes = JSON.parse(editReq.field_changes as string);
      const allowedFields = [
        'name',
        'name_ja',
        'description',
        'description_ja',
        'amenities',
        'categories',
        'property_type',
        'thumbnail_url',
        'ical_url',
        'phone',
        'address',
      ];
      const updates: string[] = [];
      const values: any[] = [];
      for (const [key, value] of Object.entries(changes)) {
        if (allowedFields.includes(key)) {
          updates.push(`${key} = ?`);
          values.push(value);
        }
      }
      if (updates.length > 0) {
        values.push(editReq.hotel_id);
        await db
          .prepare(`UPDATE hotels SET ${updates.join(', ')} WHERE id = ?`)
          .bind(...values)
          .run();
      }
    }
    await db
      .prepare(
        'UPDATE hotel_edit_requests SET status = ?, admin_note = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?'
      )
      .bind(action === 'approve' ? 'approved' : 'rejected', admin_note || null, admin.sub, id)
      .run();
    return new Response(
      JSON.stringify({ success: true, message: `Edit request ${action}d`, id }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Failed to process edit request', details: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
