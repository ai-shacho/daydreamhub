import type { APIRoute } from 'astro';
import { AIRPORTS } from '../../../lib/data/airportsData';
import { airportNames, airportNamesJa, airportByCity, haversineKm } from '../../../lib/airports';
import { getExchangeRates } from '../../../lib/tools';

// Mobile-app search endpoint: given user coordinates (?lat&lng) or a free-text /
// voice query (?q), return active hotels sorted by distance with price and
// open-now information. Used by /app (PWA).

// Japanese city aliases → English city/airport keys used across the site data.
const JA_CITY_ALIASES: Record<string, string> = {
  '東京': 'Tokyo', '渋谷': 'Shibuya', '京都': 'Kyoto',
  'バンコク': 'Bangkok', 'シンガポール': 'Singapore', 'ソウル': 'Seoul',
  '香港': 'Hong Kong', '台北': 'Taipei', 'ドバイ': 'Dubai',
  'クアラルンプール': 'Kuala Lumpur', 'ジャカルタ': 'Jakarta', 'バリ': 'Bali',
  'マニラ': 'Manila', 'セブ': 'Cebu City', 'ホーチミン': 'Ho Chi Minh City',
  'ハノイ': 'Hanoi', 'ダナン': 'Da Nang', 'プーケット': 'Phuket',
  'サムイ': 'Koh Samui', 'プノンペン': 'Phnom Penh', '上海': 'Shanghai',
  '北京': 'Beijing', 'デリー': 'Delhi', 'ムンバイ': 'Mumbai',
  'ドーハ': 'Doha', 'カイロ': 'Cairo', 'ナイロビ': 'Nairobi',
  'ロンドン': 'London', 'パリ': 'Paris', 'アムステルダム': 'Amsterdam',
  'プラハ': 'Prague', 'ポルト': 'Porto', 'バレンシア': 'Valencia',
  'ニューヨーク': 'New York', 'ロサンゼルス': 'Los Angeles',
  'シドニー': 'Sydney', 'メルボルン': 'Melbourne', 'オークランド': 'Auckland',
  'トビリシ': 'Tbilisi', 'タシケント': 'Tashkent', 'アルマティ': 'Almaty',
};

// Words that carry no place information in a voice query.
const NOISE_RE = /(の近く|の周辺|周辺|付近|近く|辺り|あたり|で休憩|休憩できる|休憩|デイユース|ホテル|を?探して|探す|教えて|したい|できる|お願いします?|near|nearby|around|close to|day ?use|hotels?|rest|find|me|please|at|in|the)/gi;

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s　、。,.！!？?]/g, '');
}

// Resolve a free-text query to coordinates: airport code, airport name (EN/JA),
// then city name (EN key or JA alias). Longest match wins to avoid false hits.
function resolveQueryToCoords(raw: string): { lat: number; lng: number; label: string } | null {
  const q = norm(raw.replace(NOISE_RE, ' '));
  if (!q) return null;

  const airportByCode = new Map(AIRPORTS.map((a) => [a[0], a]));

  // Exact IATA code ("HND", "kix")
  const codeMatch = raw.toUpperCase().match(/\b([A-Z]{3})\b/);
  if (codeMatch && airportByCode.has(codeMatch[1])) {
    const a = airportByCode.get(codeMatch[1])!;
    return { lat: a[2], lng: a[3], label: airportNamesJa[a[0]] || airportNames[a[0]] || a[1] };
  }

  type Cand = { key: string; lat: number; lng: number; label: string };
  const cands: Cand[] = [];

  for (const [code, ja] of Object.entries(airportNamesJa)) {
    const a = airportByCode.get(code);
    if (!a) continue;
    const stripped = ja.replace(/国際空港|空港/g, '');
    cands.push({ key: norm(stripped), lat: a[2], lng: a[3], label: ja });
  }
  for (const [code, en] of Object.entries(airportNames)) {
    const a = airportByCode.get(code);
    if (!a) continue;
    const stripped = en.replace(/International Airport|Airport/gi, '');
    cands.push({ key: norm(stripped), lat: a[2], lng: a[3], label: en });
  }
  // Full airport dataset names ("Narita International Airport" etc.)
  for (const a of AIRPORTS) {
    const stripped = a[1].replace(/International Airport|Airport/gi, '');
    if (stripped.length >= 4) cands.push({ key: norm(stripped), lat: a[2], lng: a[3], label: a[1] });
  }
  for (const [ja, en] of Object.entries(JA_CITY_ALIASES)) {
    const coords = airportByCity[en];
    if (coords) cands.push({ key: norm(ja), lat: coords[0], lng: coords[1], label: en });
  }
  for (const [city, coords] of Object.entries(airportByCity)) {
    cands.push({ key: norm(city), lat: coords[0], lng: coords[1], label: city });
  }

  let best: Cand | null = null;
  for (const c of cands) {
    if (c.key.length < 2) continue;
    if (q.includes(c.key) || (c.key.length >= 4 && c.key.includes(q) && q.length >= 3)) {
      if (!best || c.key.length > best.key.length) best = c;
    }
  }
  return best ? { lat: best.lat, lng: best.lng, label: best.label } : null;
}

