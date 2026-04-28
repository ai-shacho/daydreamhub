import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  const siteUrl = 'https://www.daydreamhub.com';

  // 静的ページ（EN）
  const staticPages = [
    { url: '/', priority: '1.0', changefreq: 'daily' },
    { url: '/search', priority: '0.9', changefreq: 'daily' },
    { url: '/blog', priority: '0.8', changefreq: 'weekly' },
    { url: '/how-it-works', priority: '0.7', changefreq: 'monthly' },
    { url: '/contact', priority: '0.5', changefreq: 'monthly' },
    { url: '/faq', priority: '0.6', changefreq: 'monthly' },
  ];

  // 静的ページ（JA）
  const staticJaPages = [
    { url: '/ja/', priority: '0.9', changefreq: 'daily' },
    { url: '/ja/search', priority: '0.8', changefreq: 'daily' },
    { url: '/ja/blog', priority: '0.7', changefreq: 'weekly' },
  ];

  // 動的ページ（ホテル）※ updated_at カラムは存在しないため除外
  let hotelPages: any[] = [];
  if (db) {
    try {
      const result = await db.prepare(
        "SELECT slug FROM hotels WHERE status='active' AND slug IS NOT NULL AND slug != ''"
      ).all();
      hotelPages = result?.results || [];
    } catch(e) { console.error('sitemap hotel query error:', e); }
  }

  // ブログ記事 ※ published_at を lastmod に使用
  let blogPages: any[] = [];
  if (db) {
    try {
      const result = await db.prepare(
        "SELECT slug, published_at FROM blog_posts ORDER BY published_at DESC"
      ).all();
      blogPages = result?.results || [];
    } catch(e) { console.error('sitemap blog query error:', e); }
  }

  // 都市ページ
  let cityPages: any[] = [];
  if (db) {
    try {
      const result = await db.prepare(
        "SELECT DISTINCT REPLACE(REPLACE(LOWER(city), ' ', '-'), '_', '-') as city_slug FROM hotels WHERE status='active' AND city IS NOT NULL AND city != ''"
      ).all();
      cityPages = result?.results || [];
    } catch(e) { console.error('sitemap city query error:', e); }
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
${staticJaPages.map(p => `  <url>
    <loc>${siteUrl}${p.url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
${hotelPages.map((h: any) => `  <url>
    <loc>${siteUrl}/hotel/${h.slug}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n')}
${hotelPages.map((h: any) => `  <url>
    <loc>${siteUrl}/ja/hotel/${h.slug}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n')}
${blogPages.map((b: any) => `  <url>
    <loc>${siteUrl}/blog/${b.slug}</loc>
    <lastmod>${b.published_at ? b.published_at.split(' ')[0] : now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n')}
${blogPages.map((b: any) => `  <url>
    <loc>${siteUrl}/ja/blog/${b.slug}</loc>
    <lastmod>${b.published_at ? b.published_at.split(' ')[0] : now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>`).join('\n')}
${cityPages.map((c: any) => `  <url>
    <loc>${siteUrl}/city/${c.city_slug}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
