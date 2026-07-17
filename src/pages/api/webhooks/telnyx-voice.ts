import type { APIRoute } from 'astro';
import { sendConciergeResultEmail, type ConciergeResultEmailType } from '../../../lib/email';
import { initiateNextGroupCall, processGroupRefund } from '../../../lib/tools';

async function telnyxCmd(apiKey: string, callControlId: string, cmd: string, body: any = {}, maxRetries = 2): Promise<boolean> {
  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/${cmd}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      const reqPreview = JSON.stringify(body || {}).slice(0, 220);
      console.log(`[telnyxCmd] cmd=${cmd} attempt=${attempt + 1} status=${res.status} req=${reqPreview} res=${text.slice(0, 220)}`);
      if (res.ok) return true;

      lastError = `status=${res.status} body=${text.slice(0, 300)}`;
      if (!(res.status >= 500 || res.status === 429 || res.status === 408)) break;
    } catch (e: any) {
      lastError = e?.message || 'fetch_failed';
      console.error(`[telnyxCmd] cmd=${cmd} attempt=${attempt + 1} error=${lastError}`);
    }
    if (attempt < maxRetries) await sleep(300 * (attempt + 1));
  }
  console.error(`[telnyxCmd] cmd=${cmd} failed ctrl=${(callControlId || '').slice(0, 20)} err=${lastError}`);
  return false;
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

function deepGet(obj: any, path: string): any {
  return path.split('.').reduce((acc: any, key) => {
    if (acc == null) return undefined;
    if (key.endsWith(']')) {
      const m = key.match(/^(\w+)\[(\d+)\]$/);
      if (!m) return undefined;
      const arr = acc[m[1]];
      return Array.isArray(arr) ? arr[Number(m[2])] : undefined;
    }
    return acc[key];
  }, obj);
}

function pickFirstString(obj: any, paths: string[]): string {
  for (const p of paths) {
    const v = deepGet(obj, p);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function pickStringArray(obj: any, paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const v = deepGet(obj, p);
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string' && item.trim()) out.push(item.trim());
        if (item && typeof item === 'object') {
          const nested = ['url', 'media_url', 'recording_url', 'download_url', 'href']
            .map((k) => (typeof (item as any)[k] === 'string' ? (item as any)[k].trim() : ''))
            .filter(Boolean);
          out.push(...nested);
        }
      }
    }
  }
  return [...new Set(out)];
}

function localClassifyShortIntent(text: string, context: 'outreach_interest' | 'ask_dayuse' | 'confirm_booking' | 'ask_price'): HybridIntent | null {
  const normalized = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const affirmWords = new Set(['yes', 'yeah', 'yep', 'correct', 'sure', 'ok', 'okay', 'affirmative']);
  const denyWords = new Set(['no', 'nope', 'nah', 'negative']);
  const repeatWords = new Set(['repeat', 'again', 'pardon', 'sorry', 'what']);
  const fillerWords = new Set(['hello', 'hi', 'hey', 'test', 'testing']);

  const words = normalized.split(' ').filter(Boolean);
  if (words.length <= 3) {
    if (words.some((w) => repeatWords.has(w))) return 'repeat';
    if (words.some((w) => affirmWords.has(w))) return 'affirm';
    if (words.some((w) => denyWords.has(w))) return 'deny';
    if (context === 'ask_price') {
      const amount = normalized.match(/\b(\d{1,6})\b/);
      if (amount) return 'price';
    }
    if (words.every((w) => fillerWords.has(w))) return 'unclear';
  }

  return null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSpeechFromUrls(apiKey: string, urls: string[], callControlId: string): Promise<{ speech: string; source: string | null; attempts: string[] }> {
  const attempts: string[] = [];
  const extractSpeech = (obj: any): string => {
    if (!obj || typeof obj !== 'object') return '';
    const direct = pickFirstString(obj, [
      'speech', 'text', 'transcript', 'data.transcript', 'data.text',
      'result.transcript', 'result.text', 'results[0].transcript',
      'results[0].alternatives[0].transcript', 'alternatives[0].transcript'
    ]);
    if (direct) return direct;
    return '';
  };

  for (const url of urls) {
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        attempts.push(`url=${url} try=${i + 1} status=${res.status}`);
        if (!res.ok) {
          if (res.status >= 500 || res.status === 429) {
            await sleep(250 * (i + 1));
            continue;
          }
          break;
        }

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
          const data: any = await res.json().catch(() => null);
          const speech = extractSpeech(data);
          if (speech) return { speech, source: url, attempts };
        } else {
          const text = (await res.text().catch(() => '')).trim();
          if (text && text.length <= 500) return { speech: text, source: url, attempts };
        }
      } catch (e: any) {
        attempts.push(`url=${url} try=${i + 1} error=${e?.message || 'fetch_error'}`);
      }
      await sleep(250 * (i + 1));
    }
  }

  console.log(`[telnyx-voice] speech fetch failed ctrl=${(callControlId || '').slice(0, 16)} urls=${urls.length} attempts=${attempts.join('; ')}`);
  return { speech: '', source: null, attempts };
}

