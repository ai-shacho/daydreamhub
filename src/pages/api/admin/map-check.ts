import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/apiAuth';

// Haversine distance in meters
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Detect if the "name" looks like an actual property name (vs just a room type)
const PROPERTY_KEYWORDS = [
  'hotel', 'inn', 'resort', 'hostel', 'lodge', 'villa', 'apartment', 'apartments',
  'ryokan', 'guesthouse', 'guest house', 'motel', 'b&b', 'bed and breakfast',
  'residence', 'suites hotel', 'hostal', 'pension', 'pensione', 'house',
  'palace', 'manor', 'chateau', 'château', 'mansion', 'castle',
];
function looksLikePropertyName(name: string): boolean {
  const lower = name.toLowerCase();
  return PROPERTY_KEYWORDS.some((kw) => lower.includes(kw));
}

// Extract a component from Google address_components by type
function getAddressComponent(components: any[], type: string): string {
  return components?.find((c: any) => c.types.includes(type))?.long_name?.toLowerCase() || '';
}

// Loose match: DB value appears in Google's value or vice versa
function looseMatch(dbVal: string, googleVal: string): boolean {
  if (!dbVal || !googleVal) return true; // can't verify, give benefit of the doubt
  const a = dbVal.toLowerCase();
  const b = googleVal.toLowerCase();
  return a.includes(b) || b.includes(a);
}

