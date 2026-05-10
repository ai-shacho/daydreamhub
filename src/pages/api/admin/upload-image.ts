import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

const json = { 'Content-Type': 'application/json' };
const MAX_SIZE = 5 * 1024 * 1024; // 5MB per image

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const r2 = env?.IMAGES;

  // Verify admin
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });
  }

  if (!r2) {
    return new Response(JSON.stringify({ error: 'Image storage (R2) not available. Please contact admin.' }), { status: 503, headers: json });
  }

  // Parse FormData
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid FormData' }), { status: 400, headers: json });
  }

  // Try multiple field names (Jodit uses 'files[0]', our custom upload uses 'image')
  let file = formData.get('image') as File | null;
  if (!file) file = formData.get('files[0]') as File | null;
  if (!file) file = formData.get('file') as File | null;
  if (!file) {
    return new Response(JSON.stringify({ error: 'No image file provided' }), { status: 400, headers: json });
  }

  // Validate file type
  if (!file.type.startsWith('image/')) {
    return new Response(JSON.stringify({ error: 'File must be an image' }), { status: 400, headers: json });
  }

  // Validate file size
  if (file.size > MAX_SIZE) {
    return new Response(JSON.stringify({ error: 'Image too large (max 5MB)' }), { status: 400, headers: json });
  }

  try {
    // Generate unique filename
    const ext = file.name.split('.').pop() || 'jpg';
    const key = `blog/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

    // Upload to R2
    const buffer = await file.arrayBuffer();
    await r2.put(key, buffer, { httpMetadata: { contentType: file.type } });

    // Build access URL
    const imageUrl = `/blog-images/${key}`;

    return new Response(
      JSON.stringify({ success: true, imageUrl, fileName: file.name }),
      { status: 200, headers: json }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Failed to upload image', details: message }),
      { status: 500, headers: json }
    );
  }
};
