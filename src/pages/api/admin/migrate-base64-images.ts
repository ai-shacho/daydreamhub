import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/apiAuth';

// One-off migration: move base64 data-URI images embedded in the DB out to R2
// and replace the column value with the served URL. The image itself is
// unchanged — only where it's stored changes, which shrinks the D1 rows.
//
// Admin-only. Idempotent (only touches rows still holding a data: URI).
// Runs in batches to stay within Worker limits:
//   GET /api/admin/migrate-base64-images?limit=10          → migrate up to 10 hotel thumbnails
//   GET /api/admin/migrate-base64-images?dry=1             → report what WOULD change, no writes
//   GET /api/admin/migrate-base64-images?count=1           → just counts remaining

function extFromMime(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('svg')) return 'svg';
  return 'jpg';
}

// data:image/jpeg;base64,XXXX  →  { mime, bytes } | null
function parseDataUri(uri: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(uri || ''));
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1], bytes };
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const { response } = await requireAdmin(request, jwtSecret);
  if (response) return response;

  const db = env?.DB;
  const r2 = env?.IMAGES;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  const countOnly = url.searchParams.get('count') === '1';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10'), 1), 25);

  // Remaining counts (thumbnails + the images JSON column)
  const remThumb: any = await db.prepare("SELECT COUNT(*) AS c FROM hotels WHERE thumbnail_url LIKE 'data:image%'").first();
  const remImages: any = await db.prepare("SELECT COUNT(*) AS c FROM hotels WHERE images LIKE '%data:image%'").first();
  if (countOnly) {
    return new Response(JSON.stringify({ remaining: { thumbnail_url: remThumb?.c || 0, images_json: remImages?.c || 0 } }), { headers: json });
  }

  if (!r2 && !dry) {
    return new Response(JSON.stringify({ error: 'R2 (IMAGES) binding not available' }), { status: 503, headers: json });
  }

  const rows: any[] = await db.prepare(
    "SELECT id, thumbnail_url FROM hotels WHERE thumbnail_url LIKE 'data:image%' ORDER BY id LIMIT ?"
  ).bind(limit).all().then((r: any) => r?.results || []);

  const migrated: any[] = [];
  for (const row of rows) {
    const parsed = parseDataUri(row.thumbnail_url);
    if (!parsed) { migrated.push({ id: row.id, skipped: 'unparseable data URI' }); continue; }
    const key = `hotels/${row.id}/thumb-${Date.now()}.${extFromMime(parsed.mime)}`;
    const newUrl = `/hotel-images/${key}`;
    if (dry) { migrated.push({ id: row.id, bytes: parsed.bytes.length, wouldBecome: newUrl }); continue; }
    try {
      await r2.put(key, parsed.bytes, { httpMetadata: { contentType: parsed.mime } });
      await db.prepare("UPDATE hotels SET thumbnail_url = ?, updated_at = datetime('now') WHERE id = ?").bind(newUrl, row.id).run();
      migrated.push({ id: row.id, bytes: parsed.bytes.length, newUrl, ok: true });
    } catch (e: any) {
      migrated.push({ id: row.id, error: e?.message || String(e) });
    }
  }

  const after: any = await db.prepare("SELECT COUNT(*) AS c FROM hotels WHERE thumbnail_url LIKE 'data:image%'").first();
  return new Response(JSON.stringify({
    dry, processed: migrated.length, migrated,
    remaining_thumbnails: after?.c || 0,
    images_json_remaining: remImages?.c || 0,
    note: 'Re-run until remaining_thumbnails is 0. The images JSON column is handled separately if needed.',
  }, null, 2), { headers: json });
};
