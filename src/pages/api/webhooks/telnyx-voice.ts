import type { APIRoute } from 'astro';

async function telnyxCmd(apiKey: string, callControlId: string, cmd: string, body: any = {}) {
  const res = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/${cmd}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`[${cmd}] ${res.status} ${text.slice(0, 150)}`);
  return res.ok;
}

function encodeState(obj: any): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

function decodeState(raw: string | null | undefined): any {
  if (!raw) return {};
  try {
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    try { return JSON.parse(atob(raw)); } catch { return {}; }
  }
}

async function aiDecide(apiKey: string, conversation: any[], hotelSaid: string) {
  const system = `You are a DayDreamHub booking agent on a phone call with a hotel.
Based on what the hotel just said, decide:
- "confirmed" if they confirm availability
- "declined" if they are fully booked / unavailable
- "alternative_offered" if they offer different terms (price, time, room)
- "ask_followup" if unclear — ask ONE short natural question

Reply JSON only: {"action":"...","reply":"...","note":"..."}
reply = natural conversational English, max 2 short sentences`;

  try {
    const r = await fetch('https://api.telnyx.com/v2/ai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          ...conversation,
          { role: 'user', content: `Hotel said: "${hotelSaid}"` },
        ],
        max_tokens: 150,
      }),
    });
    const d: any = await r.json();
    const content = d.choices?.[0]?.message?.content || '';
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch (e) { console.error('AI error:', e); }

  // keyword fallback
  const l = hotelSaid.toLowerCase();
  if (l.includes('yes') && !l.includes('but') && !l.includes('however') && !l.includes('price'))
    return { action: 'confirmed', reply: "Oh great, perfect! Thanks so much. I'll get that confirmed on our end. Have a great day!", note: 'confirmed via keyword' };
  if (l.includes('no') || l.includes('full') || l.includes('unavailable') || l.includes('booked'))
    return { action: 'declined', reply: "Ah okay, no worries at all. I'll let the guest know. Thanks for letting me know!", note: 'declined via keyword' };
  return { action: 'ask_followup', reply: "Oh sorry, just to clarify — are you able to take the reservation?", note: 'fallback followup' };
}

