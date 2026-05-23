/**
 * Blog Automation Scheduled Worker (Phase 2)
 * Cloudflare Worker triggered by cron/schedule
 * Flow: Theme selection → Article generation (AI) → Image fetch/acquire → D1 save with metadata
 */

export interface Env {
  DB: D1Database;
  AI: Ai;
  IMAGES: R2Bucket;
  // Add other bindings as needed: RESEND etc.
}

interface BlogPost {
  id?: number;
  title: string;
  title_ja?: string;
  slug: string;
  excerpt?: string;
  city: string;
  thumbnail_url?: string;
  content?: string;
  content_ja?: string;
  published_at?: string;
  auto_generated?: number;
  favorite_theme?: string;
  selected_angle?: string;
  generation_status?: string;
  last_generated_at?: string;
  theme_source?: string;
  generation_prompt?: string;
  angle_rotation_index?: number;
}

// Scheduled entry point (called by Cloudflare Cron or external trigger)
export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log('[BlogAutomation] Scheduled run started at', new Date().toISOString());
    
    try {
      await runBlogAutomation(env);
      console.log('[BlogAutomation] Completed successfully');
    } catch (error) {
      console.error('[BlogAutomation] Fatal error:', error);
      // TODO: Send alert via email/webhook
    }
  },

  // Also support direct invocation for testing/manual trigger
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/trigger') {
      await runBlogAutomation(env);
      return new Response('Blog automation triggered manually', { status: 200 });
    }
    return new Response('Blog Automation Worker', { status: 200 });
  }
};

async function runBlogAutomation(env: Env): Promise<void> {
  const db = env.DB;
  
  // 1. Select target city/theme (rotation or pending)
  const target = await selectNextTarget(db);
  if (!target) {
    console.log('[BlogAutomation] No targets available for generation');
    return;
  }
  
  const { city, theme, angle, rotationIndex } = target;
  console.log(`[BlogAutomation] Target: city=${city}, theme=${theme}, angle=${angle}`);

  // 2. Duplicate prevention check
  const isDuplicate = await checkDuplicate(db, city, theme);
  if (isDuplicate) {
    console.log(`[BlogAutomation] Duplicate detected for ${city}/${theme}, skipping`);
    return;
  }

  try {
    // 3. Generate article content using AI
    const prompt = buildGenerationPrompt(city, theme, angle);
    const generated = await generateArticleWithAI(env.AI, prompt, city, theme);
    
    // Ensure unique slug
    generated.slug = await generateUniqueSlug(db, generated.slug);
    
    // 4. Acquire image (R2 lookup or placeholder generation)
    const imageUrl = await acquireImage(env, city, theme);
    
    // 5. Save to D1 with full metadata
    await saveBlogPost(db, {
      ...generated,
      city,
      thumbnail_url: imageUrl,
      auto_generated: 1,
      favorite_theme: theme,
      selected_angle: angle,
      generation_status: 'completed',
      last_generated_at: new Date().toISOString(),
      theme_source: 'ai',
      generation_prompt: prompt,
      angle_rotation_index: rotationIndex,
      published_at: new Date().toISOString(),
    });

    console.log(`[BlogAutomation] Successfully generated post for ${city}: ${generated.title}`);
    
    // TODO: Optional - trigger revalidation or notify admin
    
  } catch (error) {
    console.error(`[BlogAutomation] Generation failed for ${city}:`, error);
    await logGenerationError(db, city, theme, error);
    // Mark as failed in DB if needed
  }
}

async function selectNextTarget(db: D1Database) {
  // Predefined supported cities for automation (overseas only; Japanese cities excluded per updated rule)
  const supportedCities = ['bangkok', 'singapore', 'kuala-lumpur', 'bali', 'jakarta', 'ho-chi-minh', 'hanoi', 'phnom-penh', 'chiang-mai', 'penang'];
  
  // Try to find a city with recent activity or pending status
  const result = await db.prepare(`
    SELECT city, favorite_theme as theme, angle_rotation_index
    FROM blog_posts 
    WHERE (auto_generated = 1 OR generation_status IN ('pending', 'manual'))
      AND city IN ('bangkok','singapore','kuala-lumpur','bali','jakarta','ho-chi-minh','hanoi','phnom-penh','chiang-mai','penang')
    ORDER BY last_generated_at ASC NULLS FIRST
    LIMIT 1
  `).first<{ city: string; theme: string; angle_rotation_index: number }>();
  
  if (result) {
    const angles = ['local-insight', 'traveler-perspective', 'food-focused', 'budget-tips'];
    const angle = angles[(result.angle_rotation_index || 0) % angles.length];
    return {
      city: result.city,
      theme: result.theme || 'hidden-gems',
      angle,
      rotationIndex: (result.angle_rotation_index || 0) + 1
    };
  }
  
  // Fallback: rotate through supported cities (simple round-robin via timestamp hash)
  const idx = Math.floor(Date.now() / (1000 * 60 * 60 * 24)) % supportedCities.length;
  return {
    city: supportedCities[idx],
    theme: 'hidden-gems',
    angle: 'traveler-perspective',
    rotationIndex: 0
  };
}

