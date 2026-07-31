import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/apiAuth';

// Admin-only diagnostic for the "DDH booking notification never arrives" issue.
// Open in a browser while logged in as admin:
//   /api/admin/test-admin-notify                 → inspect ADMIN_EMAIL + send a
//                                                    test to the sanitized recipients
//   /api/admin/test-admin-notify?to=you@x.com    → also send to a specific address
//   /api/admin/test-admin-notify?raw=1           → ALSO try sending to the RAW,
//                                                    unsanitized ADMIN_EMAIL to prove
//                                                    whether a trailing newline breaks it
// Nothing here is destructive; it only sends test emails and reports results.
export const GET: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  const env = (locals as any).runtime?.env;
  const jwtSecret = env?.JWT_SECRET || 'dev-secret';
  const { response } = await requireAdmin(request, jwtSecret);
  if (response) return response;

  const RESEND_API_KEY = env?.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: json });
  }

  const url = new URL(request.url);
  const extraTo = (url.searchParams.get('to') || '').trim();
  const alsoRaw = url.searchParams.get('raw') === '1';

  const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
  const rawAdmin = String(env?.ADMIN_EMAIL ?? '');
  const trimmedAdmin = rawAdmin.trim();

  // Expose exactly what the secret holds so a hidden trailing \n / space is visible.
  const diagnostics = {
    ADMIN_EMAIL_present: env?.ADMIN_EMAIL != null,
    ADMIN_EMAIL_json: JSON.stringify(rawAdmin),        // shows "info@x.com\n" if newline present
    ADMIN_EMAIL_length: rawAdmin.length,
    ADMIN_EMAIL_trimmed: trimmedAdmin,
    trailing_char_codes: rawAdmin.slice(-3).split('').map((c) => c.charCodeAt(0)),
    trimmed_is_valid_email: isEmail(trimmedAdmin),
    raw_is_valid_email: isEmail(rawAdmin),
  };

  async function send(to: string[], label: string) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'DaydreamHub <noreply@daydreamhub.com>',
          to,
          subject: `[TEST] DDH booking notification (${label})`,
          html: `<div style="font-family:Arial,sans-serif"><h3>Test DDH notification</h3><p>This is a test of the admin booking-notification path (<strong>${label}</strong>).</p><p>Recipients: ${to.map((t) => JSON.stringify(t)).join(', ')}</p></div>`,
        }),
      });
      const body: any = await res.json().catch(() => ({}));
      return { label, to, ok: res.ok, status: res.status, resend_id: body?.id || null, error: res.ok ? null : (body?.message || `HTTP ${res.status}`) };
    } catch (e: any) {
      return { label, to, ok: false, status: 0, resend_id: null, error: e?.message || String(e) };
    }
  }

  const results: any[] = [];

  // 1) The sanitized recipient set the fixed capture.ts now uses.
  const sanitized = [...new Set(['contact@daydreamhub.com', ...(isEmail(trimmedAdmin) ? [trimmedAdmin] : []), ...(isEmail(extraTo) ? [extraTo] : [])])];
  results.push(await send(sanitized, 'sanitized (contact@ + trimmed ADMIN_EMAIL)'));

  // 2) Optionally reproduce the failure by sending to the RAW ADMIN_EMAIL.
  if (alsoRaw && rawAdmin) {
    results.push(await send([rawAdmin], 'raw ADMIN_EMAIL (unsanitized)'));
  }

  return new Response(JSON.stringify({ diagnostics, results }, null, 2), { headers: json });
};
