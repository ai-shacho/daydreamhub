import type { APIRoute } from 'astro';
import { getVapidKeys } from '../../../lib/webpush';

// Public VAPID key for pushManager.subscribe(). Generated on first call.
export const GET: APIRoute = async ({ locals }) => {
  const db = (locals as any).runtime?.env?.DB;
  const keys = db ? await getVapidKeys(db) : null;
  return new Response(JSON.stringify({ publicKey: keys?.publicKey || null }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