async function checkDuplicate(db: D1Database, city: string, theme: string): Promise<boolean> {
  const recent = await db.prepare(`
    SELECT COUNT(*) as count FROM blog_posts 
    WHERE city = ? AND favorite_theme = ? 
      AND auto_generated = 1 
      AND published_at > datetime('now', '-30 days')
  `).bind(city, theme).first<{ count: number }>();
  
  return (recent?.count || 0) > 0;
}

async function generateUniqueSlug(db: D1Database, baseSlug: string): Promise<string> {
  let slug = baseSlug;
  let suffix = 1;
  while (true) {
    const exists = await db.prepare('SELECT 1 FROM blog_posts WHERE slug = ?').bind(slug).first();
    if (!exists) return slug;
    slug = `${baseSlug}-${suffix++}`;
  }
}

function buildGenerationPrompt(city: string, theme: string, angle: string): string {
  return `Write a compelling travel blog post about ${city} focusing on the theme "${theme}" from a ${angle} angle. 
Include practical tips, unique insights, and engaging storytelling. 800-1200 words.
Strictly output ONLY valid JSON (no markdown): { "title": "...", "title_ja": "...", "excerpt": "...", "content": "..." }`;
}

async function generateArticleWithAI(ai: Ai, prompt: string, city: string, theme: string) {
  // Use @cf/meta/llama-3-8b-instruct or similar available model via CF AI binding
  const response = await ai.run('@cf/meta/llama-3-8b-instruct', {
    prompt,
    max_tokens: 2500,
  });
  
  // Parse or fallback
  let parsed: any = {};
  const raw = (response as any).response || '';
  try {
    // Attempt to extract JSON if wrapped in markdown or extra text
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
  } catch {
    parsed = {
      title: `${theme.replace('-', ' ')} in ${city}`,
      title_ja: null,
      excerpt: `Discover the best of ${city} with focus on ${theme}.`,
      content: raw || 'Content generation failed. Please check logs.'
    };
  }
  
  return {
    title: parsed.title || `${theme} in ${city}`,
    title_ja: parsed.title_ja || null,
    slug: `${city}-${theme}-${Date.now()}`.toLowerCase().replace(/\s+/g, '-'),
    excerpt: parsed.excerpt || `Explore ${city} through ${theme}.`,
    content: parsed.content || raw,
    content_ja: parsed.content_ja || null,
  };
}

async function acquireImage(env: Env, city: string, theme: string): Promise<string> {
  // R2 images not publicly routable without custom domain; use deterministic public placeholder
  // Root cause of #11: returned internal path `/images/blog/...` which 404s on /ja/blog
  return `https://picsum.photos/seed/${encodeURIComponent(city)}-${encodeURIComponent(theme)}/800/600`;
}

async function saveBlogPost(db: D1Database, post: BlogPost): Promise<void> {
  const stmt = db.prepare(`
    INSERT INTO blog_posts (
      title, title_ja, slug, excerpt, city, thumbnail_url, 
      content, content_ja, published_at, auto_generated, 
      favorite_theme, selected_angle, generation_status, 
      last_generated_at, theme_source, generation_prompt, angle_rotation_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  await stmt.bind(
    post.title, post.title_ja, post.slug, post.excerpt, post.city, post.thumbnail_url,
    post.content, post.content_ja, post.published_at, post.auto_generated,
    post.favorite_theme, post.selected_angle, post.generation_status,
    post.last_generated_at, post.theme_source, post.generation_prompt, post.angle_rotation_index
  ).run();
}

async function logGenerationError(db: D1Database, city: string, theme: string, error: any): Promise<void> {
  // Could create error_log table or just console + future alert
  console.error(`[BlogAutomation][ERROR] city=${city} theme=${theme}`, error.message || error);
  // TODO: INSERT INTO automation_logs ...
}
