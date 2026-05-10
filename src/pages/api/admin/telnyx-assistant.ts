import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../lib/adminAuth';
import { CALL_SCRIPT_PROMPT } from '../../../lib/callScript';

export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  return new Response(
    JSON.stringify({
      script: CALL_SCRIPT_PROMPT,
      assistant_id: runtime?.env?.TELNYX_AI_ASSISTANT_ID || 'not configured',
      texml_app_id: runtime?.env?.TELNYX_TEXML_APP_ID || 'not configured',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const env = runtime?.env;
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const body = await request.json();
  const action = (body as any).action;

  if (action === 'check') {
    if (!env?.TELNYX_API_KEY || !env?.TELNYX_AI_ASSISTANT_ID) {
      return new Response(
        JSON.stringify({ error: 'TELNYX_API_KEY or TELNYX_AI_ASSISTANT_ID not configured' }),
        { status: 400 }
      );
    }
    try {
      const response = await fetch(
        `https://api.telnyx.com/v2/ai/assistants/${env.TELNYX_AI_ASSISTANT_ID}`,
        { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` } }
      );
      if (!response.ok) {
        const err = await response.text();
        return new Response(
          JSON.stringify({ error: `Telnyx API error: ${response.status}`, details: err }),
          { status: response.status }
        );
      }
      const data = await response.json();
      return new Response(JSON.stringify({ assistant: data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  if (action === 'update') {
    if (!env?.TELNYX_API_KEY || !env?.TELNYX_AI_ASSISTANT_ID) {
      return new Response(
        JSON.stringify({ error: 'TELNYX_API_KEY or TELNYX_AI_ASSISTANT_ID not configured' }),
        { status: 400 }
      );
    }
    const instructions = CALL_SCRIPT_PROMPT;
    try {
      const response = await fetch(
        `https://api.telnyx.com/v2/ai/assistants/${env.TELNYX_AI_ASSISTANT_ID}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ instructions }),
        }
      );
      if (!response.ok) {
        const err = await response.text();
        return new Response(
          JSON.stringify({ error: `Update failed: ${response.status}`, details: err }),
          { status: response.status }
        );
      }
      const data = await response.json();
      return new Response(JSON.stringify({ success: true, assistant: data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  if (action === 'diagnose') {
    const diagnosis: any = {
      config: {
        TELNYX_API_KEY: env?.TELNYX_API_KEY
          ? `...${env.TELNYX_API_KEY.slice(-8)}`
          : 'NOT SET',
        TELNYX_AI_ASSISTANT_ID: env?.TELNYX_AI_ASSISTANT_ID || 'NOT SET',
        TELNYX_TEXML_APP_ID: env?.TELNYX_TEXML_APP_ID || 'NOT SET',
        TELNYX_FROM_NUMBER: env?.TELNYX_FROM_NUMBER || 'NOT SET',
      },
    };
    if (env?.TELNYX_API_KEY && env?.TELNYX_AI_ASSISTANT_ID) {
      try {
        const r = await fetch(
          `https://api.telnyx.com/v2/ai/assistants/${env.TELNYX_AI_ASSISTANT_ID}`,
          { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` } }
        );
        diagnosis.assistant_check = r.ok ? 'OK' : `ERROR ${r.status}: ${await r.text()}`;
      } catch (e: any) {
        diagnosis.assistant_check = `FETCH ERROR: ${e.message}`;
      }
    }
    if (env?.TELNYX_API_KEY && env?.TELNYX_TEXML_APP_ID) {
      try {
        const r = await fetch(
          `https://api.telnyx.com/v2/texml_applications/${env.TELNYX_TEXML_APP_ID}`,
          { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` } }
        );
        if (r.ok) {
          const data = await r.json();
          diagnosis.texml_app = {
            status: 'OK',
            name: (data as any).data?.friendly_name || (data as any).data?.name,
          };
        } else {
          diagnosis.texml_app = `ERROR ${r.status}: ${await r.text()}`;
        }
      } catch (e: any) {
        diagnosis.texml_app = `FETCH ERROR: ${e.message}`;
      }
    }
    if (env?.TELNYX_API_KEY) {
      try {
        const r = await fetch('https://api.telnyx.com/v2/calls?page[size]=5', {
          headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` },
        });
        if (r.ok) {
          const data = await r.json();
          diagnosis.recent_calls = (data as any).data || [];
        } else {
          diagnosis.recent_calls_error = `ERROR ${r.status}: ${await r.text()}`;
        }
      } catch (e: any) {
        diagnosis.recent_calls_error = `FETCH ERROR: ${e.message}`;
      }
    }
    if ((body as any).call_sid && env?.TELNYX_API_KEY) {
      try {
        const r = await fetch(`https://api.telnyx.com/v2/calls/${(body as any).call_sid}`, {
          headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` },
        });
        diagnosis.call_detail = r.ok ? await r.json() : `ERROR ${r.status}: ${await r.text()}`;
      } catch (e: any) {
        diagnosis.call_detail_error = e.message;
      }
    }
    return new Response(JSON.stringify(diagnosis, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
};
