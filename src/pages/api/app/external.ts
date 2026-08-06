import type { APIRoute } from 'astro';
import { searchHotelsExternal } from '../../../lib/tools';
import { haversineKm } from '../../../lib/airports';

// Unlisted (non-DDH) hotels near a place, for the app's merged results.
// Straight Google Places text search — no LLM in the loop — with a short
// per-isolate cache so repeated searches for the same city are free.

const cache = new Map<string, { at: number; hotels: any[] }>();
const CACHE_TTL = 10 * 60 * 1000;

const rateLimit = new Map<string, { count: number; resetAt: number }>();
const RL_WINDOW = 60_000;
const RL_MAX = 10;

export const GET: APIRoute = async ({ request, locals }) => {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (entry && now < entry.resetAt) {
    entry.count++;
    if (entry.count > RL_MAX) {
      return new Response(JSON.stringify({ hotels: [] }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    rateLimit.set(ip, { count: 1, resetAt: now + RL_WINDOW });
  }

  const env = (locals as any).runtime?.env;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lng = parseFloat(url.searchParams.get('lng') || '');
  if (!q) {
    return new Response(JSON.stringify({ hotels: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = q.toLowerCase();
  const cached = cache.get(key);
  let hotels: any[];
  if (cached && now - cached.at < CACHE_TTL) {
    hotels = cached.hotels;
  } else {
    try {
      const res = await searchHotelsExternal(env, {
        query: `day use hotel ${q}`,
        location: q,
        language: 'en',
        maxPages: 1,
      });
      hotels = ((res?.hotels || []) as any[])
        .filter((h) => h.name && h.phone)
        .slice(0, 5);
      cache.set(key, { at: now, hotels });
    } catch {
      hotels = [];
    }
  }

  const withKm = hotels.map((h) => ({
    ...h,
    km:
      Number.isFinite(lat) && Number.isFinite(lng) && h.lat != null && h.lng != null
        ? Math.round(haversineKm(lat, lng, h.lat, h.lng) * 10) / 10
        : null,
  }));

  return new Response(JSON.stringify({ hotels: withKm }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
