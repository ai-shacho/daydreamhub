import type { APIRoute } from 'astro';
import { analyzeFlightImage } from '../../../lib/claude';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const r2 = env?.IMAGES;
  if (!r2 || !env?.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'Service not available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid form data' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const image = formData.get('image') as File | null;
  const sessionId = formData.get('session_id') as string | null;
  if (!image || !sessionId) {
    return new Response(JSON.stringify({ error: 'image and session_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!ALLOWED_TYPES.includes(image.type)) {
    return new Response(JSON.stringify({ error: 'Unsupported image type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (image.size > MAX_FILE_SIZE) {
    return new Response(JSON.stringify({ error: 'File too large (max 5MB)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const arrayBuffer = await image.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const ext = image.type.split('/')[1] || 'jpg';
    const imageKey = `concierge/${sessionId}/${Date.now()}.${ext}`;
    await r2.put(imageKey, uint8, {
      httpMetadata: { contentType: image.type },
    });

    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);

    let analysis: any = {};
    try {
      const result = await analyzeFlightImage(env, base64, image.type);
      analysis = JSON.parse(result);
    } catch {
      analysis = { error: 'Could not analyze image' };
    }
    return new Response(JSON.stringify({ image_key: imageKey, analysis }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Upload error:', e);
    return new Response(JSON.stringify({ error: 'Upload failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
