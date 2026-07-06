import type { APIRoute } from 'astro';

async function ensureTable(db: any) {
  try {
    await db.prepare("SELECT id FROM news LIMIT 1").first();
  } catch {
    await db.exec(`CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      title_ja TEXT,
      content TEXT,
      content_ja TEXT,
      category TEXT DEFAULT 'update',
      published_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  }
}

// GET: list news
export const GET: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return json({ error: 'DB unavailable' }, 500);
  await ensureTable(db);

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const published = url.searchParams.get('published');

  let query = 'SELECT * FROM news';
  if (published === '1') query += ' WHERE published_at IS NOT NULL';
  else if (published === '0') query += ' WHERE published_at IS NULL';
  query += ' ORDER BY published_at DESC, created_at DESC LIMIT ?';

  const result = await db.prepare(query).bind(limit).all();
  return json({ news: result?.results || [] });
};

// POST: create news
export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return json({ error: 'DB unavailable' }, 500);
  await ensureTable(db);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { title, title_ja, content, content_ja, category, published_at } = body;
  if (!title) return json({ error: 'title is required' }, 400);

  const pubAt = published_at === '' || !published_at ? null : published_at;
  const r = await db.prepare(
    "INSERT INTO news (title, title_ja, content, content_ja, category, published_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(title, title_ja || null, content || null, content_ja || null, category || 'update', pubAt).run();

  return json({ success: true, id: r.meta?.last_row_id }, 201);
};

// PUT: update news
export const PUT: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return json({ error: 'DB unavailable' }, 500);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { id, title, title_ja, content, content_ja, category, published_at } = body;
  if (!id) return json({ error: 'id is required' }, 400);

  const pubAt = published_at === '' ? null : published_at;
  await db.prepare(
    "UPDATE news SET title = ?, title_ja = ?, content = ?, content_ja = ?, category = ?, published_at = ? WHERE id = ?"
  ).bind(title, title_ja || null, content || null, content_ja || null, category || 'update', pubAt, id).run();

  return json({ success: true });
};

// DELETE: delete news
export const DELETE: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return json({ error: 'DB unavailable' }, 500);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  await db.prepare('DELETE FROM news WHERE id = ?').bind(Number(id)).run();
  return json({ success: true });
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
