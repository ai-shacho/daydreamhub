import type { APIRoute } from 'astro';

// Plus Code pattern: full (e.g. 8FW4V75V+8Q) or short (e.g. 75V+8Q Tokyo)
const PLUS_CODE_RE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}(\s+.+)?$/i;

function isPlusCode(input: string): boolean {
  return PLUS_CODE_RE.test(input.trim());
}

export const GET: APIRoute = async ({ url, locals }) => {
  const address = url.searchParams.get('address');
  if (!address) {
    return new Response(JSON.stringify({ error: 'address is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (isPlusCode(address)) {
      const apiKey = (locals as any).runtime?.env?.GOOGLE_PLACES_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Google API key not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
      );
      const data = await res.json() as any;
      if (data.status !== 'OK' || !data.results?.length) {
        return new Response(JSON.stringify({ error: 'Plus Code not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const loc = data.results[0].geometry.location;
      return new Response(
        JSON.stringify({
          latitude: loc.lat,
          longitude: loc.lng,
          display_name: data.results[0].formatted_address,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      {
        headers: {
          'User-Agent': 'DayDreamHub/1.0 (contact@daydreamhub.com)',
          'Accept-Language': 'en',
        },
      }
    );

    if (!res.ok) throw new Error('Geocoding API error');

    const data = await res.json() as any[];

    if (!data || data.length === 0) {
      return new Response(JSON.stringify({ error: 'Address not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon),
        display_name: data[0].display_name,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Geocoding failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
