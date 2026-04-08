import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const json = { 'Content-Type': 'application/json' };
  const runtime = (locals as any).runtime;

  const resendKey = runtime?.env?.RESEND_API_KEY;
  if (!resendKey) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY is not configured', hint: 'Set it in Cloudflare Pages > Settings > Environment Variables' }), { status: 500, headers: json });
  }

  const url = new URL(request.url);
  const to = url.searchParams.get('to') || 'daydreamhub.contact@gmail.com';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'DaydreamHub <noreply@daydreamhub.com>',
        to: [to],
        subject: 'DaydreamHub Email Test',
        html: '<h1>Email delivery test</h1><p>If you see this, email delivery is working correctly.</p>',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Resend API error', status: res.status, details: data }), { status: 500, headers: json });
    }
    return new Response(JSON.stringify({ success: true, to, resend_response: data }), { headers: json });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Failed to send' }), { status: 500, headers: json });
  }
};
