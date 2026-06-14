import type { APIRoute } from 'astro';
import { sendConciergeResultEmail, type ConciergeResultEmailType } from '../../../lib/email';
import { initiateNextGroupCall, processGroupRefund } from '../../../lib/tools';

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

function toAmPm(time: string | null): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h)) return time;
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 || 12;
  return m ? `${hour}:${String(m).padStart(2, '0')} ${period}` : `${hour} ${period}`;
}

// Classify yes/no/repeat from speech (button or voice)
function classifyYesNo(speech: string, digits: string): 'yes' | 'no' | 'repeat' | null {
  if (digits === '1') return 'yes';
  if (digits === '2') return 'no';
  if (digits === '3') return 'repeat';
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

  // Skip old-style concierge AI calls (handled by telnyx-ai-insights.ts)
  if (state.type === 'concierge') {
    console.log(`[telnyx-voice] Skipping old concierge AI call`);
    return new Response(JSON.stringify({ ok: true, skipped: 'concierge_ai_call' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const bookingId = state.booking_id ?? url.searchParams.get('bid') ?? url.searchParams.get('booking_id');
  const logId = state.call_log_id ?? url.searchParams.get('lid') ?? url.searchParams.get('log_id');
  const conciergeCallId = state.concierge_call_id ?? null;

  // Helper: update concierge_calls status in sync with call_logs
  async function updateConciergeCall(status: string, extra: Record<string, any> = {}) {
    if (!db || !conciergeCallId) return;
    const fields = Object.entries({ status, ...extra }).map(([k]) => `${k} = ?`).join(', ');
    const values = [...Object.values({ status, ...extra }), conciergeCallId];
    await db.prepare(`UPDATE concierge_calls SET ${fields}, updated_at = datetime('now') WHERE id = ?`)
      .bind(...values).run().catch((e: any) => console.error('[telnyx-voice] concierge update failed:', e));
  }

  async function sendResultEmailOnce(resultType: ConciergeResultEmailType) {
    if (!db || !conciergeCallId || !env?.RESEND_API_KEY) return;

    const call: any = await db.prepare(
      `SELECT id, call_group_id, guest_name, guest_email, hotel_name, hotel_phone, request_details, ai_summary, price_quoted
       FROM concierge_calls WHERE id = ?`
    ).bind(conciergeCallId).first().catch(() => null);
    if (!call?.guest_email) return;

    if (resultType === 'all_failed' && call.call_group_id) {
      const claim: any = await db.prepare(
        `UPDATE concierge_calls SET result_email_sent = 1, updated_at = datetime('now') WHERE call_group_id = ? AND result_email_sent = 0`
      ).bind(call.call_group_id).run().catch(() => null);
      if (Number(claim?.meta?.changes || 0) === 0) return;

      const attemptedRows: any[] = await db.prepare(
        `SELECT hotel_name FROM concierge_calls WHERE call_group_id = ? ORDER BY call_order ASC, id ASC`
      ).bind(call.call_group_id).all().then((r: any) => r?.results || []).catch(() => []);

      let details: any = {};
      try { details = JSON.parse(call.request_details || '{}'); } catch {}

      await sendConciergeResultEmail(env.RESEND_API_KEY, {
        guestName: call.guest_name || 'Guest',
        guestEmail: call.guest_email,
        resultType: 'all_failed',
        date: details.date || '',
        checkIn: details.check_in_time || '',
        checkOut: details.check_out_time || '',
        guests: details.guests || 1,
        aiSummary: call.ai_summary || undefined,
        attemptedHotels: attemptedRows.map((r: any) => r.hotel_name).filter(Boolean),
      }).catch((e: any) => console.error('[telnyx-voice] result email failed:', e));
      return;
    }

    const claim: any = await db.prepare(
      `UPDATE concierge_calls SET result_email_sent = 1, updated_at = datetime('now') WHERE id = ? AND result_email_sent = 0`
    ).bind(conciergeCallId).run().catch(() => null);
    if (Number(claim?.meta?.changes || 0) === 0) return;

    let details: any = {};
    try { details = JSON.parse(call.request_details || '{}'); } catch {}

    await sendConciergeResultEmail(env.RESEND_API_KEY, {
      guestName: call.guest_name || 'Guest',
      guestEmail: call.guest_email,
      resultType,
      hotelName: call.hotel_name || undefined,
      hotelPhone: call.hotel_phone || undefined,
      date: details.date || '',
      checkIn: details.check_in_time || '',
      checkOut: details.check_out_time || '',
      guests: details.guests || 1,
      priceQuoted: call.price_quoted || undefined,
      aiSummary: call.ai_summary || undefined,
    }).catch((e: any) => console.error('[telnyx-voice] result email failed:', e));
  }

  async function sendAdminConciergeBookedEmail() {
    if (!db || !conciergeCallId || !env?.RESEND_API_KEY || !env?.ADMIN_EMAIL) return;

    const call: any = await db.prepare(
      `SELECT id, guest_name, guest_email, hotel_name, hotel_phone, request_details, ai_summary, price_quoted
       FROM concierge_calls WHERE id = ?`
    ).bind(conciergeCallId).first().catch(() => null);
    if (!call) return;

    let details: any = {};
    try { details = JSON.parse(call.request_details || '{}'); } catch {}

    const payload = {
      from: 'DaydreamHub <noreply@daydreamhub.com>',
      to: [env.ADMIN_EMAIL],
      subject: `[AI Concierge] Booking confirmed - ${call.hotel_name || 'Unknown hotel'}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#111827">
          <h2 style="margin:0 0 16px">AI Concierge Booking Confirmed</h2>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Guest Name</td><td style="padding:8px;border:1px solid #e5e7eb">${call.guest_name || '-'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Guest Email</td><td style="padding:8px;border:1px solid #e5e7eb">${call.guest_email || '-'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Hotel</td><td style="padding:8px;border:1px solid #e5e7eb">${call.hotel_name || '-'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Hotel Phone</td><td style="padding:8px;border:1px solid #e5e7eb">${call.hotel_phone || '-'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Date</td><td style="padding:8px;border:1px solid #e5e7eb">${details.date || '-'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Check-in / Check-out</td><td style="padding:8px;border:1px solid #e5e7eb">${details.check_in_time || '-'} / ${details.check_out_time || '-'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Guests</td><td style="padding:8px;border:1px solid #e5e7eb">${details.guests || '-'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Price Quoted</td><td style="padding:8px;border:1px solid #e5e7eb">${call.price_quoted || '-'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">AI Summary</td><td style="padding:8px;border:1px solid #e5e7eb">${call.ai_summary || '-'}</td></tr>
          </table>
        </div>
      `,
    };

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).catch((e: any) => console.error('[telnyx-voice] admin concierge email failed:', e));
  }

  // Helper (Task #52): この通話がグループ発信の一部なら、結果に応じて次のホテルへ進める/成約確定する。
  // initiateNextGroupCall は current_order の条件付きUPDATEで冪等（二重発信を防止）。
  async function advanceGroupAfterOutcome(outcome: string) {
    if (!db || !conciergeCallId) return;
    let cc: any = null;
    try {
      cc = await db.prepare('SELECT call_group_id FROM concierge_calls WHERE id = ?').bind(conciergeCallId).first();
    } catch (e) { console.error('[telnyx-voice] group lookup failed:', e); }
    const groupId = cc?.call_group_id;
    if (!groupId) return; // 単発（非グループ）発信なら何もしない

    if (outcome === 'booked' || outcome === 'available') {
      // 成約 → グループを success に（次のホテルへは進めない）
      await db.prepare("UPDATE concierge_call_groups SET status = 'success', updated_at = datetime('now') WHERE id = ? AND status != 'success'")
        .bind(groupId).run().catch((e: any) => console.error('[telnyx-voice] group success update failed:', e));
      return;
    }

    // 不成立（unavailable / no_answer / voicemail 等）→ 次のホテルへフォールバック発信
    try {
      const next = await initiateNextGroupCall(env, db, groupId);
      console.log(`[telnyx-voice] advanceGroup group=${groupId} outcome=${outcome} →`, JSON.stringify(next));
      if (next?.status === 'all_failed') {
        await processGroupRefund(env, db, groupId).catch((e: any) => console.error('[telnyx-voice] group refund failed:', e));
        await sendResultEmailOnce('all_failed');
      }
    } catch (e) {
      console.error('[telnyx-voice] advanceGroup failed:', e);
    }
  }

  // Helper (Task #52): 案内読み上げ＋入力収集を一体化（バージイン対応）。
  // gather_using_speak は再生中でもDTMF押下を受け付け、押下で即 gather.ended になる＝早押し取りこぼしを防止。
  async function gatherUsingSpeak(stateObj: any, payload: string, isPriceStep = false) {
    const params: any = {
      payload,
      voice: 'Polly.Joanna',
      language: 'en-US',
      minimum_digits: 1,
      maximum_digits: isPriceStep ? 6 : 1,
      timeout_millis: isPriceStep ? 30000 : 20000,
      inter_digit_timeout_millis: 4000,
      client_state: encodeState(stateObj),
    };
    if (isPriceStep) params.terminating_digit = '#';
    return telnyxCmd(apiKey, callControlId, 'gather_using_speak', params);
  }

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
      await updateConciergeCall('calling');

      // ── OUTREACH PHASE ──────────────────────────────────────────────────────
      if (state.phase === 'outreach') {
        const greeting = "Hello! This is Sarah calling from DayDreamHub, a day-use hotel booking platform. We connect travelers with hotels that offer short daytime stays, and we'd love to list your property on our site — completely free to join. Are you interested in learning more? Press 1 or say yes. Press 2 or say no. Press 3 to hear this again.";
        if (db && logId) {
          await db.prepare(`UPDATE call_logs SET status='awaiting_response', telnyx_call_id=?, transcription=? WHERE id=?`)
            .bind(callControlId, `[Agent]: ${greeting}`, logId).run().catch(e => console.error('[telnyx-voice] DB err:', e));
        }
        await gatherUsingSpeak({ ...state, step: 'outreach_ask_interest' }, greeting);
        break;
      }

      // STEP 1: Introduce DayDreamHub + ask about day-use availability
      const checkIn = (state.check_in_date || state.date || 'the requested date');
      const guests = state.guests || 1;
      const checkInTime = state.check_in_time || state.check_in || null;
      const checkOutTime = state.check_out_time || state.check_out || null;
      const timeInfo = checkInTime && checkOutTime
        ? ` from ${toAmPm(checkInTime)} to ${toAmPm(checkOutTime)}`
        : '';

      const greeting = `Hello, this is DayDreamHub, a booking platform that connects hotels with travelers seeking day-use accommodations. We have a guest looking to book a day-use stay on ${checkIn}${timeInfo}, for ${guests} ${guests === 1 ? 'person' : 'people'}. Do you offer day-use plans? Press 1 or say yes. Press 2 or say no. Press 3 to hear this again.`;

      if (db && logId) {
        await db.prepare(`UPDATE call_logs SET status='awaiting_response', telnyx_call_id=?, transcription=? WHERE id=?`)
          .bind(callControlId, `[Agent]: ${greeting}`, logId).run().catch(e => console.error('DB err:', e));
      }

      await gatherUsingSpeak({ ...state, step: 'ask_dayuse', booking_id: bookingId, call_log_id: logId }, greeting);
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
      const gatherParams: any = {
        maximum_digits: isPriceStep ? 6 : 1,
        minimum_digits: 1,
        timeout_millis: isPriceStep ? 20000 : 15000,
        speech_timeout: 'auto',
        speech_end_timeout: 2000,
        input: ['dtmf', 'speech'],
        language: 'en-US',
        profanity_filter: false,
        client_state: encodeState({ ...state, booking_id: bookingId, call_log_id: logId }),
      };
      if (isPriceStep) gatherParams.terminating_digit = '#';
      console.log(`[telnyx-voice] gather sent: step=${state.step} isPriceStep=${isPriceStep}`);
      await telnyxCmd(apiKey, callControlId, 'gather', gatherParams);
      break;
    }

    case 'call.gather.ended': {
      const speech: string = payload.speech || '';
      const digits: string = payload.digits || '';
      const reason: string = payload.reason || '';
      const step = state.step || 'ask_dayuse';
      const retryCount = state.retry_count || 0;

      console.log(`[gather] step=${step} speech="${speech}" digits=${digits} reason=${reason}`);

      // Task #52: 入力内容（digits/speech/reason）を調査用に call_logs.note へ記録
      if (db && logId) {
        await db.prepare(`UPDATE call_logs SET note = COALESCE(note||' | ','') || ? WHERE id = ?`)
          .bind(`input[step=${step},digits=${digits || '-'},speech=${(speech || '-').slice(0, 60)},reason=${reason || '-'}]`, logId)
          .run().catch(e => console.error('[telnyx-voice] input log failed:', e));
      }

      // ─── OUTREACH: Are you interested in being listed? ───
      if (step === 'outreach_ask_interest') {
        const answer = classifyYesNo(speech, digits);

        if (answer === 'repeat') {
          await gatherUsingSpeak({ ...state, step: 'outreach_ask_interest' }, "DayDreamHub is a day-use hotel booking platform. We connect travelers with hotels that offer short daytime stays. Listing your property is free. Are you interested? Press 1 or say yes. Press 2 or say no.");
        } else if (answer === 'yes') {
          const farewell = "Wonderful! Our team will follow up with more details shortly. Thank you so much for your time, and we look forward to working with you. Goodbye!";
          if (db) {
            if (logId) {
              await db.prepare(`UPDATE call_logs SET status='confirmed', transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
                .bind(`[Hotel]: ${speech || 'pressed 1 (yes)'}\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB err:', e));
            }
            if (state.lead_id) {
              await db.prepare(`UPDATE outreach_leads SET status='interested', updated_at=datetime('now') WHERE id=?`)
                .bind(state.lead_id).run().catch(e => console.error('[telnyx-voice] outreach lead update failed:', e));
            }
          }
          await telnyxCmd(apiKey, callControlId, 'speak', {
            payload: farewell,
            voice: 'Polly.Joanna',
            client_state: encodeState({ ...state, phase: 'ending' }),
          });
        } else if (answer === 'no') {
          const farewell = "No problem at all. Thank you for your time. If you ever change your mind, feel free to visit daydreamhub.com. Have a great day. Goodbye!";
          if (db) {
            if (logId) {
              await db.prepare(`UPDATE call_logs SET status='declined', transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
                .bind(`[Hotel]: ${speech || 'pressed 2 (no)'}\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB err:', e));
            }
            if (state.lead_id) {
              await db.prepare(`UPDATE outreach_leads SET status='not_interested', updated_at=datetime('now') WHERE id=?`)
                .bind(state.lead_id).run().catch(e => console.error('[telnyx-voice] outreach lead update failed:', e));
            }
          }
          await telnyxCmd(apiKey, callControlId, 'speak', {
            payload: farewell,
            voice: 'Polly.Joanna',
            client_state: encodeState({ ...state, phase: 'ending' }),
          });
        } else {
          if (retryCount >= 1) {
            await telnyxCmd(apiKey, callControlId, 'hangup', {});
            if (db && logId) {
              await db.prepare(`UPDATE call_logs SET status='no_answer' WHERE id=?`).bind(logId).run().catch(e => console.error('[telnyx-voice] DB err:', e));
            }
            if (db && state.lead_id) {
              await db.prepare(`UPDATE outreach_leads SET status='no_answer', updated_at=datetime('now') WHERE id=?`)
                .bind(state.lead_id).run().catch(e => console.error('[telnyx-voice] outreach lead update failed:', e));
            }
          } else {
            await gatherUsingSpeak({ ...state, step: 'outreach_ask_interest', retry_count: retryCount + 1 }, "I'm sorry, I didn't catch that. Press 1 or say yes if you're interested in listing your property on DayDreamHub for free. Press 2 or say no if you're not interested.");
          }
        }
        break;
      }

      // ─── STEP 1: Do you offer day-use plans? ───
      if (step === 'ask_dayuse') {
        const answer = classifyYesNo(speech, digits);

        if (answer === 'repeat') {
          const checkIn = (state.check_in_date || state.date || 'the requested date');
          const guests = state.guests || 1;
          const checkInTime = state.check_in_time || state.check_in || null;
          const checkOutTime = state.check_out_time || state.check_out || null;
          const timeInfo = checkInTime && checkOutTime ? ` from ${toAmPm(checkInTime)} to ${toAmPm(checkOutTime)}` : '';
          await gatherUsingSpeak({ ...state, step: 'ask_dayuse' }, `We have a guest looking to book a day-use stay on ${checkIn}${timeInfo}, for ${guests} ${guests === 1 ? 'person' : 'people'}. Do you offer day-use plans? Press 1 or say yes. Press 2 or say no. Press 3 to hear this again.`);
        } else if (answer === 'yes') {
          // → STEP 2A: Ask for price
          const checkIn = (state.check_in_date || state.date || 'the requested date');
          const guests = state.guests || 1;
          const checkInTime = state.check_in_time || state.check_in || null;
          const checkOutTime = state.check_out_time || state.check_out || null;
          const timeInfo = checkInTime && checkOutTime ? ` from ${checkInTime} to ${checkOutTime}` : '';
          const priceAsk = `Thank you! What is the rate for a day-use stay on ${checkIn}${timeInfo} for ${guests} ${guests === 1 ? 'person' : 'people'}? Please note, you must provide the final total amount in US dollars, including all service fees and taxes. For example, say fifty dollars. Or enter the number on your keypad and press the hash key when done. Press 3 to hear this again.`;

          if (db && logId) {
            await db.prepare(`UPDATE call_logs SET transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
              .bind(`[Hotel]: ${speech || 'pressed 1 (yes)'}\n[Agent]: ${priceAsk}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
          }

          await gatherUsingSpeak({ ...state, step: 'ask_price', retry_count: 0 }, priceAsk, true);

        } else if (answer === 'no') {
          // → STEP 2B: No day-use → record as potential partner
          const farewell = "Understood. We currently have guests seeking day-use stays in your area. We may follow up to discuss whether a day-use plan could work for your property. Thank you for your time. Goodbye!";

          if (db) {
            if (logId) {
              await db.prepare(`UPDATE call_logs SET status='no_dayuse', transcription = COALESCE(transcription||'\n','') || ?, note='potential_partner' WHERE id=?`)
                .bind(`[Hotel]: ${speech || 'pressed 2 (no)'}\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
              await updateConciergeCall('completed', { outcome: 'unavailable', ai_summary: 'Hotel does not offer day-use plans.' });
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
          await sendResultEmailOnce('declined');
          // Task #52: グループ発信なら次のホテルへ
          await advanceGroupAfterOutcome('unavailable');

        } else {
          // Timeout or unclear → retry
          if (retryCount >= 1) {
            await telnyxCmd(apiKey, callControlId, 'hangup', {});
            if (db && logId) {
              await db.prepare(`UPDATE call_logs SET status='no_answer' WHERE id=?`).bind(logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
            await updateConciergeCall('completed', { outcome: 'no_answer', ai_summary: 'No clear response to day-use question.' });
            await sendResultEmailOnce('no_answer');
            // Task #52: グループ発信なら次のホテルへ
            await advanceGroupAfterOutcome('no_answer');
          } else {
            await gatherUsingSpeak({ ...state, step: 'ask_dayuse', retry_count: retryCount + 1 }, "I'm sorry, I did not receive a response. If you offer day-use plans, press 1 or say yes. If not, press 2 or say no.");
          }
        }
        break;
      }

      // ─── STEP 2A-1: Price inquiry ───
      if (step === 'ask_price') {
        if (digits === '3') {
          const checkIn = (state.check_in_date || state.date || 'the requested date');
          const guests = state.guests || 1;
          const checkInTimeR = state.check_in_time || state.check_in || null;
          const checkOutTimeR = state.check_out_time || state.check_out || null;
          const timeInfoR = checkInTimeR && checkOutTimeR ? ` from ${toAmPm(checkInTimeR)} to ${toAmPm(checkOutTimeR)}` : '';
          await gatherUsingSpeak({ ...state, step: 'ask_price' }, `What is the rate for a day-use stay on ${checkIn}${timeInfoR} for ${guests} ${guests === 1 ? 'person' : 'people'}? Please note, you must provide the final total amount in US dollars, including all service fees and taxes. For example, say fifty dollars. Or enter the number on your keypad and press the hash key when done. Press 3 to hear this again.`, true);
          break;
        }
        const hotelSaid = speech || '';
        // DTMF digits (e.g. "50#" → digits="50") take priority over speech
        const dtmfPrice = digits ? parseInt(digits.replace(/\D/g, ''), 10) : NaN;
        const priceResult = (!isNaN(dtmfPrice) && dtmfPrice > 0)
          ? { amount: dtmfPrice, raw: digits }
          : await aiExtractPrice(apiKey, hotelSaid);

        if (priceResult.amount && priceResult.amount > 0) {
          // Got price → confirm reservation
          const checkIn = (state.check_in_date || state.date || 'the requested date');
          const guests = state.guests || 1;
          const checkInTime = state.check_in_time || state.check_in || null;
          const checkOutTime = state.check_out_time || state.check_out || null;
          const confirmAsk = `To confirm your reservation: The date is ${checkIn}, time is ${toAmPm(checkInTime)} to ${toAmPm(checkOutTime)}, for ${guests} ${guests === 1 ? 'person' : 'people'}. The final total amount including taxes and fees is ${priceResult.amount} dollars, to be paid on-site at check-in. If you agree to all these details and confirm the booking, press 1 or say yes. To decline, press 2 or say no.`;

          if (db && logId) {
            await db.prepare(`UPDATE call_logs SET transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
              .bind(`[Hotel]: ${hotelSaid}\n[Agent]: ${confirmAsk}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
          }

          await gatherUsingSpeak({ ...state, step: 'confirm_booking', price_quoted: priceResult.amount, retry_count: 0 }, confirmAsk);

        } else {
          // Couldn't extract price → retry
          if (retryCount >= 1) {
            // 2 failures → give up, record what we have
            const farewell = "I sincerely apologize for the inconvenience. We were unable to confirm the price on this call. We truly appreciate your patience and your time. We will be in touch again soon. Thank you so much, and have a wonderful day. Goodbye!";
            if (db && logId) {
              await db.prepare(`UPDATE call_logs SET status='price_unclear', note='potential_partner', transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
                .bind(`[Hotel]: ${hotelSaid}\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
            await updateConciergeCall('completed', { outcome: 'unavailable', ai_summary: 'Could not confirm price on call.' });
            await sendResultEmailOnce('declined');
            await telnyxCmd(apiKey, callControlId, 'speak', {
              payload: farewell,
              voice: 'Polly.Joanna',
              client_state: encodeState({ ...state, phase: 'ending' }),
            });
            // Task #52: グループ発信なら次のホテルへ
            await advanceGroupAfterOutcome('unavailable');
          } else {
            await gatherUsingSpeak({ ...state, step: 'ask_price', retry_count: retryCount + 1 }, "I'm sorry, could you repeat the rate for this day-use stay? Please note, it must be the final total amount in US dollars, including all service fees and taxes. You can say the amount, or enter the number on your keypad and press the hash key when done.", true);
          }
        }
        break;
      }

      // ─── STEP 2A-2: Confirm booking (single-shot 4-point consent) ───
      if (step === 'confirm_booking') {
        const answer = classifyYesNo(speech, digits);
        const priceQuoted = state.price_quoted || 0;
        const checkIn = (state.check_in_date || state.date || 'the requested date');
        const checkInTime = state.check_in_time || state.check_in || null;
        const checkOutTime = state.check_out_time || state.check_out || null;
        const guests = state.guests || 1;

        if (answer === 'repeat') {
          await gatherUsingSpeak(
            { ...state, step: 'confirm_booking' },
            `To confirm your reservation: The date is ${checkIn}, time is ${toAmPm(checkInTime)} to ${toAmPm(checkOutTime)}, for ${guests} ${guests === 1 ? 'person' : 'people'}. The final total amount including taxes and fees is ${priceQuoted} dollars, to be paid on-site at check-in. If you agree to all these details and confirm the booking, press 1 or say yes. To decline, press 2 or say no.`
          );
          break;
        }

        if (answer === 'no') {
          const farewell = "Understood. We cannot finalize the booking without full agreement. Thank you for your time. Goodbye!";
          if (db) {
            if (logId) {
              await db.prepare(`UPDATE call_logs SET status='declined', note='consent_missing', price_quoted=?, transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
                .bind(priceQuoted, `[Hotel]: ${speech || 'pressed 2 (no)'}\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
            await updateConciergeCall('completed', {
              outcome: 'unavailable',
              price_quoted: String(priceQuoted),
              ai_summary: 'Declined during bundled final confirmation.',
            });
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
          await sendResultEmailOnce('declined');
          await advanceGroupAfterOutcome('unavailable');
          break;
        }

        if (answer !== 'yes') {
          if (retryCount >= 1) {
            await telnyxCmd(apiKey, callControlId, 'hangup', {});
            if (db && logId) {
              await db.prepare(`UPDATE call_logs SET status='no_answer' WHERE id=?`).bind(logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
            await updateConciergeCall('completed', { outcome: 'no_answer', ai_summary: 'No clear response during bundled final confirmation.' });
            await sendResultEmailOnce('no_answer');
            await advanceGroupAfterOutcome('no_answer');
          } else {
            await gatherUsingSpeak({ ...state, step: 'confirm_booking', retry_count: retryCount + 1 }, "I'm sorry, I did not receive a response. Press 1 or say yes to agree, or press 2 or say no to decline.");
          }
          break;
        }

        // yes -> set all 4 consents immediately and finalize booking
        await updateConciergeCall('calling', {
          consent_price: 1,
          consent_date: 1,
          consent_time: 1,
          consent_onsite_payment: 1,
          price_quoted: String(priceQuoted),
        });

        let guestName = state.guest_name || 'the guest';
        if (db && conciergeCallId) {
          const guestInfo: any = await db.prepare(
            `SELECT guest_name FROM concierge_calls WHERE id = ?`
          ).bind(conciergeCallId).first().catch(() => null);
          if (guestInfo?.guest_name) guestName = guestInfo.guest_name;
        }

        const farewell = `Thank you! All consent checks are complete. The reservation is confirmed at a final total of ${priceQuoted} dollars, including service fees and taxes, with payment at the hotel. We will send a follow-up confirmation email shortly with all the details. For your immediate records, the guest's name is ${guestName}. Have a wonderful day!`;
        if (db) {
          if (logId) {
            await db.prepare(`UPDATE call_logs SET status='confirmed', price_quoted=?, transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
              .bind(priceQuoted, `[Hotel]: ${speech || 'pressed 1 (yes)'}\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
          }
          await updateConciergeCall('completed', {
            outcome: 'booked',
            consent_price: 1,
            consent_date: 1,
            consent_time: 1,
            consent_onsite_payment: 1,
            price_quoted: String(priceQuoted),
            ai_summary: `Confirmed at final total $${priceQuoted} (including taxes and fees) with bundled 4-point consent accepted.`,
          });
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
        await sendResultEmailOnce('success');
        await sendAdminConciergeBookedEmail();
        await advanceGroupAfterOutcome('booked');
        break;
      }

      break;
    }

    case 'call.hangup': {
      if (db && logId) {
        const log: any = await db.prepare(`SELECT status FROM call_logs WHERE id=?`).bind(logId).first().catch(() => null);
        // 'no_answer' も除外: gather分岐で既に no_answer 設定＋フォールバック済みのケースを二重実行しない（冪等性）
        if (log && !['confirmed', 'declined', 'no_dayuse', 'price_unclear', 'no_answer'].includes(log.status)) {
          await db.prepare(`UPDATE call_logs SET status='no_answer' WHERE id=?`).bind(logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
          await updateConciergeCall('completed', { outcome: 'no_answer', ai_summary: 'No answer or call disconnected.' });
          await sendResultEmailOnce('no_answer');
          // Task #52: 応答前に切断された純粋な no_answer のみ、ここでフォールバック発信
          await advanceGroupAfterOutcome('no_answer');
        }
        // Outreach: mark lead as no_answer if still in new/calling state
        if (state.phase === 'outreach' && state.lead_id) {
          const lead: any = await db.prepare(`SELECT status FROM outreach_leads WHERE id=?`).bind(state.lead_id).first().catch(() => null);
          if (lead && !['interested', 'not_interested'].includes(lead.status)) {
            await db.prepare(`UPDATE outreach_leads SET status='no_answer', updated_at=datetime('now') WHERE id=?`)
              .bind(state.lead_id).run().catch(e => console.error('[telnyx-voice] outreach lead hangup update failed:', e));
          }
        }
      } else if (conciergeCallId) {
        const cc: any = await db?.prepare(`SELECT outcome FROM concierge_calls WHERE id = ?`).bind(conciergeCallId).first().catch(() => null);
        if (!['booked', 'available', 'success'].includes(String(cc?.outcome || ''))) {
          await updateConciergeCall('completed', { outcome: 'no_answer', ai_summary: 'No answer or call disconnected.' });
          await sendResultEmailOnce('no_answer');
        }
      }
      break;
    }
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
