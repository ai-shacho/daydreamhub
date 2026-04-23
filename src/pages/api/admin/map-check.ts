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

  const query = [hotel.name, hotel.city, hotel.country].filter(Boolean).join(', ');
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`);
  const geo = await res.json() as any;

  if (geo.status !== 'OK' || !geo.results?.length) {
    return new Response(JSON.stringify({ id: hotel.id, name: hotel.name, status: 'not_found', db_lat: hotel.latitude, db_lng: hotel.longitude }), { headers: { 'Content-Type': 'application/json' } });
  }

  const loc = geo.results[0].geometry.location;
  const hasDbCoords = hotel.latitude && hotel.longitude;

  if (!hasDbCoords) {
    return new Response(JSON.stringify({
      id: hotel.id, name: hotel.name, status: 'no_coords',
      google_lat: loc.lat, google_lng: loc.lng,
      google_address: geo.results[0].formatted_address,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  const dist = distanceMeters(hotel.latitude, hotel.longitude, loc.lat, loc.lng);
  const status = dist > 500 ? 'mismatch' : 'ok';

  return new Response(JSON.stringify({
    id: hotel.id, name: hotel.name, status,
    distance_m: Math.round(dist),
    db_lat: hotel.latitude, db_lng: hotel.longitude,
    google_lat: loc.lat, google_lng: loc.lng,
    google_address: geo.results[0].formatted_address,
  }), { headers: { 'Content-Type': 'application/json' } });
};