// AI to extract price from hotel's spoken response
async function aiExtractPrice(apiKey: string, hotelSaid: string): Promise<{ amount: number | null; raw: string }> {
  try {
    const r = await fetch('https://api.telnyx.com/v2/ai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-5.5-instant',
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

function formatPhoneForSpeech(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'not provided';
  const chars = s.replace(/[^\d+]/g, '').split('');
  if (!chars.length) return 'not provided';
  return chars.map((ch) => (ch === '+' ? 'plus' : ch)).join(' ');
}

function formatEmailForSpeech(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'not provided';
  return s
    .replace(/@/g, ' at ')
    .replace(/\./g, ' dot ')
    .replace(/[_-]/g, (m) => (m === '_' ? ' underscore ' : ' dash '))
    .replace(/\+/g, ' plus ')
    .replace(/\s+/g, ' ')
    .trim();
}

type HybridIntent = 'affirm' | 'deny' | 'repeat' | 'price' | 'unclear';

async function aiClassifyIntent(
  apiKey: string,
  speech: string,
  digits: string,
  context: 'outreach_interest' | 'ask_dayuse' | 'confirm_booking' | 'ask_price'
): Promise<{ intent: HybridIntent; amount?: number | null; raw?: string }> {
  // Fast deterministic path for DTMF (most reliable across handset types)
  if (context !== 'ask_price') {
    if (digits === '1') return { intent: 'affirm' };
    if (digits === '2') return { intent: 'deny' };
    if (digits === '3') return { intent: 'repeat' };
    if (/^\d{1,6}$/.test((digits || '').trim())) {
      const amount = parseInt((digits || '').trim(), 10);
      if (!isNaN(amount) && amount > 0) return { intent: 'price', amount, raw: digits };
    }
  }

  if (context === 'ask_price') {
    const amount = digits ? parseInt(digits.replace(/\D/g, ''), 10) : NaN;
    if (!isNaN(amount) && amount > 0) return { intent: 'price', amount, raw: digits };
  }

  // Local deterministic path for short words (no LLM dependency)
  const localIntent = localClassifyShortIntent(speech, context);
  if (localIntent) {
    if (localIntent === 'price') {
      const localAmount = speech.match(/\b(\d{1,6})\b/);
      const parsed = localAmount ? parseInt(localAmount[1], 10) : null;
      return { intent: 'price', amount: parsed, raw: speech };
    }
    return { intent: localIntent, raw: speech };
  }

  // If no speech, classify as unclear quickly.
  if (!speech?.trim()) return { intent: 'unclear' };

  try {
    const r = await fetch('https://api.telnyx.com/v2/ai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-5.5-instant',
        messages: [
          {
            role: 'system',
            content:
              'You classify spoken responses from hotel staff in a phone call. Return JSON only with schema: {"intent":"affirm|deny|repeat|price|unclear","amount":number|null,"raw":"string"}. Use context to disambiguate. intent=price when user provides or corrects a numeric amount in USD. For yes/no style confirmations, use affirm/deny. If uncertain, use unclear.'
          },
          {
            role: 'user',
            content: JSON.stringify({ context, speech, digits })
          },
        ],
        max_tokens: 90,
        temperature: 0,
      }),
    });
    const d: any = await r.json();
    const content = d.choices?.[0]?.message?.content || '';
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      const intent = (parsed.intent || 'unclear') as HybridIntent;
      const amount = typeof parsed.amount === 'number' ? parsed.amount : null;
      return { intent, amount, raw: parsed.raw || speech };
    }
  } catch (e) {
    console.error('AI intent classify error:', e);
  }

  // Fallback when LLM output is unavailable
  const amountMatch = speech.match(/(\d{1,6})/);
  if (amountMatch) return { intent: 'price', amount: parseInt(amountMatch[1], 10), raw: amountMatch[1] };
  return { intent: 'unclear' };
}

