// Server-side geocoding so every hotel ends up with coordinates without anyone
// having to press the "geocode" button in the admin/owner forms. Coordinates
// are what drive the nearest-airport distance shown on hotel pages, search
// cards and city pages, so a hotel saved without them silently loses that.
//
// Google is used when a key is configured (same key as the manual geocode
// endpoint); OpenStreetMap's Nominatim is the keyless fallback so this still
// works in environments without the Google key.

export type Coords = { latitude: number; longitude: number };

type HotelLike = {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
};

const UA = 'DayDreamHub/1.0 (+https://daydreamhub.com)';

function clean(v: unknown): string {
  return String(v ?? '').trim();
}

function valid(lat: unknown, lng: unknown): Coords | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la === 0 && ln === 0) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { latitude: la, longitude: ln };
}

async function viaGoogle(query: string, apiKey: string): Promise<Coords | null> {
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (data.status !== 'OK' || !data.results?.length) return null;
    const loc = data.results[0]?.geometry?.location;
    return valid(loc?.lat, loc?.lng);
  } catch {
    return null;
  }
}

async function viaNominatim(query: string): Promise<Coords | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any[];
    if (!Array.isArray(data) || !data.length) return null;
    return valid(data[0]?.lat, data[0]?.lon);
  } catch {
    return null;
  }
}

// Progressively looser queries: the exact property first, then the street
// address, then just the city. The city-level result is deliberately allowed as
// a last resort — an approximate position still yields the right nearest
// airport, which is the point.
function buildQueries(hotel: HotelLike): string[] {
  const name = clean(hotel.name);
  const address = clean(hotel.address);
  const city = clean(hotel.city);
  const country = clean(hotel.country);
  const q = (...parts: string[]) => parts.filter(Boolean).join(', ');
  const candidates = [
    q(name, address, city, country),
    q(address, city, country),
    q(name, city, country),
    q(city, country),
  ];
  return [...new Set(candidates.filter((c) => c.length > 2))];
}

export async function geocodeHotel(env: any, hotel: HotelLike): Promise<Coords | null> {
  const apiKey = clean(env?.GOOGLE_PLACES_API_KEY);
  for (const query of buildQueries(hotel)) {
    const hit = apiKey ? await viaGoogle(query, apiKey) : null;
    if (hit) return hit;
    const fallback = await viaNominatim(query);
    if (fallback) return fallback;
  }
  return null;
}

// Fill in a hotel's coordinates if they are missing. Safe to call after any
// insert/update: it never overwrites coordinates that are already set, and it
// never throws — a failed lookup just leaves the row as it was.
export async function ensureHotelCoords(env: any, db: any, hotelId: number | string): Promise<Coords | null> {
  if (!db || !hotelId) return null;
  try {
    const hotel: any = await db
      .prepare('SELECT id, name, address, city, country, latitude, longitude FROM hotels WHERE id = ?')
      .bind(hotelId)
      .first();
    if (!hotel) return null;
    if (valid(hotel.latitude, hotel.longitude)) return null; // already positioned

    const coords = await geocodeHotel(env, hotel);
    if (!coords) return null;

    await db
      .prepare('UPDATE hotels SET latitude = ?, longitude = ? WHERE id = ? AND (latitude IS NULL OR longitude IS NULL)')
      .bind(coords.latitude, coords.longitude, hotelId)
      .run();
    return coords;
  } catch (e) {
    console.error('[geocode] ensureHotelCoords failed', hotelId, e);
    return null;
  }
}
