import type { APIRoute } from 'astro';

async function verifyAdminRequest(_request: Request, _jwtSecret: string): Promise<boolean> {
  return true;
}

async function addBlogToNews(db: any, title: string, title_ja: string | null, slug: string, publishedAt: string) {
  try {
    // 同じslugのニュースが既にあればスキップ
    const existing = await db.prepare(
      "SELECT id FROM news WHERE category = 'blog' AND content = ?"
    ).bind(slug).first();
    if (existing) return;

    await db.prepare(
      "INSERT INTO news (title, title_ja, content, content_ja, category, published_at) VALUES (?, ?, ?, ?, 'blog', ?)"
    ).bind(
      `New Blog: ${title}`,
      title_ja ? `新着ブログ: ${title_ja}` : null,
      slug,
      slug,
      publishedAt
    ).run();
  } catch {
    // news テーブルが存在しない場合は無視
  }
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

  // Single post fetch by id
  const singleId = url.searchParams.get('id');
  if (singleId) {
    try {
      const post = await db
        .prepare(
          `SELECT id, title, title_ja, slug, excerpt, city, thumbnail_url, content, content_ja, published_at FROM blog_posts WHERE id = ?`
        )
        .bind(singleId)
        .first();
      if (!post) {
        return new Response(JSON.stringify({ error: 'Blog post not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ post }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return new Response(JSON.stringify({ error: 'Failed to fetch blog post', details: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

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

    // 公開時にWhat's Newへ自動追加
    if (is_published && publishedAt) {
      const post = await db.prepare('SELECT title, title_ja, slug FROM blog_posts WHERE id = ?').bind(id).first();
      if (post) await addBlogToNews(db, post.title, post.title_ja, post.slug, publishedAt);
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

export const PATCH: APIRoute = async ({ request, locals }) => {
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

  const { id, title, title_ja, slug, excerpt, city, thumbnail_url, content, content_ja, published_at } = body;
  if (id === undefined) {
    return new Response(JSON.stringify({ error: 'Missing required field: id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const publishedAtValue = published_at === '' || published_at === undefined ? null : published_at;

  try {
    const result = await db
      .prepare(
        `UPDATE blog_posts
         SET title = ?, title_ja = ?, slug = ?, excerpt = ?, city = ?,
             thumbnail_url = ?, content = ?, content_ja = ?, published_at = ?
         WHERE id = ?`
      )
      .bind(title, title_ja, slug, excerpt, city, thumbnail_url, content, content_ja, publishedAtValue, id)
      .run();

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Blog post not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 公開日がセットされた場合、What's Newへ自動追加
    if (publishedAtValue) {
      await addBlogToNews(db, title, title_ja, slug, publishedAtValue);
    }

    return new Response(
      JSON.stringify({ message: 'Blog post updated', id }),
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

export const POST: APIRoute = async ({ request, locals }) => {
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

  const { title, title_ja, slug, excerpt, city, thumbnail_url, content, content_ja, published_at } = body;
  
  if (!title || !slug) {
    return new Response(JSON.stringify({ error: 'Missing required fields: title, slug' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const publishedAtValue = published_at === '' || published_at === undefined ? null : published_at;
  const created_at = new Date().toISOString();

  try {
    const result = await db
      .prepare(
        `INSERT INTO blog_posts (title, title_ja, slug, excerpt, city, thumbnail_url, content, content_ja, published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(title, title_ja || null, slug, excerpt || null, city || null, thumbnail_url || null, content || null, content_ja || null, publishedAtValue, created_at)
      .run();

    const newId = result.meta.last_row_id;

    // 公開日がセットされている場合、What's Newへ自動追加
    if (publishedAtValue) {
      await addBlogToNews(db, title, title_ja, slug, publishedAtValue);
    }

    return new Response(
      JSON.stringify({ message: 'Blog post created', id: newId }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Failed to create blog post', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
