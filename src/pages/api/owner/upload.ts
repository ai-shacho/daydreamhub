import type { APIRoute } from 'astro';
import { verifyOwner, getOwnerHotelIds } from '../../../lib/ownerAuth';

const json = { 'Content-Type': 'application/json' };
const MAX_SIZE = 2 * 1024 * 1024; // 2MB per image
const MAX_GALLERY = 20;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'ddh-secret-2025';

  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json });
  }

  const { hotel_id, image_data, field } = body;
  if (!hotel_id || !image_data) {
    return new Response(JSON.stringify({ error: 'hotel_id and image_data required' }), { status: 400, headers: json });
  }

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(Number(hotel_id))) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404, headers: json });
  }

  if (image_data.length > MAX_SIZE * 1.4) {
    return new Response(JSON.stringify({ error: 'Image too large (max 2MB)' }), { status: 400, headers: json });
  }

  if (field === 'gallery') {
    const hotel: any = await db.prepare('SELECT images FROM hotels WHERE id = ?').bind(Number(hotel_id)).first();
    let imgs: string[] = [];
    try { imgs = JSON.parse(hotel?.images || '[]'); } catch {}
    if (imgs.length >= MAX_GALLERY) {
      return new Response(JSON.stringify({ error: `Maximum ${MAX_GALLERY} images allowed` }), { status: 400, headers: json });
    }

    // Upload to R2 instead of storing base64 directly
    const imagesBucket = (env as any).IMAGES;
    if (!imagesBucket) {
      return new Response(JSON.stringify({ error: 'Image storage unavailable' }), { status: 503, headers: json });
    }

    const key = `hotels/${hotel_id}/gallery/${crypto.randomUUID()}.jpg`;
    // Strip data:image/...;base64, prefix before decoding
    const base64Data = image_data.includes('base64,') ? image_data.split('base64,')[1] : image_data;
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    await imagesBucket.put(key, bytes, {
      httpMetadata: { contentType: 'image/jpeg' },
    });

    const imageUrl = `/hotel-images/${key}`;
    imgs.push(imageUrl);
    await db.prepare('UPDATE hotels SET images = ? WHERE id = ?').bind(JSON.stringify(imgs), Number(hotel_id)).run();
    return new Response(JSON.stringify({ success: true, url: imageUrl, index: imgs.length - 1, count: imgs.length }), { headers: json });
  } else {
    // thumbnail
    await db.prepare('UPDATE hotels SET thumbnail_url = ? WHERE id = ?').bind(image_data, Number(hotel_id)).run();
    return new Response(JSON.stringify({ success: true }), { headers: json });
  }
};

// DELETE gallery image by index
export const DELETE: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'ddh-secret-2025';

  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });

  const url = new URL(request.url);
  const hotelId = Number(url.searchParams.get('hotel_id'));
  const index = Number(url.searchParams.get('index'));

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(hotelId)) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404, headers: json });
  }

  const hotel: any = await db.prepare('SELECT images FROM hotels WHERE id = ?').bind(hotelId).first();
  let imgs: string[] = [];
  try { imgs = JSON.parse(hotel?.images || '[]'); } catch {}
  if (index >= 0 && index < imgs.length) {
    const removedUrl = imgs[index];
    // Also delete from R2 if it's a stored image
    if (removedUrl?.startsWith('/hotel-images/') && (env as any).IMAGES) {
      const imgKey = removedUrl.replace('/hotel-images/', '');
      try { await (env as any).IMAGES.delete(imgKey); } catch { /* ignore */ }
    }
    imgs.splice(index, 1);
    await db.prepare('UPDATE hotels SET images = ? WHERE id = ?').bind(JSON.stringify(imgs), hotelId).run();
  }
  return new Response(JSON.stringify({ success: true, count: imgs.length }), { headers: json });
};

// PUT: reorder gallery images
export const PUT: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const jwtSecret = env?.JWT_SECRET || 'ddh-secret-2025';

  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 503, headers: json });

  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: json });
  }

  const { hotel_id, order } = body; // order: number[] (new index order)
  if (!hotel_id || !Array.isArray(order)) {
    return new Response(JSON.stringify({ error: 'hotel_id and order required' }), { status: 400, headers: json });
  }

  const ownerHotelIds = await getOwnerHotelIds(db, owner);
  if (!ownerHotelIds.includes(Number(hotel_id))) {
    return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404, headers: json });
  }

  const hotel: any = await db.prepare('SELECT images FROM hotels WHERE id = ?').bind(Number(hotel_id)).first();
  let imgs: string[] = [];
  try { imgs = JSON.parse(hotel?.images || '[]'); } catch {}

  const reordered = order.map((i: number) => imgs[i]).filter(Boolean);
  await db.prepare('UPDATE hotels SET images = ? WHERE id = ?').bind(JSON.stringify(reordered), Number(hotel_id)).run();

  return new Response(JSON.stringify({ success: true }), { headers: json });
};