// Signals that a query carries intent beyond a bare place name (budget,
// urgency) and is worth an extra Workers AI round-trip to interpret.
const INTENT_RE = /[0-9０-９]|[$￥¥]|ドル|円|予算|以内|以下|まで|安[いく]|cheap|budget|under|営業中|今すぐ|いますぐ|open now|right now/i;

// Deterministic budget extraction — preferred over the LLM's numbers, which
// sometimes arrive silently currency-converted despite instructions.
const OPEN_NOW_RE = /今すぐ|いますぐ|営業中|open now|right now/i;

async function toUsd(env: any, amount: number, currency: string): Promise<number | null> {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (currency === 'USD') return Math.round(amount);
  try {
    const rates = await getExchangeRates(env.DB);
    if (rates?.[currency]) return Math.round(amount / rates[currency]);
  } catch {
    // no rate available — drop the budget rather than guess
  }
  return null;
}

function parseBudgetFromText(q: string): { amount: number; currency: string } | null {
  let m = q.match(/(\d[\d,]*)\s*円/);
  if (m) return { amount: Number(m[1].replace(/,/g, '')), currency: 'JPY' };
  m = q.match(/[$＄]\s*(\d[\d,]*)/) || q.match(/(\d[\d,]*)\s*(?:ドル|dollars?|usd|bucks)/i);
  if (m) return { amount: Number(m[1].replace(/,/g, '')), currency: 'USD' };
  m = q.match(/(\d[\d,]*)\s*(?:ユーロ|euros?|eur)/i);
  if (m) return { amount: Number(m[1].replace(/,/g, '')), currency: 'EUR' };
  return null;
}

// Extract structured intent from a natural-language voice query. Best-effort:
// any failure returns null and the caller falls back to the plain resolvers.
async function extractIntent(
  env: any,
  q: string
): Promise<{ place: string | null; budgetUsd: number | null; openNow: boolean } | null> {
  if (!env?.AI) return null;
  const sys =
    'You extract search intent from day-use hotel queries (Japanese or English). ' +
    'Reply with ONLY a JSON object, no prose: ' +
    '{"place": string|null (location/airport/city mentioned, keep original language), ' +
    '"budget": number|null (max budget as stated, NO currency conversion), ' +
    '"currency": string|null (ISO code of the stated budget, e.g. "USD", "JPY"), ' +
    '"open_now": boolean (true if they want somewhere usable right now)}';
  const models = ['@cf/meta/llama-3.1-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.1'];
  for (const model of models) {
    try {
      const r = await env.AI.run(model, {
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: q.slice(0, 200) },
        ],
        max_tokens: 120,
      });
      const text = r?.response || r?.result?.response || '';
      const m = text.match(/\{[\s\S]*?\}/);
      if (!m) continue;
      const j = JSON.parse(m[0]);
      // Budget: trust the regex over the LLM (observed the model converting
      // currency on its own despite instructions), then convert to USD with
      // real rates.
      const fromText = parseBudgetFromText(q);
      const amount = fromText ? fromText.amount : Number(j.budget);
      const cur = fromText
        ? fromText.currency
        : typeof j.currency === 'string' ? j.currency.toUpperCase() : 'USD';
      return {
        place: typeof j.place === 'string' && j.place.trim() ? j.place.trim() : null,
        budgetUsd: await toUsd(env, amount, cur),
        openNow: j.open_now === true || OPEN_NOW_RE.test(q),
      };
    } catch {
      // try next model
    }
  }
  return null;
}

