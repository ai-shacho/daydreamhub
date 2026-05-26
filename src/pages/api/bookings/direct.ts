import type { APIRoute } from 'astro';

export const POST: APIRoute = async () => {
  return new Response(JSON.stringify({ error: 'This endpoint has been disabled.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  });
};
