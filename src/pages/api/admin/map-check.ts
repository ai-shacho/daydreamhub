import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

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

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const db = env?.DB;
  const apiKey = env?.GOOGLE_PLACES_API_KEY;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  if (!apiKey) return new Response(JSON.stringify({ error: 'Google API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const url = new URL(request.url);
  const hotelId = url.searchParams.get('id');
  if (!hotelId) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const hotel = await db.prepare('SELECT id, name, city, country, latitude, longitude FROM hotels WHERE id = ?').bind(Number(hotelId)).first() as any;
  if (!hotel) return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const isProperty = looksLikePropertyName(hotel.name);

  const query = [hotel.name, hotel.city, hotel.country].filter(Boolean).join(', ');
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`);
  const geo = await res.json() as any;

  const base = { id: hotel.id, name: hotel.name, is_property: isProperty, db_lat: hotel.latitude, db_lng: hotel.longitude, db_country: hotel.country, db_city: hotel.city };

  if (geo.status !== 'OK' || !geo.results?.length) {
    return new Response(JSON.stringify({ ...base, status: 'not_found' }), { headers: { 'Content-Type': 'application/json' } });
  }

  const result = geo.results[0];
  const loc = result.geometry.location;
  const googleAddress = result.formatted_address;
  const googlePlaceId = result.place_id || '';
  const googleCountry = getAddressComponent(result.address_components, 'country');
  const googleCity =
    getAddressComponent(result.address_components, 'locality') ||
    getAddressComponent(result.address_components, 'administrative_area_level_2') ||
    getAddressComponent(result.address_components, 'administrative_area_level_1');

  const googlePlaceUrl = googlePlaceId ? `https://www.google.com/maps/place/?q=place_id:${googlePlaceId}` : '';

  // Country must match (if DB has one)
  if (hotel.country && !looseMatch(hotel.country, googleCountry)) {
    return new Response(JSON.stringify({
      ...base, status: 'location_mismatch',
      google_address: googleAddress,
      google_country: googleCountry,
      google_place_url: googlePlaceUrl,
      mismatch_field: 'country',
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  const hasDbCoords = hotel.latitude && hotel.longitude;

  if (!hasDbCoords) {
    return new Response(JSON.stringify({
      ...base, status: 'no_coords',
      google_lat: loc.lat, google_lng: loc.lng,
      google_address: googleAddress,
      google_place_url: googlePlaceUrl,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  const dist = distanceMeters(hotel.latitude, hotel.longitude, loc.lat, loc.lng);
  const status = dist > 500 ? 'mismatch' : 'ok';

  return new Response(JSON.stringify({
    ...base, status,
    distance_m: Math.round(dist),
    google_lat: loc.lat, google_lng: loc.lng,
    google_address: googleAddress,
    google_place_url: googlePlaceUrl,
  }), { headers: { 'Content-Type': 'application/json' } });
};

// Update hotel coordinates (and optionally address) from Google's result
export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let data: any;
  try { data = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { id, latitude, longitude, address } = data;
  if (!id || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return new Response(JSON.stringify({ error: 'id, latitude, longitude required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    if (address) {
      await db.prepare('UPDATE hotels SET latitude = ?, longitude = ?, address = ? WHERE id = ?').bind(latitude, longitude, address, Number(id)).run();
    } else {
      await db.prepare('UPDATE hotels SET latitude = ?, longitude = ? WHERE id = ?').bind(latitude, longitude, Number(id)).run();
    }
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Update failed', details: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
