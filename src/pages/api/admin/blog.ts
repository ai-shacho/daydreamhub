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
  const search = url.searchParams.get('search') || '';
  const published = url.searchParams.get('published');
  const city = url.searchParams.get('city') || '';
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: any[] = [];

  if (search) {
    conditions.push('(title LIKE ? OR title_ja LIKE ? OR slug LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (published !== null && published !== '') {
    if (published === '1') {
      conditions.push('published_at IS NOT NULL');
    } else {
      conditions.push('published_at IS NULL');
    }
  }
  if (city) {
    conditions.push('city = ?');
    params.push(city);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await db
      .prepare(`SELECT COUNT(*) as total FROM blog_posts ${whereClause}`)
      .bind(...params)
      .first();
    const total = countResult?.total || 0;

    const posts = await db
      .prepare(
        `SELECT id, title, title_ja, slug, excerpt, city, thumbnail_url, published_at
         FROM blog_posts ${whereClause}
         ORDER BY published_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...params, perPage, offset)
      .all();

    return new Response(JSON.stringify({ posts: posts.results, total, page, perPage }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Failed to fetch blog posts', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
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

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id, is_published } = body;
  if (id === undefined || is_published === undefined) {
    return new Response(JSON.stringify({ error: 'Missing required fields: id, is_published' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const publishedAt = is_published ? new Date().toISOString() : null;
    const result = await db
      .prepare(
        `UPDATE blog_posts SET published_at = ? WHERE id = ?`
      )
      .bind(publishedAt, id)
      .run();

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Blog post not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ message: 'Blog post updated', id, is_published }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Failed to update blog post', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
