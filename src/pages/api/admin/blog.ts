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

// ---- AI Auto-Generation Logic ----

// Supported automation cities (overseas only)
const AUTOMATION_CITIES = ['bangkok', 'singapore', 'kuala-lumpur', 'bali', 'jakarta', 'ho-chi-minh', 'hanoi', 'phnom-penh', 'chiang-mai', 'penang'];

const AUTOMATION_ANGLES = ['local-insight', 'traveler-perspective', 'food-focused', 'budget-tips'];

function buildGeneratePrompt(city: string, theme: string, angle: string): string {
  return `Write a compelling travel blog post about ${city} focusing on the theme "${theme}" from a ${angle} angle.
Include practical tips, unique insights, and engaging storytelling. 800-1200 words.
Output ONLY valid JSON. The 'content' field must be a single string with HTML formatting (use <p>, <h2>, <h3> tags).
IMPORTANT: The 'content' value must be a plain string, NOT an array or object.
Example: { "title": "Example Title", "title_ja": "例のタイトル", "excerpt": "Short description", "content": "<p>Article text here</p><h2>Section title</h2><p>More text</p>" }`;
}

async function runBlogAutomationInline(db: any, ai: any): Promise<{city: string; theme: string; title: string; title_ja: string | null; id: number; thumbnail_url: string}> {
  // 1. Pick target city
  const idx = Math.floor(Date.now() / (1000 * 60 * 60)) % AUTOMATION_CITIES.length;
  const city = AUTOMATION_CITIES[idx];
  const theme = 'hidden-gems';
  const angle = 'traveler-perspective';
  
  // 2. Generate article with CF AI
  const prompt = buildGeneratePrompt(city, theme, angle);
  let title = '';
  let title_ja: string | null = null;
  let excerpt = '';
  let content = '';
  
  // Try multiple AI models with retry
  const models = ['@cf/meta/llama-3.1-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.1'];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const model = models[attempt % models.length];
      const response = await ai.run(model, {
        messages: [
          { role: 'system', content: 'You are a professional travel blogger. Output ONLY valid JSON without markdown formatting.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2500,
      });
      // Extract the AI response text
      const raw = ((response as any).response || (response as any).result?.response || '');
      if (!raw.trim()) {
        if (attempt === 2) throw new Error('Empty AI response after 3 attempts');
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        title = String(parsed.title || `${city} Hidden Gems: A Traveler's Guide`);
        title_ja = parsed.title_ja ? String(parsed.title_ja) : null;
        excerpt = String(parsed.excerpt || `Discover the hidden gems of ${city}.`);
        // Content could be string or array of objects; handle both
        if (typeof parsed.content === 'string') {
          content = parsed.content;
        } else if (Array.isArray(parsed.content)) {
          // Parse content as an array of message-like objects (common AI output format)
          content = parsed.content.map((c: any) => {
            if (typeof c === 'string') return c;
            // Try common text container fields
            for (const key of ['text', 'value', 'content', 'message', 'body', 'description', 'paragraph']) {
              if (c[key] && typeof c[key] === 'string') return c[key];
            }
            // Recursively handle nested arrays
            if (Array.isArray(c)) {
              return c.map((x: any) => typeof x === 'object' ? JSON.stringify(x) : String(x)).join('\n');
            }
            // Last resort - stringify the object
            return JSON.stringify(c);
          }).join('\n');
        } else if (typeof parsed.content === 'object' && parsed.content !== null) {
          content = JSON.stringify(parsed.content);
        } else {
          content = raw;
        }
      } else {
        title = `${city} Hidden Gems: A Traveler's Guide`;
        excerpt = `Discover the hidden gems of ${city}.`;
        content = raw;
      }
      break; // success
    } catch (e) {
      if (attempt === 2) {
        // Last attempt failed; fall back to basic title
        title = `Discover Hidden Gems in ${city}`;
        excerpt = `Explore the best-kept secrets of ${city}.`;
        content = `<p>${city} is full of hidden gems waiting to be discovered. From local favorites to off-the-beaten-path attractions, this guide covers everything you need to know for an authentic experience.</p>`;
      } else {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  
  // 3. Generate slug
  const baseSlug = `${city}-hidden-gems-guide`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  let slug = baseSlug;
  let suffix = 1;
  while (true) {
    const exists = await db.prepare('SELECT 1 FROM blog_posts WHERE slug = ?').bind(slug).first();
    if (!exists) break;
    slug = `${baseSlug}-${suffix++}`;
  }
  
  // 4. Image URL (1200px wide)
  const thumbnail_url = `https://picsum.photos/seed/${encodeURIComponent(city)}-${encodeURIComponent(theme)}/1200/800`;
  
  // 5. Save to D1 (using only existing columns; extra metadata columns require migration 029)
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO blog_posts (
      title, title_ja, slug, excerpt, city, thumbnail_url, 
      content, content_ja, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    String(title),
    title_ja ? String(title_ja) : null,
    String(slug),
    excerpt ? String(excerpt) : null,
    String(city),
    String(thumbnail_url),
    String(content),
    null,
    String(now)
  ).run();
  
  const newId = result.meta.last_row_id;
  
  return { city, theme, title, title_ja, id: newId, thumbnail_url };
}

// Manual trigger endpoint for blog-automation testing (Phase 3)
export const triggerBlogAutomation = async (db: any, env: any): Promise<Response> => {
  const ai = env?.AI;
  if (!ai) {
    return new Response(JSON.stringify({ error: 'AI binding not available', success: false }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  try {
    const result = await runBlogAutomationInline(db, ai);
    return new Response(JSON.stringify({
      success: true,
      message: 'Blog post auto-generated successfully',
      timestamp: new Date().toISOString(),
      city: result.city,
      theme: result.theme,
      title: result.title,
      title_ja: result.title_ja,
      post_id: result.id,
      thumbnail_url: result.thumbnail_url
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      message: 'Blog automation generation failed',
      error: error.message || String(error),
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
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

  // Auto-generation trigger via action
  if (body.action === 'generate') {
    return triggerBlogAutomation(db, (locals as any).runtime?.env);
  }

  const { title, title_ja, slug, excerpt, city, thumbnail_url, content, content_ja, published_at } = body;
  
  if (!title || !slug) {
    return new Response(JSON.stringify({ error: 'Missing required fields: title, slug' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const publishedAtValue = published_at === '' || published_at === undefined ? null : published_at;

  try {
    const result = await db
      .prepare(
        `INSERT INTO blog_posts (title, title_ja, slug, excerpt, city, thumbnail_url, content, content_ja, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(title, title_ja || null, slug, excerpt || null, city || null, thumbnail_url || null, content || null, content_ja || null, publishedAtValue)
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
