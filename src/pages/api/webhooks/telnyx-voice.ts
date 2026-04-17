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

// AI to extract price from hotel's spoken response
async function aiExtractPrice(apiKey: string, hotelSaid: string): Promise<{ amount: number | null; raw: string }> {
  try {
    const r = await fetch('https://api.telnyx.com/v2/ai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Extract the price in USD from what the hotel said. Reply JSON only: {"amount": 50, "raw": "fifty dollars"}. If no clear price found, reply {"amount": null, "raw": ""}' },
          { role: 'user', content: `Hotel said: "${hotelSaid}"` },
        ],
        max_tokens: 50,
      }),
    });
    const d: any = await r.json();
    const content = d.choices?.[0]?.message?.content || '';
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch (e) { console.error('AI price extract error:', e); }
  // Fallback: try to find number in speech
  const numMatch = hotelSaid.match(/(\d+)/);
  if (numMatch) return { amount: parseInt(numMatch[1]), raw: numMatch[1] };
  return { amount: null, raw: '' };
}

// Classify yes/no from speech (button or voice)
function classifyYesNo(speech: string, digits: string): 'yes' | 'no' | null {
  if (digits === '1') return 'yes';
  if (digits === '2') return 'no';
  if (speech) {
    const l = speech.toLowerCase();
    if (l.includes('yes') || l.includes('yeah') || l.includes('sure') || l.includes('ok') ||
        l.includes('confirm') || l.includes('available') || l.includes('we do') || l.includes('we can'))
      return 'yes';
    if (l.includes('no') || l.includes('don\'t') || l.includes('not') || l.includes('unavailable') ||
        l.includes('full') || l.includes('booked') || l.includes('decline') || l.includes('can\'t') || l.includes('cannot'))
      return 'no';
  }
  return null;
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

  // Skip concierge AI calls (handled by telnyx-ai-insights.ts)
  if (state.type === 'concierge' || state.call_id) {
    console.log(`[telnyx-voice] Skipping concierge AI call`);
    return new Response(JSON.stringify({ ok: true, skipped: 'concierge_ai_call' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const bookingId = state.booking_id ?? url.searchParams.get('bid') ?? url.searchParams.get('booking_id');
  const logId = state.call_log_id ?? url.searchParams.get('lid') ?? url.searchParams.get('log_id');

  console.log(`[${eventType}] ctrl=${callControlId.slice(0, 16)} bid=${bookingId} lid=${logId} step=${state.step} phase=${state.phase}`);

  // Record every event in DB
  if (db && logId) {
    await db.prepare(`UPDATE call_logs SET note = COALESCE(note||',','') || ? WHERE id = ?`)
      .bind(eventType, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
  }

  switch (eventType) {

    case 'call.initiated': {
      if (db && logId) {
        await db.prepare(`UPDATE call_logs SET telnyx_call_id=? WHERE id=?`)
          .bind(callControlId, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
      }
      break;
    }

    case 'call.answered': {
      // STEP 1: Introduce DayDreamHub + ask about day-use availability
      const checkIn = (state.check_in_date || 'the requested date').replace(/[^\x00-\x7F]/g, '').trim() || 'the requested date';
      const guests = state.guests || 1;

      const greeting = `Hello, this is DayDreamHub, a booking platform that connects hotels with travelers seeking day-use accommodations. We have a guest looking to book a day-use stay on ${checkIn}, for ${guests} ${guests === 1 ? 'person' : 'people'}. Do you offer day-use plans? Press 1 or say yes. Press 2 or say no. You may also respond by voice.`;

      if (db && logId) {
        await db.prepare(`UPDATE call_logs SET status='awaiting_response', telnyx_call_id=?, transcription=? WHERE id=?`)
          .bind(callControlId, `[Agent]: ${greeting}`, logId).run().catch(e => console.error('DB err:', e));
      }

      await telnyxCmd(apiKey, callControlId, 'speak', {
        payload: greeting,
        voice: 'Polly.Joanna',
        client_state: encodeState({ ...state, step: 'ask_dayuse', booking_id: bookingId, call_log_id: logId }),
      });
      break;
    }

    case 'call.speak.ended': {
      const phase = state.phase || '';
      if (phase === 'ending') {
        await telnyxCmd(apiKey, callControlId, 'hangup', {});
        break;
      }
      // After any speech, start listening for DTMF or voice
      const isPriceStep = state.step === 'ask_price';
      await telnyxCmd(apiKey, callControlId, 'gather', {
        maximum_digits: isPriceStep ? 6 : 1,  // price: up to 6 digits (e.g. "999" + "#"), yes/no: 1 digit
        minimum_digits: 0,
        terminating_digit: isPriceStep ? '#' : '',
        timeout_millis: isPriceStep ? 20000 : 15000,
        speech_timeout: 'auto',
        speech_end_timeout: 2000,
        input: ['speech', 'dtmf'],
        client_state: encodeState({ ...state, booking_id: bookingId, call_log_id: logId }),
      });
      break;
    }

    case 'call.gather.ended': {
      const speech: string = payload.speech || '';
      const digits: string = payload.digits || '';
      const reason: string = payload.reason || '';
      const step = state.step || 'ask_dayuse';
      const retryCount = state.retry_count || 0;

      console.log(`[gather] step=${step} speech="${speech}" digits=${digits} reason=${reason}`);

      // ─── STEP 1: Do you offer day-use plans? ───
      if (step === 'ask_dayuse') {
        const answer = classifyYesNo(speech, digits);

        if (answer === 'yes') {
          // → STEP 2A: Ask for price
          const checkIn = (state.check_in_date || 'the requested date').replace(/[^\x00-\x7F]/g, '').trim();
          const guests = state.guests || 1;
          const priceAsk = `Thank you! What is the rate for a day-use stay on ${checkIn} for ${guests} ${guests === 1 ? 'person' : 'people'}? You may say the amount in US dollars, or enter the amount on your keypad followed by the pound key. For example, 50 pound for fifty dollars, or 100 pound for one hundred dollars.`;

          if (db && logId) {
            await db.prepare(`UPDATE call_logs SET transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
              .bind(`[Hotel]: ${speech || 'pressed 1 (yes)'}\n[Agent]: ${priceAsk}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
          }

          await telnyxCmd(apiKey, callControlId, 'speak', {
            payload: priceAsk,
            voice: 'Polly.Joanna',
            client_state: encodeState({ ...state, step: 'ask_price', retry_count: 0 }),
          });

        } else if (answer === 'no') {
          // → STEP 2B: No day-use → record as potential partner
          const farewell = "Understood. We currently have guests seeking day-use stays in your area. We may follow up to discuss whether a day-use plan could work for your property. Thank you for your time. Goodbye!";

          if (db) {
            if (logId) {
              await db.prepare(`UPDATE call_logs SET status='no_dayuse', transcription = COALESCE(transcription||'\n','') || ?, note='potential_partner' WHERE id=?`)
                .bind(`[Hotel]: ${speech || 'pressed 2 (no)'}\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
            if (bookingId) {
              await db.prepare(`UPDATE bookings SET status='cancelled', updated_at=datetime('now') WHERE id=?`)
                .bind(bookingId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
          }

          await telnyxCmd(apiKey, callControlId, 'speak', {
            payload: farewell,
            voice: 'Polly.Joanna',
            client_state: encodeState({ ...state, phase: 'ending' }),
          });

        } else {
          // Timeout or unclear → retry
          if (retryCount >= 1) {
            await telnyxCmd(apiKey, callControlId, 'hangup', {});
            if (db && logId) {
              await db.prepare(`UPDATE call_logs SET status='no_answer' WHERE id=?`).bind(logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
          } else {
            await telnyxCmd(apiKey, callControlId, 'speak', {
              payload: "I'm sorry, I did not receive a response. If you offer day-use plans, press 1 or say yes. If not, press 2 or say no.",
              voice: 'Polly.Joanna',
              client_state: encodeState({ ...state, step: 'ask_dayuse', retry_count: retryCount + 1 }),
            });
          }
        }
        break;
      }

      // ─── STEP 2A-1: Price inquiry ───
      if (step === 'ask_price') {
        const hotelSaid = speech || '';
        // DTMF digits (e.g. "50#" → digits="50") take priority over speech
        const dtmfPrice = digits ? parseInt(digits.replace(/\D/g, ''), 10) : NaN;
        const priceResult = (!isNaN(dtmfPrice) && dtmfPrice > 0)
          ? { amount: dtmfPrice, raw: digits }
          : await aiExtractPrice(apiKey, hotelSaid);

        if (priceResult.amount && priceResult.amount > 0) {
          // Got price → confirm reservation
          const checkIn = (state.check_in_date || 'the requested date').replace(/[^\x00-\x7F]/g, '').trim();
          const guests = state.guests || 1;
          const confirmAsk = `Thank you. To confirm: ${checkIn}, ${guests} ${guests === 1 ? 'person' : 'people'}, at ${priceResult.amount} dollars. Shall we finalize this booking? Press 1 or say yes to confirm. Press 2 or say no to decline.`;

          if (db && logId) {
            await db.prepare(`UPDATE call_logs SET transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
              .bind(`[Hotel]: ${hotelSaid}\n[Agent]: ${confirmAsk}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
          }

          await telnyxCmd(apiKey, callControlId, 'speak', {
            payload: confirmAsk,
            voice: 'Polly.Joanna',
            client_state: encodeState({ ...state, step: 'confirm_booking', price_quoted: priceResult.amount, retry_count: 0 }),
          });

        } else {
          // Couldn't extract price → retry
          if (retryCount >= 1) {
            // 2 failures → give up, record what we have
            const farewell = "I sincerely apologize for the inconvenience. We were unable to confirm the price on this call. We truly appreciate your patience and your time. We will be in touch again soon. Thank you so much, and have a wonderful day. Goodbye!";
            if (db && logId) {
              await db.prepare(`UPDATE call_logs SET status='price_unclear', note='potential_partner', transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
                .bind(`[Hotel]: ${hotelSaid}\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
            await telnyxCmd(apiKey, callControlId, 'speak', {
              payload: farewell,
              voice: 'Polly.Joanna',
              client_state: encodeState({ ...state, phase: 'ending' }),
            });
          } else {
            await telnyxCmd(apiKey, callControlId, 'speak', {
              payload: "I'm sorry, could you repeat the price? You may say it, or enter the amount on your keypad followed by the pound key. For example, 50 pound for fifty dollars.",
              voice: 'Polly.Joanna',
              client_state: encodeState({ ...state, step: 'ask_price', retry_count: retryCount + 1 }),
            });
          }
        }
        break;
      }

      // ─── STEP 2A-2: Confirm booking ───
      if (step === 'confirm_booking') {
        const answer = classifyYesNo(speech, digits);
        const priceQuoted = state.price_quoted || 0;

        if (answer === 'yes') {
          // → Confirmed!
          const farewell = `Thank you! The reservation is confirmed at ${priceQuoted} dollars. Have a wonderful day!`;

          if (db) {
            if (logId) {
              await db.prepare(`UPDATE call_logs SET status='confirmed', price_quoted=?, transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
                .bind(priceQuoted, `[Hotel]: ${speech || 'pressed 1 (yes)'}\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
            if (bookingId) {
              await db.prepare(`UPDATE bookings SET status='confirmed', updated_at=datetime('now') WHERE id=?`)
                .bind(bookingId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
          }

          await telnyxCmd(apiKey, callControlId, 'speak', {
            payload: farewell,
            voice: 'Polly.Joanna',
            client_state: encodeState({ ...state, phase: 'ending' }),
          });

        } else if (answer === 'no') {
          // → Declined (but potential partner)
          const farewell = "Understood. We may reach out in the future to explore potential collaboration on day-use plans. Thank you for your time. Goodbye!";

          if (db) {
            if (logId) {
              await db.prepare(`UPDATE call_logs SET status='declined', note='potential_partner', price_quoted=?, transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
                .bind(priceQuoted, `[Hotel]: ${speech || 'pressed 2 (no)'}\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
            if (bookingId) {
              await db.prepare(`UPDATE bookings SET status='cancelled', updated_at=datetime('now') WHERE id=?`)
                .bind(bookingId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
          }

          await telnyxCmd(apiKey, callControlId, 'speak', {
            payload: farewell,
            voice: 'Polly.Joanna',
            client_state: encodeState({ ...state, phase: 'ending' }),
          });

        } else {
          // Timeout or unclear → retry
          if (retryCount >= 1) {
            await telnyxCmd(apiKey, callControlId, 'hangup', {});
            if (db && logId) {
              await db.prepare(`UPDATE call_logs SET status='no_answer' WHERE id=?`).bind(logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
          } else {
            await telnyxCmd(apiKey, callControlId, 'speak', {
              payload: "I'm sorry, I did not receive a response. Press 1 or say yes to confirm the reservation, or press 2 or say no to decline.",
              voice: 'Polly.Joanna',
              client_state: encodeState({ ...state, step: 'confirm_booking', retry_count: retryCount + 1 }),
            });
          }
        }
        break;
      }

      break;
    }

    case 'call.hangup': {
      if (db && logId) {
        const log: any = await db.prepare(`SELECT status FROM call_logs WHERE id=?`).bind(logId).first().catch(() => null);
        if (log && !['confirmed', 'declined', 'no_dayuse', 'price_unclear'].includes(log.status)) {
          await db.prepare(`UPDATE call_logs SET status='no_answer' WHERE id=?`).bind(logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
        }
      }
      break;
    }
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
