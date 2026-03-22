import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url }) => {
  const address = url.searchParams.get('address');
  if (!address) {
    return new Response(JSON.stringify({ error: 'address is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const encodedAddress = encodeURIComponent(address);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodedAddress}&format=json&limit=1`,
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
