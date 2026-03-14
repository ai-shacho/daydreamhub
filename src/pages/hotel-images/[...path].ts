import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
  const r2 = (locals as any).runtime?.env?.IMAGES;
  if (!r2) return new Response('Storage not available', { status: 503 });
  const key = `hotels/${params.path}`;
  const obj = await r2.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('cache-control', 'public, max-age=31536000');
  return new Response(obj.body, { headers });
};
