import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  const siteUrl = 'https://www.daydreamhub.com';

  // 静的ページ
  const staticPages = [
    { url: '/', priority: '1.0', changefreq: 'daily' },
    { url: '/search', priority: '0.9', changefreq: 'daily' },
    { url: '/blog', priority: '0.8', changefreq: 'weekly' },
    { url: '/how-it-works', priority: '0.7', changefreq: 'monthly' },
    { url: '/contact', priority: '0.5', changefreq: 'monthly' },
    { url: '/faq', priority: '0.6', changefreq: 'monthly' },
  ];

  // 動的ページ（ホテル）
  let hotelPages: any[] = [];
  if (db) {
    try {
      const result = await db.prepare(
        "SELECT slug, updated_at FROM hotels WHERE is_active=1 AND slug IS NOT NULL AND slug != ''"
      ).all();
      hotelPages = result?.results || [];
    } catch {}
  }

  // ブログ記事
  let blogPages: any[] = [];
  if (db) {
    try {
      const result = await db.prepare(
        "SELECT slug, updated_at FROM blog_posts ORDER BY published_at DESC"
      ).all();
      blogPages = result?.results || [];
    } catch {}
  }

  const now = new Date().toISOString().split('T')[0];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticPages.map(p => `  <url>
    <loc>${siteUrl}${p.url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
${hotelPages.map((h: any) => `  <url>
    <loc>${siteUrl}/hotel/${h.slug}</loc>
    <lastmod>${h.updated_at ? h.updated_at.split('T')[0] : now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n')}
${blogPages.map((b: any) => `  <url>
    <loc>${siteUrl}/blog/${b.slug}</loc>
    <lastmod>${b.updated_at ? b.updated_at.split('T')[0] : now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
