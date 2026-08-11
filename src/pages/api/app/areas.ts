import type { APIRoute } from 'astro';

// Countries and cities we actually have listings in, for the app's
// browse-by-country UI. Cheap enough to serve straight from D1; cached at the
// edge because it only changes when inventory does.
export const GET: APIRoute = async ({ locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ countries: [] }), { status: 503 });

  try {
    const rows = await db
      .prepare(
        `SELECT country, city, COUNT(*) AS n
           FROM hotels
          WHERE status = 'active' AND COALESCE(city,'') != '' AND COALESCE(country,'') != ''
          GROUP BY country, city`
      )
      .all();

    const byCountry: Record<string, { country: string; hotels: number; cities: { city: string; hotels: number }[] }> = {};
    for (const r of (rows.results || []) as any[]) {
      const c = String(r.country);
      if (!byCountry[c]) byCountry[c] = { country: c, hotels: 0, cities: [] };
      byCountry[c].hotels += Number(r.n || 0);
      byCountry[c].cities.push({ city: String(r.city), hotels: Number(r.n || 0) });
    }
    const countries = Object.values(byCountry)
      .map((c) => ({ ...c, cities: c.cities.sort((a, b) => b.hotels - a.hotels) }))
      .sort((a, b) => b.hotels - a.hotels);

    return new Response(JSON.stringify({ countries }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ countries: [], error: e.message }), { status: 500 });
  }
};