// Normalise a Google geocode/place result into a common shape
function normaliseResult(result: any): { loc: { lat: number; lng: number }; formatted_address: string; place_id: string; address_components: any[] } {
  return {
    loc: result.geometry.location,
    formatted_address: result.formatted_address || '',
    place_id: result.place_id || '',
    address_components: result.address_components || [],
  };
}

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const { admin, response } = await requireAdmin(request, jwtSecret);
  if (response) return response;
  const db = env?.DB;
  const apiKey = env?.GOOGLE_PLACES_API_KEY;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  if (!apiKey) return new Response(JSON.stringify({ error: 'Google API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const url = new URL(request.url);
  const hotelId = url.searchParams.get('id');
  if (!hotelId) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const hotel = await db.prepare(`
    SELECT h.id, h.name, h.city, h.country, h.latitude, h.longitude,
           h.coords_verified_at, h.google_place_id,
           u.name as owner_name, u.email as owner_email
    FROM hotels h
    LEFT JOIN users u ON u.email = h.email AND u.role IN ('owner', 'inactive')
    WHERE h.id = ?
  `).bind(Number(hotelId)).first() as any;
  if (!hotel) return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const isProperty = looksLikePropertyName(hotel.name);
  const base = {
    id: hotel.id, name: hotel.name, is_property: isProperty,
    db_lat: hotel.latitude, db_lng: hotel.longitude,
    db_country: hotel.country, db_city: hotel.city,
    owner_name: hotel.owner_name || '', owner_email: hotel.owner_email || '',
    coords_verified_at: hotel.coords_verified_at || null,
  };

  // ── Stage 1: Place Details (if place_id already stored) ──────────────────
  // Bypasses name-matching entirely — most precise.
  let resolved: ReturnType<typeof normaliseResult> | null = null;

  if (hotel.google_place_id) {
    const detailsRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(hotel.google_place_id)}&fields=geometry,formatted_address,address_components,place_id&key=${apiKey}`
    );
    const details = await detailsRes.json() as any;
    if (details.status === 'OK' && details.result?.geometry) {
      resolved = normaliseResult(details.result);
    }
  }

  // ── Stage 2: Structured geocoding — name as address, city as component ───
  // Separating address segments reduces city/country ambiguity from concatenation.
  if (!resolved && hotel.city) {
    const structuredRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(hotel.name)}&components=${encodeURIComponent(`locality:${hotel.city}`)}&key=${apiKey}`
    );
    const geo = await structuredRes.json() as any;
    if (geo.status === 'OK' && geo.results?.length) {
      resolved = normaliseResult(geo.results[0]);
    }
  }

  // ── Stage 3: Fallback — concatenated query (original behaviour) ───────────
  if (!resolved) {
    const q = [hotel.name, hotel.city, hotel.country].filter(Boolean).join(', ');
    const fallbackRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${apiKey}`
    );
    const geo = await fallbackRes.json() as any;
    if (geo.status === 'OK' && geo.results?.length) {
      resolved = normaliseResult(geo.results[0]);
    }
  }

  if (!resolved) {
    return new Response(JSON.stringify({ ...base, status: 'not_found' }), { headers: { 'Content-Type': 'application/json' } });
  }

  const { loc, formatted_address: googleAddress, place_id: googlePlaceId, address_components } = resolved;
  const googlePlaceUrl = googlePlaceId ? `https://www.google.com/maps/place/?q=place_id:${googlePlaceId}` : '';
  const googleCountry = getAddressComponent(address_components, 'country');
  const googleCity =
    getAddressComponent(address_components, 'locality') ||
    getAddressComponent(address_components, 'administrative_area_level_2') ||
    getAddressComponent(address_components, 'administrative_area_level_1');

  // Country must match (if DB has one)
  if (hotel.country && !looseMatch(hotel.country, googleCountry)) {
    return new Response(JSON.stringify({
      ...base, status: 'location_mismatch',
      google_lat: loc.lat, google_lng: loc.lng,
      google_address: googleAddress, google_country: googleCountry,
      google_place_url: googlePlaceUrl, google_place_id: googlePlaceId,
      mismatch_field: 'country',
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  const hasDbCoords = hotel.latitude && hotel.longitude;
  if (!hasDbCoords) {
    return new Response(JSON.stringify({
      ...base, status: 'no_coords',
      google_lat: loc.lat, google_lng: loc.lng,
      google_address: googleAddress, google_place_url: googlePlaceUrl,
      google_place_id: googlePlaceId,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  const dist = distanceMeters(hotel.latitude, hotel.longitude, loc.lat, loc.lng);
  const status = dist > 500 ? 'mismatch' : 'ok';

  return new Response(JSON.stringify({
    ...base, status,
    distance_m: Math.round(dist),
    google_lat: loc.lat, google_lng: loc.lng,
    google_address: googleAddress, google_place_url: googlePlaceUrl,
    google_place_id: googlePlaceId,
  }), { headers: { 'Content-Type': 'application/json' } });
};

// Extract a Google Place ID from raw input (direct ID or Maps URL)
function extractPlaceId(input: string): string | null {
  const s = input.trim();
  // Direct place ID: no slashes or spaces, 20+ chars
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  // URL: place_id:XXXX (covers ?q=place_id:... and plain prefix)
  const colonMatch = s.match(/place_id:([A-Za-z0-9_-]{20,})/);
  if (colonMatch) return colonMatch[1];
  // URL query param: place_id=XXXX
  const eqMatch = s.match(/[?&]place_id=([A-Za-z0-9_-]{20,})/);
  if (eqMatch) return eqMatch[1];
  // Google Maps standard URL: data param encodes place ID after !1s
  const dataMatch = s.match(/!1s([A-Za-z0-9_-]{20,})/);
  if (dataMatch) return dataMatch[1];
  return null;
}

// Update hotel coordinates (and optionally address / place_id) from Google's result
export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const { admin, response } = await requireAdmin(request, jwtSecret);
  if (response) return response;
  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let data: any;
  try { data = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { id, latitude, longitude, address, google_place_id } = data;
  if (!id || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return new Response(JSON.stringify({ error: 'id, latitude, longitude required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const updates = ['latitude = ?', 'longitude = ?', 'coords_verified_at = NULL'];
    const binds: any[] = [latitude, longitude];
    if (address) { updates.push('address = ?'); binds.push(address); }
    if (google_place_id) { updates.push('google_place_id = ?'); binds.push(google_place_id); }
    binds.push(Number(id));

    await db.prepare(`UPDATE hotels SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Update failed', details: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

// Manual override: accept a Place ID or Maps URL, look up exact coords, save to DB
export const PUT: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const { admin, response } = await requireAdmin(request, jwtSecret);
  if (response) return response;
  const db = env?.DB;
  const apiKey = env?.GOOGLE_PLACES_API_KEY;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  if (!apiKey) return new Response(JSON.stringify({ error: 'Google API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let data: any;
  try { data = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { id, input } = data;
  if (!id || !input) {
    return new Response(JSON.stringify({ error: 'id and input required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const placeId = extractPlaceId(String(input));
  if (!placeId) {
    return new Response(JSON.stringify({ error: 'Place IDが見つかりません。Place IDまたはGoogle Maps URLを確認してください。' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const detailsRes = await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=geometry,formatted_address&key=${apiKey}`
  );
  const details = await detailsRes.json() as any;
  if (details.status !== 'OK' || !details.result?.geometry) {
    return new Response(JSON.stringify({ error: `Google Places API エラー: ${details.status || 'Unknown'}` }), { status: 422, headers: { 'Content-Type': 'application/json' } });
  }

  const loc = details.result.geometry.location;
  const address = details.result.formatted_address || '';

  try {
    await db.prepare(
      'UPDATE hotels SET latitude = ?, longitude = ?, google_place_id = ?, address = ?, coords_verified_at = NULL WHERE id = ?'
    ).bind(loc.lat, loc.lng, placeId, address, Number(id)).run();
    return new Response(JSON.stringify({ success: true, latitude: loc.lat, longitude: loc.lng, address, place_id: placeId }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Update failed', details: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

// Mark hotel coordinates as verified (or unverify).
// Use when DB coordinates are correct but Google returns a different location
// (e.g. chain head office address) — prevents the hotel from reappearing in Map Check results.
export const PATCH: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const { admin, response } = await requireAdmin(request, jwtSecret);
  if (response) return response;
  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let data: any;
  try { data = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { id, verified } = data;
  if (!id || typeof verified !== 'boolean') {
    return new Response(JSON.stringify({ error: 'id and verified (boolean) required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    if (verified) {
      const now = Math.floor(Date.now() / 1000);
      await db.prepare('UPDATE hotels SET coords_verified_at = ? WHERE id = ?').bind(now, Number(id)).run();
      return new Response(JSON.stringify({ success: true, coords_verified_at: now }), { headers: { 'Content-Type': 'application/json' } });
    } else {
      await db.prepare('UPDATE hotels SET coords_verified_at = NULL WHERE id = ?').bind(Number(id)).run();
      return new Response(JSON.stringify({ success: true, coords_verified_at: null }), { headers: { 'Content-Type': 'application/json' } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Update failed', details: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
