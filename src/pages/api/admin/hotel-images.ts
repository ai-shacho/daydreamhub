import type { APIRoute } from 'astro';

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// GET: ?hotel_id=xxx
export const GET: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return json({ error: 'DB unavailable' }, 500);
  const url = new URL(request.url);
  const hotelId = url.searchParams.get('hotel_id');
  if (!hotelId) return json({ error: 'hotel_id required' }, 400);
  const result = await db.prepare('SELECT * FROM hotel_images WHERE hotel_id = ? ORDER BY sort_order ASC').bind(hotelId).all();
  return json({ images: result.results });
};

// POST: upload image (multipart/form-data with file + hotel_id)
export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const r2 = env?.IMAGES;
  if (!db) return json({ error: 'DB unavailable' }, 500);

  let formData: FormData;
  try { formData = await request.formData(); } catch { return json({ error: 'Invalid form data' }, 400); }

  const hotelId = formData.get('hotel_id') as string;
  const file = formData.get('file') as File | null;
  if (!hotelId || !file) return json({ error: 'hotel_id and file required' }, 400);

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) return json({ error: 'Unsupported file type' }, 400);
  if (file.size > 10 * 1024 * 1024) return json({ error: 'File too large (max 10MB)' }, 400);

  const ext = file.name.split('.').pop() || 'jpg';
  const key = `hotels/${hotelId}/${Date.now()}.${ext}`;

  let imageUrl: string;

  if (r2) {
    // Upload to R2
    const buf = await file.arrayBuffer();
    await r2.put(key, buf, { httpMetadata: { contentType: file.type } });
    imageUrl = `/hotel-images/${key}`;
  } else {
    // Fallback: return error if R2 not available
    return json({ error: 'Image storage (R2) not configured. Please add image URL manually.' }, 503);
  }

  // Get current max sort_order
  const maxResult = await db.prepare('SELECT MAX(sort_order) as max_order FROM hotel_images WHERE hotel_id = ?').bind(hotelId).first();
  const nextOrder = (maxResult?.max_order ?? -1) + 1;

  // Insert into hotel_images
  const r = await db.prepare(
    'INSERT INTO hotel_images (hotel_id, image_url, alt_text, sort_order) VALUES (?, ?, ?, ?)'
  ).bind(hotelId, imageUrl, file.name, nextOrder).run();

  return json({ success: true, id: r.meta?.last_row_id, image_url: imageUrl, sort_order: nextOrder });
};

// PUT: reorder images [{ id, sort_order }]
export const PUT: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  if (!db) return json({ error: 'DB unavailable' }, 500);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { images } = body; // [{id, sort_order}]
  if (!Array.isArray(images)) return json({ error: 'images array required' }, 400);
  for (const img of images) {
    await db.prepare('UPDATE hotel_images SET sort_order = ? WHERE id = ?').bind(img.sort_order, img.id).run();
  }
  return json({ success: true });
};

// DELETE: ?id=xxx
export const DELETE: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const r2 = env?.IMAGES;
  if (!db) return json({ error: 'DB unavailable' }, 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);
  // Get image URL to delete from R2
  const img = await db.prepare('SELECT image_url FROM hotel_images WHERE id = ?').bind(id).first();
  if (img?.image_url?.startsWith('/hotel-images/') && r2) {
    const key = img.image_url.replace('/hotel-images/', '');
    try { await r2.delete(key); } catch { /* ignore */ }
  }
  await db.prepare('DELETE FROM hotel_images WHERE id = ?').bind(id).run();
  return json({ success: true });
};
