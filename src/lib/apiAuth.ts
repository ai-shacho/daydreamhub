import { verifyAdmin } from './adminAuth';
import { verifyOwner } from './ownerAuth';

type JsonHeaders = Record<string, string>;

export function unauthorizedResponse(headers?: HeadersInit): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
  });
}

export async function requireAdmin(
  request: Request,
  jwtSecret: string,
  headers?: JsonHeaders,
): Promise<{ admin: any | null; response: Response | null }> {
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
    return { admin: null, response: unauthorizedResponse(headers) };
  }
  return { admin, response: null };
}

export async function requireOwner(
  request: Request,
  jwtSecret: string,
  headers?: JsonHeaders,
): Promise<{ owner: any | null; response: Response | null }> {
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) {
    return { owner: null, response: unauthorizedResponse(headers) };
  }
  return { owner, response: null };
}