// Hotel names in the DB sometimes contain HTML entities ("SPA&amp;Wellness");
// decode them so clients that escape for display don't double-escape.
function decodeEntities(s: string | null): string | null {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Approximate the hotel's local time from its longitude (15° ≈ 1 hour). Good
// enough to badge "open now" without a per-hotel timezone column.
function isOpenNow(lng: number, checkIn: string | null, checkOut: string | null): boolean | null {
  if (!checkIn || !checkOut) return null;
  const utc = new Date();
  const localMinutes =
    ((utc.getUTCHours() + Math.round(lng / 15)) * 60 + utc.getUTCMinutes() + 24 * 60) % (24 * 60);
  const toMin = (t: string) => {
    const m = t.match(/^(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
  };
  const start = toMin(checkIn);
  const end = toMin(checkOut);
  if (start === null || end === null) return null;
  return start <= end
    ? localMinutes >= start && localMinutes < end
    : localMinutes >= start || localMinutes < end; // overnight window
}

export const GET: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lng = parseFloat(url.searchParams.get('lng') || '');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 120);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '12'), 30);

  let center: { lat: number; lng: number; label: string } | null = null;
  let mode: 'geo' | 'place' | 'ip' | 'text' = 'text';
  let intent: { place: string | null; budgetUsd: number | null; openNow: boolean } | null = null;

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    center = { lat, lng, label: '' };
    mode = 'geo';
  } else if (q) {
    center = resolveQueryToCoords(q);
    // Bare place names skip the AI round-trip; richer queries ("予算50ドルで
    // 今すぐ") get interpreted, which can also rescue an unresolved place.
    if (!center || INTENT_RE.test(q)) {
      const env = (locals as any).runtime?.env;
      intent = await extractIntent(env, q);
      if (!intent) {
        // LLM output is flaky — budget and urgency are still recoverable
        // deterministically, only the fuzzy place rescue is lost.
        const fromText = parseBudgetFromText(q);
        const openNow = OPEN_NOW_RE.test(q);
        if (fromText || openNow) {
          intent = {
            place: null,
            budgetUsd: fromText ? await toUsd(env, fromText.amount, fromText.currency) : null,
            openNow,
          };
        }
      }
      if (!center && intent?.place) center = resolveQueryToCoords(intent.place);
    }
    if (center) {
      mode = 'place';
    } else {
      // Unknown place name (any language) — fall back to Google geocoding,
      // same key the site's /api/geocode uses.
      const apiKey = (locals as any).runtime?.env?.GOOGLE_PLACES_API_KEY;
      if (apiKey) {
        try {
          const res = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(intent?.place || q)}&key=${apiKey}`
          );
          const data = (await res.json()) as any;
          const loc = data?.results?.[0]?.geometry?.location;
          if (data?.status === 'OK' && loc) {
            center = { lat: loc.lat, lng: loc.lng, label: data.results[0].formatted_address || q };
            mode = 'place';
          }
        } catch {
          // geocoding is best-effort; text search below still answers
        }
      }
    }
  } else {
    // No query at all — use Cloudflare's IP geolocation so the app can show
    // nearby results the moment it opens, before any permission prompt.
    const cf = (locals as any).runtime?.cf || (request as any).cf;
    const cfLat = parseFloat(cf?.latitude);
    const cfLng = parseFloat(cf?.longitude);
    if (Number.isFinite(cfLat) && Number.isFinite(cfLng)) {
      center = { lat: cfLat, lng: cfLng, label: cf?.city || '' };
      mode = 'ip';
    }
  }

  if (!center && !q) {
    return new Response(JSON.stringify({ mode: 'text', center: null, hotels: [] }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  try {
    let rows: any[];
    if (center) {
      const result = await db
        .prepare(
          `SELECT h.id, h.name, h.name_ja, h.slug, h.city, h.country, h.thumbnail_url,
                  h.latitude, h.longitude,
                  MIN(p.price_usd) AS min_price,
                  MIN(p.check_in_time) AS check_in, MAX(p.check_out_time) AS check_out
           FROM hotels h
           LEFT JOIN plans p ON p.hotel_id = h.id AND p.is_active = 1
           WHERE h.status = 'active' AND h.latitude IS NOT NULL AND h.longitude IS NOT NULL
           GROUP BY h.id`
        )
        .all();
      rows = (result?.results || [])
        .map((h: any) => ({
          ...h,
          km: Math.round(haversineKm(center!.lat, center!.lng, h.latitude, h.longitude) * 10) / 10,
        }))
        .sort((a: any, b: any) => a.km - b.km)
        .slice(0, limit);
    } else {
      // No coordinates resolvable — plain text search over names and cities.
      const like = `%${q}%`;
      const result = await db
        .prepare(
          `SELECT h.id, h.name, h.name_ja, h.slug, h.city, h.country, h.thumbnail_url,
                  h.latitude, h.longitude,
                  MIN(p.price_usd) AS min_price,
                  MIN(p.check_in_time) AS check_in, MAX(p.check_out_time) AS check_out
           FROM hotels h
           LEFT JOIN plans p ON p.hotel_id = h.id AND p.is_active = 1
           WHERE h.status = 'active'
             AND (h.name LIKE ? OR h.name_ja LIKE ? OR h.city LIKE ? OR h.country LIKE ?)
           GROUP BY h.id
           ORDER BY h.name ASC
           LIMIT ?`
        )
        .bind(like, like, like, like, limit)
        .all();
      rows = (result?.results || []).map((h: any) => ({ ...h, km: null }));
    }

    const hotels = rows.map((h: any) => ({
      id: h.id,
      name: decodeEntities(h.name),
      nameJa: decodeEntities(h.name_ja) || null,
      slug: h.slug,
      city: h.city,
      country: h.country,
      thumbnail: h.thumbnail_url || null,
      lat: h.latitude ?? null,
      lng: h.longitude ?? null,
      km: h.km,
      minPrice: h.min_price ?? null,
      checkIn: h.check_in || null,
      checkOut: h.check_out || null,
      openNow:
        h.latitude != null && h.longitude != null
          ? isOpenNow(h.longitude, h.check_in, h.check_out)
          : null,
    }));

    return new Response(JSON.stringify({
      mode,
      center,
      intent: intent && (intent.budgetUsd || intent.openNow)
        ? { budgetUsd: intent.budgetUsd, openNow: intent.openNow }
        : null,
      hotels,
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Search failed', details: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