export const POST: APIRoute = async ({ request, locals, url }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  const apiKey = env?.TELNYX_API_KEY;

  if (!apiKey) return new Response('no key', { status: 500 });

  let event: any;
  try { event = await request.json(); } catch { return new Response('OK'); }

  const eventType: string = event?.data?.event_type || '';
  const payload = event?.data?.payload || {};
  const callControlId: string = payload.call_control_id || '';
  const state = decodeState(payload.client_state);

  // AIアシスタントによるコンシェルジュ発信は telnyx-voice.ts では処理しない
  // (telnyx-ai-insights.ts が担当)
  if (state.type === 'concierge' || state.call_id) {
    console.log(`[telnyx-voice] Skipping concierge AI call (type=${state.type}, call_id=${state.call_id})`);
    return new Response(JSON.stringify({ ok: true, skipped: 'concierge_ai_call' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // IDs: prefer client_state, fallback to query params
  const bookingId = state.booking_id ?? url.searchParams.get('bid') ?? url.searchParams.get('booking_id');
  const logId = state.call_log_id ?? url.searchParams.get('lid') ?? url.searchParams.get('log_id');

  console.log(`[${eventType}] ctrl=${callControlId.slice(0, 16)} bid=${bookingId} lid=${logId} phase=${state.phase}`);

  // Debug: record every received event in DB note field
  if (db && logId) {
    await db.prepare(`UPDATE call_logs SET note = COALESCE(note||',','') || ? WHERE id = ?`)
      .bind(eventType, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
  }

  switch (eventType) {

    case 'call.initiated': {
      // Store call control id from webhook (v3: format)
      if (db && logId) {
        await db.prepare(`UPDATE call_logs SET telnyx_call_id=? WHERE id=?`)
          .bind(callControlId, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
      }
      break;
    }

    case 'call.answered': {
      const plan = (state.plan_name || 'day use').replace(/[^\x00-\x7F]/g, '').trim() || 'day use';
      const checkIn = (state.check_in_date || 'the requested date').replace(/[^\x00-\x7F]/g, '').trim() || 'the requested date';
      const guests = state.guests || 1;
      const greeting = `Hi there, this is DayDreamHub. I'm calling to check on a day use reservation — ${checkIn}, ${guests} ${guests === 1 ? 'person' : 'people'}, ${plan}. Are you able to accommodate that?`;

      // Update DB first so we have a record even if speak fails
      if (db && logId) {
        await db.prepare(`UPDATE call_logs SET status='awaiting_response', telnyx_call_id=?, transcription=? WHERE id=?`)
          .bind(callControlId, `[Agent]: ${greeting}`, logId).run().catch(e => console.error('DB err:', e));
      }

      // Speak — log result to DB for debugging
      const speakOk = await telnyxCmd(apiKey, callControlId, 'speak', {
        payload: greeting,
        voice: 'Polly.Joanna',
      });
      if (db && logId) {
        await db.prepare(`UPDATE call_logs SET note = COALESCE(note||',','') || ? WHERE id = ?`)
          .bind(speakOk ? 'speak:ok' : 'speak:FAIL', logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
      }
      break;
    }

    case 'call.speak.ended': {
      const phase = state.phase || 'listening';
      if (phase === 'ending') {
        await telnyxCmd(apiKey, callControlId, 'hangup', {});
        break;
      }
      // After any speech (greeting or followup), start listening
      await telnyxCmd(apiKey, callControlId, 'gather', {
        maximum_digits: 1,
        minimum_digits: 0,
        timeout_millis: 20000,
        speech_timeout: 'auto',
        speech_end_timeout: 2000,
        input: ['speech', 'dtmf'],
        client_state: encodeState({ ...state, phase: 'listening', booking_id: bookingId, call_log_id: logId }),
      });
      break;
    }

    case 'call.gather.ended': {
      const speech: string = payload.speech || '';
      const digits: string = payload.digits || '';
      const reason: string = payload.reason || '';
      const hotelSaid = speech || (digits ? ({ '1': 'yes', '2': 'no', '3': 'alternative' } as any)[digits] || '' : '');

      console.log(`[gather] speech="${speech}" digits=${digits} reason=${reason}`);

      if (!hotelSaid || reason === 'timeout') {
        await telnyxCmd(apiKey, callControlId, 'speak', {
          payload: "Sorry, I didn't quite catch that. Could you let me know if the reservation is available?",
          voice: 'Polly.Joanna',
          client_state: encodeState({ ...state, phase: 'followup' }),
        });
        break;
      }

      const conv = state.conversation || [];
      const decision = await aiDecide(apiKey, conv, hotelSaid);
      console.log('[AI]', decision);

      if (decision.action === 'ask_followup') {
        await telnyxCmd(apiKey, callControlId, 'speak', {
          payload: decision.reply,
          voice: 'Polly.Joanna',
          client_state: encodeState({
            ...state,
            phase: 'followup',
            conversation: [...conv, { role: 'user', content: hotelSaid }, { role: 'assistant', content: decision.reply }],
          }),
        });
        break;
      }

      // Final: confirmed / declined / alternative_offered
      const statusMap: Record<string, string> = { confirmed: 'confirmed', declined: 'declined', alternative_offered: 'alternative_offered' };
      const bkStatusMap: Record<string, string> = { confirmed: 'confirmed', declined: 'cancelled', alternative_offered: 'pending_alternative' };
      const newStatus = statusMap[decision.action] || 'no_answer';

      if (db) {
        if (logId) {
          const transcript = [...conv, { role: 'user', content: hotelSaid }, { role: 'assistant', content: decision.reply }]
            .map(m => `[${m.role === 'assistant' ? 'Agent' : 'Hotel'}]: ${m.content}`)
            .join('\n');
          await db.prepare(`UPDATE call_logs SET status=?, transcription=?, note=? WHERE id=?`)
            .bind(newStatus, transcript, decision.note || hotelSaid, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
        }
        if (bookingId && bkStatusMap[decision.action]) {
          await db.prepare(`UPDATE bookings SET status=? WHERE id=?`)
            .bind(bkStatusMap[decision.action], bookingId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
        }
      }

      await telnyxCmd(apiKey, callControlId, 'speak', {
        payload: decision.reply,
        voice: 'Polly.Joanna',
        client_state: encodeState({ ...state, phase: 'ending' }),
      });
      break;
    }

    case 'call.hangup': {
      if (db && logId) {
        const log: any = await db.prepare(`SELECT status FROM call_logs WHERE id=?`).bind(logId).first().catch(() => null);
        if (log && !['confirmed', 'declined', 'alternative_offered'].includes(log.status)) {
          await db.prepare(`UPDATE call_logs SET status='no_answer' WHERE id=?`).bind(logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
        }
      }
      break;
    }
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
