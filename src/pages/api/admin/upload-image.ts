import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';

const json = { 'Content-Type': 'application/json' };
const MAX_SIZE = 5 * 1024 * 1024; // 5MB per image

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';

  // Verify admin
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: json });
  }

  // Parse FormData
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid FormData' }), { status: 400, headers: json });
  }

  const file = formData.get('image') as File;
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
    // Convert file to base64 (compatible with Cloudflare Workers)
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const mimeType = file.type;
    const imageDataUrl = `data:${mimeType};base64,${base64}`;

    return new Response(
      JSON.stringify({ success: true, imageUrl: imageDataUrl, fileName: file.name }),
      { status: 200, headers: json }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Failed to process image', details: message }),
      { status: 500, headers: json }
    );
  }
};
