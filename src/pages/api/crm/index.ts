import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals, url }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  const format = url.searchParams.get('format');
  const progress = url.searchParams.get('progress');

  let query = 'SELECT * FROM crm_leads';
  const params: any[] = [];

  if (progress) {
    query += ' WHERE progress = ?';
    params.push(progress);
  }
  query += ' ORDER BY last_updated DESC';

  const result = params.length > 0
    ? await db.prepare(query).bind(...params).all()
    : await db.prepare(query).all();

  const leads = result?.results || [];

  if (format === 'csv') {
    // CSV export
    const headers = Object.keys(leads[0] || {});
    const csvRows = [
      headers.join(','),
      ...leads.map((lead: any) => headers.map(h => JSON.stringify(lead[h] ?? '')).join(','))
    ];
    return new Response(csvRows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="crm_leads.csv"'
      },
    });
  }

  return new Response(JSON.stringify({ leads }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
