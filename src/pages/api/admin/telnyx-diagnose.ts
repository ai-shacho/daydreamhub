import type { APIRoute } from 'astro';
import { CALL_SCRIPT_PROMPT } from '../../../lib/callScript';

export const GET: APIRoute = async ({ request, locals }) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get('key');
  if (secret !== 'ddh-diag-2026') {
    return new Response('Forbidden', { status: 403 });
  }
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const callSid = url.searchParams.get('call_sid');

  const diagnosis: any = {
    config: {
      TELNYX_API_KEY: env?.TELNYX_API_KEY
        ? `set (...${env.TELNYX_API_KEY.slice(-8)})`
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
      if (r.ok) {
        const d = await r.json();
        diagnosis.assistant = (d as any).data || d;
      } else {
        diagnosis.assistant = { status: 'ERROR', code: r.status, body: await r.text() };
      }
    } catch (e: any) {
      diagnosis.assistant = { status: 'FETCH_ERROR', message: e.message };
    }
  }

  if (env?.TELNYX_API_KEY && env?.TELNYX_TEXML_APP_ID) {
    try {
      const r = await fetch(
        `https://api.telnyx.com/v2/texml_applications/${env.TELNYX_TEXML_APP_ID}`,
        { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` } }
      );
      if (r.ok) {
        const d = await r.json();
        diagnosis.texml_app = { status: 'OK', name: (d as any).data?.friendly_name };
      } else {
        diagnosis.texml_app = { status: 'ERROR', code: r.status, body: await r.text() };
      }
    } catch (e: any) {
      diagnosis.texml_app = { status: 'FETCH_ERROR', message: e.message };
    }
  }

  if (callSid && env?.TELNYX_API_KEY) {
    try {
      const r = await fetch(
        `https://api.telnyx.com/v2/calls/${encodeURIComponent(callSid)}`,
        { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` } }
      );
      diagnosis.call_lookup = r.ok
        ? await r.json()
        : { status: 'ERROR', code: r.status, body: await r.text() };
    } catch (e: any) {
      diagnosis.call_lookup = { status: 'FETCH_ERROR', message: e.message };
    }
  }

  if (env?.TELNYX_API_KEY) {
    try {
      const r = await fetch(
        'https://api.telnyx.com/v2/reports/call_detail_records?page[size]=5',
        { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` } }
      );
      diagnosis.recent_cdrs = r.ok
        ? await r.json()
        : { status: 'ERROR', code: r.status, body: await r.text() };
    } catch (e: any) {
      diagnosis.recent_cdrs = { status: 'FETCH_ERROR', message: e.message };
    }
  }

  if (env?.TELNYX_API_KEY && env?.TELNYX_FROM_NUMBER) {
    try {
      const r = await fetch(
        `https://api.telnyx.com/v2/phone_numbers/${encodeURIComponent(env.TELNYX_FROM_NUMBER)}`,
        { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` } }
      );
      if (r.ok) {
        const d: any = await r.json();
        diagnosis.from_number = {
          number: d.data?.phone_number,
          status: d.data?.status,
          connection_id: d.data?.connection_id,
          features: d.data?.features,
          international: d.data?.international,
        };
      } else {
        diagnosis.from_number = { status: 'ERROR', code: r.status, body: await r.text() };
      }
    } catch (e: any) {
      diagnosis.from_number = { status: 'FETCH_ERROR', message: e.message };
    }
  }

  if (callSid && env?.TELNYX_API_KEY) {
    const callData: any = diagnosis.call_lookup;
    const sessionId = callData?.data?.call_session_id;
    if (sessionId) {
      try {
        const r = await fetch(
          `https://api.telnyx.com/v2/call_events?filter[call_session_id]=${sessionId}&page[size]=20`,
          { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` } }
        );
        diagnosis.call_events = r.ok
          ? await r.json()
          : { status: 'ERROR', code: r.status, body: await r.text() };
      } catch (e: any) {
        diagnosis.call_events = { status: 'FETCH_ERROR', message: e.message };
      }
    }
  }

  if (env?.TELNYX_API_KEY) {
    try {
      const r = await fetch(
        'https://api.telnyx.com/v2/outbound_voice_profiles?page[size]=5',
        { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` } }
      );
      diagnosis.outbound_profiles = r.ok
        ? await r.json()
        : { status: 'ERROR', code: r.status, body: await r.text() };
    } catch (e: any) {
      diagnosis.outbound_profiles = { status: 'FETCH_ERROR', message: e.message };
    }
  }

  if (
    url.searchParams.get('push_script') === 'true' &&
    env?.TELNYX_API_KEY &&
    env?.TELNYX_AI_ASSISTANT_ID
  ) {
    try {
      const r = await fetch(
        `https://api.telnyx.com/v2/ai/assistants/${env.TELNYX_AI_ASSISTANT_ID}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'DayDreamHub Concierge Booking',
            instructions: CALL_SCRIPT_PROMPT,
          }),
        }
      );
      if (r.ok) {
        const d: any = await r.json();
        diagnosis.push_script = {
          status: 'OK',
          name: d.data?.name,
          instructions_length: d.data?.instructions?.length,
          instructions_preview: d.data?.instructions?.substring(0, 200),
        };
      } else {
        diagnosis.push_script = { status: 'ERROR', code: r.status, body: await r.text() };
      }
    } catch (e: any) {
      diagnosis.push_script = { status: 'FETCH_ERROR', message: e.message };
    }
  }

  const testCallTo = url.searchParams.get('test_call');
  if (testCallTo && env?.TELNYX_API_KEY) {
    try {
      const r = await fetch('https://api.telnyx.com/v2/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connection_id: env.TELNYX_FROM_NUMBER ? undefined : '2895762800573941720',
          to: testCallTo,
          from: env.TELNYX_FROM_NUMBER || '+14407260039',
          answering_machine_detection: 'disabled',
          webhook_url: 'https://daydreamhub.pages.dev/api/webhooks/telnyx-voice',
        }),
      });
      diagnosis.test_call_standard = r.ok
        ? await r.json()
        : { status: 'ERROR', code: r.status, body: await r.text() };
    } catch (e: any) {
      diagnosis.test_call_standard = { status: 'FETCH_ERROR', message: e.message };
    }
    try {
      const r = await fetch(
        `https://api.telnyx.com/v2/texml/ai_calls/${env.TELNYX_TEXML_APP_ID}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.TELNYX_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            From: env.TELNYX_FROM_NUMBER,
            To: testCallTo,
            AIAssistantId: env.TELNYX_AI_ASSISTANT_ID,
            AIAssistantDynamicVariables: {
              hotel_name: 'Test Hotel',
              guest_name: 'Test Guest',
              date: '2026-02-20',
              check_in: '14:00',
              check_out: '20:00',
              guests: '1',
              language_code: url.searchParams.get('lang') || 'en',
              language_name:
                url.searchParams.get('lang') === 'ja' ? 'Japanese' : 'English',
              greeting:
                url.searchParams.get('lang') === 'ja'
                  ? 'もしもし、DayDreamHubのサラと申します。お忙しいところ恐れ入ります。'
                  : 'Hello, this is Sarah from DayDreamHub. Sorry to bother you.',
              special_requests: '',
              max_price: url.searchParams.get('max_price') || '10000 yen',
            },
          }),
        }
      );
      diagnosis.test_call_texml_ai = r.ok
        ? await r.json()
        : { status: 'ERROR', code: r.status, body: await r.text() };
    } catch (e: any) {
      diagnosis.test_call_texml_ai = { status: 'FETCH_ERROR', message: e.message };
    }
  }

  return new Response(JSON.stringify(diagnosis, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