function getOutreachScript(variant: string | undefined) {
  const code = String(variant || 'A').toUpperCase();
  if (code === 'B') {
    return {
      opening: 'Hi, this is Sarah from DayDreamHub. We help hotels get incremental daytime bookings at no listing cost. If you want our intro materials, press 1. If you prefer a short explanation call from our team, press 2. You can also answer by voice.',
      followup: 'Great, thanks. Press 1 for materials, or press 2 for a follow-up explanation call.',
    };
  }
  return {
    opening: 'Hello! This is Sarah calling from DayDreamHub, a day-use hotel booking platform. We connect travelers with hotels that offer short daytime stays. Listing is completely free — we only charge a 10% commission per booking. If you would like our materials, press 1. If you would like a follow-up explanation call, press 2. You can also answer by voice.',
    followup: 'Thank you. To help us route correctly, press 1 for materials or press 2 for a follow-up explanation call.',
  };
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
  const callSessionId: string = payload.call_session_id || '';
  const unifiedCallId: string = callSessionId || callControlId || '';
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

  function buildGatherParams(stateObj: any, isPriceStep = false) {
    const gatherParams: any = {
      maximum_digits: isPriceStep ? 6 : 1,
      minimum_digits: 1,
      timeout_millis: isPriceStep ? 60000 : 45000,
      inter_digit_timeout_millis: isPriceStep ? 7000 : 6000,
      speech_timeout: 'auto',
      speech_end_timeout: 3200,
      input: ['speech', 'dtmf'],
      language: 'en-US',
      profanity_filter: false,
      client_state: encodeState({ ...stateObj, booking_id: bookingId, call_log_id: logId }),
    };
    if (isPriceStep) gatherParams.terminating_digit = '#';
    return gatherParams;
  }

  async function safeHangup(reason: string) {
    const ok = await telnyxCmd(apiKey, callControlId, 'hangup', {});
    if (!ok) console.error(`[telnyx-voice] hangup failed reason=${reason} ctrl=${(callControlId || '').slice(0, 16)}`);
  }

  // Telnyx推奨フロー: speak -> call.speak.ended -> gather
  async function gatherUsingSpeak(stateObj: any, payload: string, isPriceStep = false) {
    const nextState = {
      ...stateObj,
      booking_id: bookingId,
      call_log_id: logId,
      force_gather_after_speak: true,
      gather_is_price_step: !!isPriceStep,
    };
    const okSpeak = await telnyxCmd(apiKey, callControlId, 'speak', {
      payload,
      voice: 'Polly.Joanna',
      language: 'en-US',
      client_state: encodeState(nextState),
    });

    if (okSpeak) return true;

    // speak失敗時のフォールバック: 即gatherを試み、失敗時は安全に切断
    const okGatherFallback = await telnyxCmd(apiKey, callControlId, 'gather', buildGatherParams(nextState, isPriceStep));
    if (!okGatherFallback) await safeHangup('speak_and_gather_failed');
    return okGatherFallback;
  }

  async function setOutreachAttemptOutcome(outcome: string, rawReason = '') {
    if (!db || !logId) return;
    await db.prepare(`UPDATE outreach_call_attempts SET outcome=?, raw_hangup_reason=COALESCE(NULLIF(?,''), raw_hangup_reason), updated_at=datetime('now') WHERE call_log_id=?`)
      .bind(outcome, rawReason, logId)
      .run().catch((e: any) => console.error('[telnyx-voice] outreach attempt update failed:', e));
  }

  async function updateOutreachLead(status: string, opts: { needsRecall?: number; doNotCall?: number; materials?: number; explanation?: number } = {}) {
    if (!db || !state.lead_id) return;
    await db.prepare(`UPDATE outreach_leads
      SET status=?,
          needs_recall=COALESCE(?, needs_recall),
          do_not_call=COALESCE(?, do_not_call),
          requested_materials=COALESCE(?, requested_materials),
          requested_explanation=COALESCE(?, requested_explanation),
          updated_at=datetime('now')
      WHERE id=?`)
      .bind(status, opts.needsRecall ?? null, opts.doNotCall ?? null, opts.materials ?? null, opts.explanation ?? null, state.lead_id)
      .run().catch((e: any) => console.error('[telnyx-voice] outreach lead update failed:', e));
  }

  console.log(`[${eventType}] ctrl=${callControlId.slice(0, 16)} sid=${callSessionId.slice(0, 16)} bid=${bookingId} lid=${logId} step=${state.step} phase=${state.phase}`);
  const payloadKeys = Object.keys(payload || {});
  console.log(`[telnyx-voice] payload keys(${eventType}): ${payloadKeys.slice(0, 40).join(',')}`);

  // Record every event in DB
  if (db && logId) {
    await db.prepare(`UPDATE call_logs SET note = COALESCE(note||',','') || ? WHERE id = ?`)
      .bind(eventType, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
  }

  switch (eventType) {

    case 'call.initiated': {
      if (db && logId) {
        await db.prepare(`UPDATE call_logs SET telnyx_call_id=? WHERE id=?`)
          .bind(unifiedCallId, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
        await db.prepare(`UPDATE outreach_call_attempts SET telnyx_call_id=?, updated_at=datetime('now') WHERE call_log_id=?`)
          .bind(unifiedCallId, logId).run().catch(() => {});
      }
      break;
    }

    case 'call.answered': {
      await updateConciergeCall('calling');

      // ── OUTREACH PHASE ──────────────────────────────────────────────────────
      if (state.phase === 'outreach') {
        const script = getOutreachScript(state.script_variant);
        const greeting = script.opening;
        if (db && logId) {
          await db.prepare(`UPDATE call_logs SET status='awaiting_response', telnyx_call_id=?, transcription=? WHERE id=?`)
            .bind(unifiedCallId, `[Agent]: ${greeting}`, logId).run().catch(e => console.error('[telnyx-voice] DB err:', e));
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
          .bind(unifiedCallId, `[Agent]: ${greeting}`, logId).run().catch(e => console.error('DB err:', e));
      }

      await gatherUsingSpeak({ ...state, step: 'ask_dayuse', booking_id: bookingId, call_log_id: logId }, greeting);
      break;
    }

    case 'call.speak.ended': {
      const phase = state.phase || '';
      if (phase === 'ending') {
        await safeHangup('ending_phase');
        break;
      }

      if (state?.force_gather_after_speak) {
        const isPriceStep = !!state.gather_is_price_step || state.step === 'ask_price' || state.step === 'confirm_booking';
        const gatherParams = buildGatherParams(state, isPriceStep);
        console.log(`[telnyx-voice] gather after speak.ended step=${state.step} isPriceStep=${isPriceStep}`);
        const ok = await telnyxCmd(apiKey, callControlId, 'gather', gatherParams);
        if (!ok) await safeHangup('gather_after_speak_failed');
      } else {
        console.log(`[telnyx-voice] speak ended without gather step=${state.step || '-'} phase=${phase || '-'}`);
      }
      break;
    }

    case 'call.gather.ended': {
      const speechPaths = [
        'speech', 'transcription', 'text',
        'result.speech', 'result.transcription', 'result.text',
        'gather_result.speech', 'gather_result.transcription',
        'speech_result.transcript', 'speech_results[0].transcript',
        'transcription_data.transcript', 'media.transcript',
        'recording.transcript', 'analysis.transcript'
      ];
      const digitsPaths = ['digits', 'dtmf', 'digit', 'gather_result.digits', 'result.digits'];
      const reasonPaths = ['reason', 'result.reason', 'gather_result.reason', 'cause'];
      const audioUrlPaths = [
        'recording_url', 'media_url', 'audio_url', 'recording.download_url',
        'recording.url', 'recordings[0].url', 'recordings', 'media_urls',
        'recording_urls', 'recording_files', 'transcription_url',
        'analysis_url', 'result.transcription_url', 'result.recording_url'
      ];

      let speech: string = pickFirstString(payload, speechPaths);
      const digits: string = pickFirstString(payload, digitsPaths);
      const reason: string = pickFirstString(payload, reasonPaths);
      const step = state.step || 'ask_dayuse';
      const retryCount = state.retry_count || 0;
      const audioUrls = pickStringArray(payload, audioUrlPaths);

      let speechSource = 'inline_payload';
      let speechFetchAttempts: string[] = [];
      if (!speech && audioUrls.length > 0) {
        const fetched = await fetchSpeechFromUrls(apiKey, audioUrls, callControlId);
        speechFetchAttempts = fetched.attempts;
        if (fetched.speech) {
          speech = fetched.speech.trim();
          speechSource = `fetched:${fetched.source || 'unknown'}`;
        } else {
          speechSource = 'missing_after_fetch';
        }
      }

      const likelyTimeoutNoInput = !speech && !digits && /timeout|no_input|noinput/i.test(reason || '');
      const acquisitionFailed = !speech && !digits && audioUrls.length > 0;
      const maxRetryCount = acquisitionFailed || likelyTimeoutNoInput ? 3 : 2;

      const payloadPreview = JSON.stringify(payload || {}).slice(0, 1200);
      console.log(`[gather] step=${step} speech="${speech}" digits=${digits} reason=${reason} src=${speechSource} audioUrls=${audioUrls.length} payload=${payloadPreview}`);

      try {

      // Task #52: 入力内容（digits/speech/reason）を調査用に call_logs.note へ記録
      if (db && logId) {
        const attemptsSummary = speechFetchAttempts.length ? `,fetch=${speechFetchAttempts.join(' || ').slice(0, 240)}` : '';
        await db.prepare(`UPDATE call_logs SET note = COALESCE(note||' | ','') || ? WHERE id = ?`)
          .bind(`input[step=${step},digits=${digits || '-'},speech=${(speech || '-').slice(0, 80)},reason=${reason || '-'},src=${speechSource},audio_urls=${audioUrls.length}${attemptsSummary}]`, logId)
          .run().catch(e => console.error('[telnyx-voice] input log failed:', e));
      }

      // ─── OUTREACH: DTMF capture for follow-up preference (no reject on keypad) ───
      if (step === 'outreach_ask_interest') {
        if (digits === '1') {
          const farewell = "Great, thank you. We will send you our materials shortly. Have a wonderful day. Goodbye!";
          if (db && logId) {
            await db.prepare(`UPDATE call_logs SET status='confirmed', transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
              .bind(`[Hotel]: pressed 1 (request materials)\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB err:', e));
          }
          await updateOutreachLead('interested', { needsRecall: 0, materials: 1, explanation: 0 });
          await setOutreachAttemptOutcome('interested', 'dtmf:1_materials');
          await telnyxCmd(apiKey, callControlId, 'speak', {
            payload: farewell,
            voice: 'Polly.Joanna',
            client_state: encodeState({ ...state, phase: 'ending' }),
          });
          break;
        }

        if (digits === '2') {
          const farewell = "Great, thank you. Our team will call you back to explain the details. Have a wonderful day. Goodbye!";
          if (db && logId) {
            await db.prepare(`UPDATE call_logs SET status='confirmed', transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
              .bind(`[Hotel]: pressed 2 (request explanation call)\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB err:', e));
          }
          await updateOutreachLead('interested', { needsRecall: 0, materials: 0, explanation: 1 });
          await setOutreachAttemptOutcome('interested', 'dtmf:2_explanation');
          await telnyxCmd(apiKey, callControlId, 'speak', {
            payload: farewell,
            voice: 'Polly.Joanna',
            client_state: encodeState({ ...state, phase: 'ending' }),
          });
          break;
        }

        const intentResult = await aiClassifyIntent(apiKey, speech, '', 'outreach_interest');
        console.log(`[trap:intent] step=${step} context=outreach_interest speech=${JSON.stringify(speech || '')} digits=${JSON.stringify('')} intent=${intentResult.intent} amount=${JSON.stringify(intentResult.amount ?? null)} price_quoted=${JSON.stringify(state.price_quoted ?? null)}`);

        if (intentResult.intent === 'repeat') {
          await gatherUsingSpeak({ ...state, step: 'outreach_ask_interest' }, "DayDreamHub is a day-use hotel booking platform. Listing is free. Press 1 if you want our materials, or press 2 if you want a follow-up explanation call. You can also answer by voice.");
        } else if (intentResult.intent === 'deny') {
          const farewell = "No problem at all. Thank you for your time. If you ever change your mind, feel free to visit daydreamhub.com. Have a great day. Goodbye!";
          if (db && logId) {
            await db.prepare(`UPDATE call_logs SET status='declined', transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
              .bind(`[Hotel]: ${speech || 'not interested'}\n[Agent]: ${farewell}`, logId).run().catch(e => console.error('[telnyx-voice] DB err:', e));
          }
          await updateOutreachLead('not_interested', { needsRecall: 0, doNotCall: 1 });
          await setOutreachAttemptOutcome('not_interested', 'voice_rejected');
          await telnyxCmd(apiKey, callControlId, 'speak', {
            payload: farewell,
            voice: 'Polly.Joanna',
            client_state: encodeState({ ...state, phase: 'ending' }),
          });
        } else if (intentResult.intent === 'affirm') {
          const followup = getOutreachScript(state.script_variant).followup;
          await gatherUsingSpeak({ ...state, step: 'outreach_ask_interest', retry_count: retryCount }, followup);
        } else {
          if (retryCount >= maxRetryCount) {
            await safeHangup('outreach_unclear_max_retry');
            if (db && logId) {
              await db.prepare(`UPDATE call_logs SET status='no_answer' WHERE id=?`).bind(logId).run().catch(e => console.error('[telnyx-voice] DB err:', e));
            }
            await updateOutreachLead('no_answer', { needsRecall: 1 });
            await setOutreachAttemptOutcome('no_answer', reason || 'outreach_unclear');
          } else {
            await gatherUsingSpeak({ ...state, step: 'outreach_ask_interest', retry_count: retryCount + 1 }, "Sorry, I didn't catch that. Press 1 for materials, press 2 for a follow-up explanation call, or answer by voice.");
          }
        }
        break;
      }

      // ─── STEP 1: Do you offer day-use plans? ───
      if (step === 'ask_dayuse') {
        const intentResult = await aiClassifyIntent(apiKey, speech, digits, 'ask_dayuse');
        console.log(`[trap:intent] step=${step} context=ask_dayuse speech=${JSON.stringify(speech || '')} digits=${JSON.stringify(digits || '')} intent=${intentResult.intent} amount=${JSON.stringify(intentResult.amount ?? null)} price_quoted=${JSON.stringify(state.price_quoted ?? null)}`);

        if (intentResult.intent === 'repeat') {
          const checkIn = (state.check_in_date || state.date || 'the requested date');
          const guests = state.guests || 1;
          const checkInTime = state.check_in_time || state.check_in || null;
          const checkOutTime = state.check_out_time || state.check_out || null;
          const timeInfo = checkInTime && checkOutTime ? ` from ${toAmPm(checkInTime)} to ${toAmPm(checkOutTime)}` : '';
          await gatherUsingSpeak({ ...state, step: 'ask_dayuse' }, `We have a guest looking to book a day-use stay on ${checkIn}${timeInfo}, for ${guests} ${guests === 1 ? 'person' : 'people'}. Do you offer day-use plans? Press 1 or say yes. Press 2 or say no. Press 3 to hear this again.`);
        } else if (intentResult.intent === 'affirm') {
          // → STEP 2A: Ask for price
          const checkIn = (state.check_in_date || state.date || 'the requested date');
          const guests = state.guests || 1;
          const checkInTime = state.check_in_time || state.check_in || null;
          const checkOutTime = state.check_out_time || state.check_out || null;
          const timeInfo = checkInTime && checkOutTime ? ` from ${toAmPm(checkInTime)} to ${toAmPm(checkOutTime)}` : '';
          const priceAsk = `Thank you! What is the rate for a day-use stay on ${checkIn}${timeInfo} for ${guests} ${guests === 1 ? 'person' : 'people'}? Please note, you must provide the final total amount in US dollars, including all service fees and taxes. For example, say fifty dollars. Or enter the number on your keypad and press the hash key when done. Press 3 to hear this again.`;

          if (db && logId) {
            await db.prepare(`UPDATE call_logs SET transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
              .bind(`[Hotel]: ${speech || 'pressed 1 (yes)'}\n[Agent]: ${priceAsk}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
          }

          await gatherUsingSpeak({ ...state, step: 'ask_price', retry_count: 0 }, priceAsk, true);

        } else if (intentResult.intent === 'deny') {
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
          if (retryCount >= maxRetryCount) {
            await safeHangup('ask_dayuse_max_retry');
            if (db && logId) {
              await db.prepare(`UPDATE call_logs SET status='no_answer' WHERE id=?`).bind(logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
            await updateConciergeCall('completed', { outcome: 'no_answer', ai_summary: 'No clear response to day-use question.' });
            await sendResultEmailOnce('no_answer');
            // Task #52: グループ発信なら次のホテルへ
            await advanceGroupAfterOutcome('no_answer');
          } else {
            await gatherUsingSpeak({ ...state, step: 'ask_dayuse', retry_count: retryCount + 1 }, "I'm sorry, I did not receive a response. If you offer day-use plans, press 1 or say yes. If not, press 2 or say no. If keypad input does not work, please answer by voice.");
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
        // Hybrid intent: prioritize DTMF, then let LLM classify free-form speech.
        const intentResult = await aiClassifyIntent(apiKey, hotelSaid, digits, 'ask_price');
        console.log(`[trap:intent] step=${step} context=ask_price speech=${JSON.stringify(hotelSaid || '')} digits=${JSON.stringify(digits || '')} intent=${intentResult.intent} amount=${JSON.stringify(intentResult.amount ?? null)} price_quoted=${JSON.stringify(state.price_quoted ?? null)}`);
        const priceResult = (intentResult.intent === 'price' && intentResult.amount && intentResult.amount > 0)
          ? { amount: intentResult.amount, raw: intentResult.raw || hotelSaid }
          : await aiExtractPrice(apiKey, hotelSaid);

        if (priceResult.amount && priceResult.amount > 0) {
          // Got price → confirm reservation
          const checkIn = (state.check_in_date || state.date || 'the requested date');
          const guests = state.guests || 1;
          const checkInTime = state.check_in_time || state.check_in || null;
          const checkOutTime = state.check_out_time || state.check_out || null;
          const confirmAsk = `To confirm your reservation: The date is ${checkIn}, time is ${toAmPm(checkInTime)} to ${toAmPm(checkOutTime)}, for ${guests} ${guests === 1 ? 'person' : 'people'}. The final total amount including taxes and fees is ${priceResult.amount} dollars, to be paid on-site at check-in. If you agree to all these details and confirm the booking, press 1 or say yes. To decline, press 2 or say no. If the amount is different, please say the correct amount, or enter the amount and then press the hash key.`;

          if (db && logId) {
            await db.prepare(`UPDATE call_logs SET transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
              .bind(`[Hotel]: ${hotelSaid}\n[Agent]: ${confirmAsk}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
          }

          await gatherUsingSpeak({ ...state, step: 'confirm_booking', price_quoted: priceResult.amount, retry_count: 0 }, confirmAsk, true);

        } else {
          // Couldn't extract price → retry
          if (retryCount >= maxRetryCount) {
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
            await gatherUsingSpeak({ ...state, step: 'ask_price', retry_count: retryCount + 1 }, "I'm sorry, could you repeat the rate for this day-use stay? Please note, it must be the final total amount in US dollars, including all service fees and taxes. You can say the amount, or enter the number on your keypad and press the hash key when done. If keypad entry fails, speaking the amount is also fine.", true);
          }
        }
        break;
      }

      // ─── STEP 2A-2: Confirm booking (single-shot 4-point consent) ───
      if (step === 'confirm_booking') {
        // Hybrid intent for final confirmation: affirm/deny/repeat + price correction from free speech.
        const intentResult = await aiClassifyIntent(apiKey, speech || '', digits || '', 'confirm_booking');
        console.log(`[trap:intent] step=${step} context=confirm_booking speech=${JSON.stringify((speech || ''))} digits=${JSON.stringify((digits || ''))} intent=${intentResult.intent} amount=${JSON.stringify(intentResult.amount ?? null)} price_quoted=${JSON.stringify(state.price_quoted ?? null)}`);
        let correctedPrice: number | null = (intentResult.intent === 'price' && intentResult.amount && intentResult.amount > 0)
          ? intentResult.amount
          : null;
        if (correctedPrice === null && speech) {
          const extracted = await aiExtractPrice(apiKey, speech);
          if (extracted.amount && extracted.amount > 0) correctedPrice = extracted.amount;
        }

        if (correctedPrice && correctedPrice > 0 && Number(correctedPrice) !== Number(state.price_quoted || 0)) {
          const checkIn = (state.check_in_date || state.date || 'the requested date');
          const checkInTime = state.check_in_time || state.check_in || null;
          const checkOutTime = state.check_out_time || state.check_out || null;
          const guests = state.guests || 1;
          const confirmAskUpdated = `The total amount has been updated to ${correctedPrice} dollars. To confirm your reservation: The date is ${checkIn}, time is ${toAmPm(checkInTime)} to ${toAmPm(checkOutTime)}, for ${guests} ${guests === 1 ? 'person' : 'people'}. The final total amount including taxes and fees is ${correctedPrice} dollars, to be paid on-site at check-in. If you agree to all these details and confirm the booking, press 1 or say yes. To decline, press 2 or say no. If the amount is different, please say the correct amount, or enter the amount and then press the hash key.`;

          if (db && logId) {
            await db.prepare(`UPDATE call_logs SET transcription = COALESCE(transcription||'\n','') || ? WHERE id=?`)
              .bind(`[Hotel]: ${speech || (digits ? `pressed ${digits}` : 'price corrected')}\n[Agent]: ${confirmAskUpdated}`, logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
          }

          await gatherUsingSpeak({ ...state, step: 'confirm_booking', price_quoted: correctedPrice, retry_count: 0 }, confirmAskUpdated, true);
          break;
        }
        const priceQuoted = state.price_quoted || 0;
        const checkIn = (state.check_in_date || state.date || 'the requested date');
        const checkInTime = state.check_in_time || state.check_in || null;
        const checkOutTime = state.check_out_time || state.check_out || null;
        const guests = state.guests || 1;

        if (intentResult.intent === 'repeat') {
          await gatherUsingSpeak(
            { ...state, step: 'confirm_booking' },
            `To confirm your reservation: The date is ${checkIn}, time is ${toAmPm(checkInTime)} to ${toAmPm(checkOutTime)}, for ${guests} ${guests === 1 ? 'person' : 'people'}. The final total amount including taxes and fees is ${priceQuoted} dollars, to be paid on-site at check-in. If you agree to all these details and confirm the booking, press 1 or say yes. To decline, press 2 or say no. If the amount is different, please say the correct amount, or enter the amount and then press the hash key.`
          );
          break;
        }

        if (intentResult.intent === 'deny') {
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

        if (intentResult.intent !== 'affirm') {
          if (retryCount >= maxRetryCount) {
            await safeHangup('confirm_booking_max_retry');
            if (db && logId) {
              await db.prepare(`UPDATE call_logs SET status='no_answer' WHERE id=?`).bind(logId).run().catch(e => console.error('[telnyx-voice] DB update failed:', e));
            }
            await updateConciergeCall('completed', { outcome: 'no_answer', ai_summary: 'No clear response during bundled final confirmation.' });
            await sendResultEmailOnce('no_answer');
            await advanceGroupAfterOutcome('no_answer');
          } else {
            await gatherUsingSpeak({ ...state, step: 'confirm_booking', retry_count: retryCount + 1 }, "I'm sorry, I did not receive a response. Press 1 or say yes to agree, or press 2 or say no to decline. If the amount is different, please say the correct amount, or enter the amount and then press the hash key. If keypad input does not work, voice response is okay.", true);
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
        let guestPhone = state.guest_phone || '';
        let guestEmail = state.guest_email || '';
        if (db && conciergeCallId) {
          const guestInfo: any = await db.prepare(
            `SELECT guest_name, request_details FROM concierge_calls WHERE id = ?`
          ).bind(conciergeCallId).first().catch(() => null);
          if (guestInfo?.guest_name) guestName = guestInfo.guest_name;
          try {
            const details = JSON.parse(guestInfo?.request_details || '{}');
            guestPhone = guestPhone || details?.guest_phone || '';
            guestEmail = guestEmail || details?.guest_email || '';
          } catch {}
        }

        const guestPhoneSpeech = formatPhoneForSpeech(guestPhone);
        const guestEmailSpeech = formatEmailForSpeech(guestEmail);
        const farewell = `Thank you. All consent checks are complete. The reservation is confirmed at a final total of ${priceQuoted} dollars, including service fees and taxes, with payment at the hotel. We will send a follow-up confirmation email shortly with all the details. For your immediate records, I will say the guest details slowly. Guest name: ${guestName}. Guest phone: ${guestPhoneSpeech}. Guest email: ${guestEmailSpeech}. Have a wonderful day!`;
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

      } catch (e) {
        console.error('[telnyx-voice] call.gather.ended handler error:', e);
        const fallbackPrompt = "I'm sorry, I encountered an error. Let me repeat.";

        if (retryCount >= maxRetryCount) {
          await telnyxCmd(apiKey, callControlId, 'speak', {
            payload: `${fallbackPrompt} Let's try again later. Goodbye.`,
            voice: 'Polly.Joanna',
            client_state: encodeState({ ...state, phase: 'ending' }),
          });
        } else {
          await gatherUsingSpeak(
            { ...state, step, retry_count: retryCount + 1 },
            `${fallbackPrompt} Please respond once more.`,
            step === 'ask_price' || step === 'confirm_booking'
          );
        }
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
        // Outreach: mark lead as voicemail/no_answer and needs_recall if still unresolved
        if (state.phase === 'outreach' && state.lead_id) {
          const lead: any = await db.prepare(`SELECT status FROM outreach_leads WHERE id=?`).bind(state.lead_id).first().catch(() => null);
          const hangupReason = String(payload?.hangup_cause || payload?.hangup_reason || payload?.sip_hangup_cause || '').toLowerCase();
          const voicemail = /voicemail|machine|answering/.test(hangupReason);
          if (lead && !['interested', 'not_interested'].includes(lead.status)) {
            await updateOutreachLead(voicemail ? 'voicemail' : 'no_answer', { needsRecall: 1 });
            await setOutreachAttemptOutcome(voicemail ? 'voicemail' : 'no_answer', hangupReason || 'hangup');
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
