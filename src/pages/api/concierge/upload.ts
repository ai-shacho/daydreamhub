import type { APIRoute } from 'astro';
import { processFlightImageJob, failFlightImageJob, type FlightImageJobPayload } from '../../../lib/flight-image-jobs';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const r2 = env?.IMAGES;
  if (!r2 || !env?.DB) {
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

    await env.DB
      .prepare(
        `INSERT INTO concierge_image_jobs (session_id, image_key, mime_type, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'queued', datetime('now'), datetime('now'))`
      )
      .bind(sessionId, imageKey, image.type)
      .run();

    const payload: FlightImageJobPayload = {
      image_key: imageKey,
      session_id: sessionId,
      mime_type: image.type,
    };

    if (env.FLIGHT_IMAGE_QUEUE) {
      await env.FLIGHT_IMAGE_QUEUE.send(payload);
      return new Response(JSON.stringify({ image_key: imageKey, job_status: 'queued' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fallback for environments without queue binding
    try {
      const analysis = await processFlightImageJob(env, payload);
      return new Response(JSON.stringify({ image_key: imageKey, job_status: 'completed', analysis }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (jobError) {
      await failFlightImageJob(env, payload, jobError);
      return new Response(JSON.stringify({ image_key: imageKey, job_status: 'failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (e) {
    console.error('Upload error:', e);
    return new Response(JSON.stringify({ error: 'Upload failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
