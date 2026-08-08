import type { APIRoute } from 'astro';

// Redirect to a Google Places photo without exposing the API key to clients.
// Resolves the media URL server-side (skipHttpRedirect returns JSON holding a
// key-free googleusercontent URL) and 302s to it, cached hard so a given photo
// is billed at most once a day per edge.

const cache = new Map<string, { at: number; uri: string }>();
const TTL = 12 * 60 * 60 * 1000;

export const GET: APIRoute = async ({ url, locals }) => {
  const env = (locals as any).runtime?.env;
  const apiKey = env?.GOOGLE_PLACES_API_KEY;
  const name = (url.searchParams.get('name') || '').trim();
  const w = Math.min(parseInt(url.searchParams.get('w') || '400'), 1000);

  // Resource names look like places/<id>/photos/<id> — reject anything else so
  // this cannot be used as an open proxy.
  if (!apiKey || !/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)) {
    return new Response(null, { status: 404 });
  }

  const key = `${name}@${w}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return Response.redirect(hit.uri, 302);
  }

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${w}&skipHttpRedirect=true&key=${apiKey}`
    );
    const data = (await res.json()) as any;
    const uri = data?.photoUri;
    if (!uri) return new Response(null, { status: 404 });
    cache.set(key, { at: Date.now(), uri });
    return new Response(null, {
      status: 302,
      headers: { Location: uri, 'Cache-Control': 'public, max-age=43200' },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
};
