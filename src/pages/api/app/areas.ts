import type { APIRoute } from 'astro';
import {
  REGION_JA,
  REGION_IMAGES,
  regionOrder,
  cityRegionOverride,
  getRegionForCountry,
  getCityImage,
} from '../../../lib/geo';
import { geoNameJa } from '../../../lib/geoJa';

// Region → country → city tree of everywhere we actually have listings, with
// photos and counts, for the app's browse-by-area cards. Mirrors the website's
// drill-down and shares its reference data (src/lib/geo.ts).
export const GET: APIRoute = async ({ locals, url }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ regions: [] }), { status: 503 });
  const isJa = url.searchParams.get('lang') === 'ja';
  const label = (n: string) => (isJa ? geoNameJa(n) : n);

  try {
    const rows = await db
      .prepare(
        `SELECT country, city, COUNT(*) AS n
           FROM hotels
          WHERE status = 'active' AND COALESCE(city,'') != '' AND COALESCE(country,'') != ''
          GROUP BY country, city`
      )
      .all();

    type City = { city: string; label: string; image: string; hotels: number };
    type Country = { country: string; label: string; image: string; hotels: number; cities: City[] };
    const regions: Record<string, Record<string, Country>> = {};

    for (const r of (rows.results || []) as any[]) {
      const country = String(r.country);
      const city = String(r.city);
      const region = cityRegionOverride[city] || getRegionForCountry(country) || 'Other';
      if (!regions[region]) regions[region] = {};
      if (!regions[region][country]) {
        regions[region][country] = {
          country,
          label: label(country),
          image: getCityImage(city),
          hotels: 0,
          cities: [],
        };
      }
      const c = regions[region][country];
      c.hotels += Number(r.n || 0);
      c.cities.push({ city, label: label(city), image: getCityImage(city), hotels: Number(r.n || 0) });
    }

    const ordered = [...regionOrder, ...Object.keys(regions).filter((r) => !regionOrder.includes(r))];
    const out = ordered
      .filter((r) => regions[r])
      .map((r) => {
        const countries = Object.values(regions[r])
          .map((c) => ({ ...c, cities: c.cities.sort((a, b) => b.hotels - a.hotels) }))
          .sort((a, b) => b.hotels - a.hotels);
        return {
          region: r,
          label: isJa ? REGION_JA[r] || r : r,
          image: REGION_IMAGES[r] || REGION_IMAGES.Asia,
          hotels: countries.reduce((s, c) => s + c.hotels, 0),
          countryCount: countries.length,
          countries,
        };
      })
      .filter((r) => r.hotels > 0);

    return new Response(JSON.stringify({ regions: out }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ regions: [], error: e.message }), { status: 500 });
  }
};
