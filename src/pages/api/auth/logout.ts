import type { APIRoute } from 'astro';

export const POST: APIRoute = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'ddh_token=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly',
    },
  });
};
