import { defineMiddleware } from 'astro:middleware';

// レート制限設定
const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  '/api/bookings': { max: 10, windowMs: 60_000 },   // 1分10回まで
  '/api/payments': { max: 5, windowMs: 60_000 },    // 1分5回まで
  '/api/auth': { max: 10, windowMs: 300_000 },      // 5分10回まで
};

// インメモリレート制限（Cloudflare Workers単一インスタンス向け）
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true; // OK
  }

  if (entry.count >= max) return false; // 制限超過
  entry.count++;
  return true; // OK
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // POSTリクエストのみレート制限対象
  if (context.request.method === 'POST') {
    const matchedPath = Object.keys(RATE_LIMITS).find(p => pathname.startsWith(p));
    if (matchedPath) {
      const ip =
        context.request.headers.get('CF-Connecting-IP') ||
        context.request.headers.get('X-Forwarded-For') ||
        'unknown';
      const key = `${ip}:${matchedPath}`;
      const limit = RATE_LIMITS[matchedPath];

      if (!checkRateLimit(key, limit.max, limit.windowMs)) {
        return new Response(
          JSON.stringify({ error: 'Too many requests. Please try again later.' }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '60',
            },
          }
        );
      }
    }
  }

  // セキュリティヘッダーを追加
  const response = await next();

  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'SAMEORIGIN');
  newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
});
