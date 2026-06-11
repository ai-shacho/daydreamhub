import { analyzeFlightImage } from './claude';

export type FlightImageJobPayload = {
  image_key: string;
  session_id: string;
  mime_type: string;
};

function toBase64(uint8: Uint8Array) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function processFlightImageJob(env: any, payload: FlightImageJobPayload) {
  const db = env?.DB;
  const r2 = env?.IMAGES;
  if (!db || !r2) throw new Error('Missing DB/IMAGES binding');

  const { image_key, session_id, mime_type } = payload;

  await db
    .prepare(
      `UPDATE concierge_image_jobs
       SET status = 'processing', attempts = attempts + 1, updated_at = datetime('now'), error = NULL
       WHERE image_key = ?1 AND session_id = ?2`
    )
    .bind(image_key, session_id)
    .run();

  const obj = await r2.get(image_key);
  if (!obj) throw new Error(`Image not found in R2: ${image_key}`);

  const arrayBuffer = await obj.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  const base64 = toBase64(uint8);

  let analysis: any;
  try {
    const result = await analyzeFlightImage(env, base64, mime_type || obj.httpMetadata?.contentType || 'image/jpeg');
    analysis = JSON.parse(result || '{}');
  } catch (e) {
    analysis = { error: e instanceof Error ? e.message : 'Could not analyze image' };
  }

  const normalized = JSON.stringify(analysis);
  await db
    .prepare(
      `UPDATE concierge_image_jobs
       SET status = 'completed', analysis_json = ?1, updated_at = datetime('now'), completed_at = datetime('now')
       WHERE image_key = ?2 AND session_id = ?3`
    )
    .bind(normalized, image_key, session_id)
    .run();

  return analysis;
}

export async function failFlightImageJob(env: any, payload: FlightImageJobPayload, error: unknown) {
  const db = env?.DB;
  if (!db) return;
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  await db
    .prepare(
      `UPDATE concierge_image_jobs
       SET status = 'failed', error = ?1, updated_at = datetime('now')
       WHERE image_key = ?2 AND session_id = ?3`
    )
    .bind(message.slice(0, 1000), payload.image_key, payload.session_id)
    .run();
}
