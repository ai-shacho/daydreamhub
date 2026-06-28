import type { APIRoute } from 'astro';

type DbLike = {
  prepare: (sql: string) => {
    bind: (...args: any[]) => { run: () => Promise<any>; first: () => Promise<any>; all?: () => Promise<any> };
    run?: () => Promise<any>;
    all?: () => Promise<any>;
  };
};

type Step = 'intro' | 'outreach_ask_interest' | 'ask_dayuse' | 'ask_price' | 'confirm_booking';

const MAX_RETRY = 3;
const WEBHOOK_BASE = 'https://daydreamhub.com';
const VOICE = 'Polly.Joanna';

function gatherTwiml(action: string, prompt: string, opts?: { timeout?: number; finishOnKey?: string; preface?: string }): Response {
  const timeout = opts?.timeout ?? 8;
  const finishOnKey = opts?.finishOnKey ? ` finishOnKey="${esc(opts.finishOnKey)}"` : '';
  const preface = opts?.preface ? `<Say voice="${VOICE}">${esc(opts.preface)}</Say>` : '';
  return twiml(
    `${preface}<Gather input="speech dtmf" timeout="${timeout}" speechTimeout="auto" actionOnEmptyResult="true" language="en-US" action="${esc(action)}" method="POST"${finishOnKey}>` +
    `<Say voice="${VOICE}">${esc(prompt)}</Say>` +
    `</Gather>`
  );
}

function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clamp(v: unknown, max = 500): string {
  const s = String(v ?? '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function normalizeLogId(raw: string | null): string | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.trunc(n));
}

function normalizeStep(raw: string | null): Step {
  const s = String(raw || 'intro').trim().toLowerCase();
  if (s === 'outreach_ask_interest') return 'outreach_ask_interest';
  if (s === 'ask_dayuse') return 'ask_dayuse';
  if (s === 'ask_price') return 'ask_price';
  if (s === 'confirm_booking') return 'confirm_booking';
  return 'intro';
}

function parseTurn(raw: string | null): number {
  const n = Number(raw || '0');
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), 8);
}

function makeWebhookUrl(request: Request, logId: string | null, step: Step, turn = 0, event?: string): string {
  const _u = new URL(request.url);
  const u = new URL('/api/webhooks/twilio-voice', WEBHOOK_BASE);
  if (logId) u.searchParams.set('lid', logId);
  u.searchParams.set('step', step);
  u.searchParams.set('turn', String(turn));
  if (event) u.searchParams.set('event', event);
  return u.toString();
}

async function readTwilioParams(request: Request): Promise<URLSearchParams> {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(await request.text().catch(() => ''));
  }
  if (ct.includes('application/json')) {
    const j = await request.json().catch(() => ({} as any));
    const p = new URLSearchParams();
    Object.entries(j || {}).forEach(([k, v]) => { if (v != null) p.set(k, String(v)); });
    return p;
  }
  const raw = await request.text().catch(() => '');
  return new URLSearchParams(raw || '');
}

async function updateCallLog(db: DbLike | null, logId: string | null, status: string, note?: string, sid?: string, transcript?: string) {
  if (!db || !logId) return;
  try {
    const colsQ = db.prepare(`PRAGMA table_info(call_logs)`);
    const colsR = (typeof colsQ.all === 'function') ? await colsQ.all() : await colsQ.bind().run();
    const cols = new Set((colsR?.results || []).map((r: any) => String(r?.name || '')));

    const sets = [`status = CASE WHEN ? = 'no_answer' AND status IN ('confirmed','declined','failed','no_answer') THEN status ELSE ? END`];
    const binds: any[] = [status, status];

    if (note) { sets.push(`note = COALESCE(note || ' | ', '') || ?`); binds.push(clamp(note, 280)); }
    if (sid && cols.has('telnyx_call_id')) { sets.push(`telnyx_call_id = ?`); binds.push(clamp(sid, 180)); }
    if (transcript && cols.has('transcription')) { sets.push(`transcription = COALESCE(transcription || '\n', '') || ?`); binds.push(clamp(transcript, 1000)); }

    binds.push(logId);
    await db.prepare(`UPDATE call_logs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  } catch (e) {
    console.error('[twilio-voice] updateCallLog failed', e);
  }
}

function parsePrice(text: string, digits: string): number | null {
  const d = clamp(digits, 32).replace(/[^\d]/g, '');
  if (d) {
    const n = Number(d);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const t = clamp(text, 200);
  const m = t.match(/(\d+[\d,]*(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function isYes(speech: string, digits: string): boolean {
  if (digits === '1') return true;
  return /\b(yes|yeah|yep|correct|agree|ok|okay|right)\b/i.test(speech);
}
function isNo(speech: string, digits: string): boolean {
  if (digits === '2') return true;
  return /\b(no|nope|not|decline|incorrect|wrong)\b/i.test(speech);
}
function isRepeat(speech: string, digits: string): boolean {
  if (digits === '3') return true;
  return /\b(repeat|again)\b/i.test(speech);
}
function isInterested(speech: string, digits: string): 'materials' | 'callback' | 'reject' | 'unknown' {
  if (digits === '1') return 'materials';
  if (digits === '2') return 'callback';
  if (/\b(material|brochure|send|document)\b/i.test(speech)) return 'materials';
  if (/\b(call\s?back|callback|follow\s?up|explain|meeting)\b/i.test(speech)) return 'callback';
  if (/\b(not interested|no thanks|stop|remove|decline)\b/i.test(speech)) return 'reject';
  return 'unknown';
}

export const POST: APIRoute = async ({ request, locals, url }) => {
  try {
    const env = (locals as any)?.runtime?.env;
    const db: DbLike | null = env?.DB && typeof env.DB.prepare === 'function' ? env.DB : null;

    const logId = normalizeLogId(url.searchParams.get('lid'));
    const step = normalizeStep(url.searchParams.get('step'));
    const turn = parseTurn(url.searchParams.get('turn'));
    const event = clamp(url.searchParams.get('event') || '', 40).toLowerCase();

    const form = await readTwilioParams(request);
    const callSid = clamp(form.get('CallSid') || '', 120);
    const digits = clamp(form.get('Digits') || '', 32);
    const speech = clamp(form.get('SpeechResult') || form.get('UnstableSpeechResult') || '', 500);
    const callStatus = clamp(form.get('CallStatus') || '', 40).toLowerCase();

    if (event === 'status') {
      let mapped = 'calling';
      if (['busy', 'failed', 'canceled', 'no-answer'].includes(callStatus)) mapped = 'failed';
      if (callStatus === 'completed') mapped = 'no_answer';
      await updateCallLog(db, logId, mapped, `twilio_status:${callStatus || 'unknown'}`, callSid ? `twilio:${callSid}` : undefined);
      return new Response('ok', { status: 200 });
    }

    let phase = 'booking';
    let booking: any = null;
    let outreachLead: any = null;
    if (db && logId) {
      const row: any = await db.prepare(`SELECT id, booking_id, note FROM call_logs WHERE id = ?`).bind(logId).first().catch(() => null);
      if (row?.booking_id) {
        booking = await db.prepare(`SELECT b.id, b.check_in_date, b.check_in_time, b.check_out_time, (b.adults + b.children) AS guests, h.name AS hotel_name FROM bookings b LEFT JOIN hotels h ON h.id = b.hotel_id WHERE b.id = ?`).bind(row.booking_id).first().catch(() => null);
      }
      if (String(row?.note || '').toLowerCase().includes('outreach')) {
        phase = 'outreach';
        outreachLead = await db.prepare(`SELECT l.id, l.hotel_name FROM outreach_leads l WHERE l.call_log_id = ? ORDER BY l.id DESC LIMIT 1`).bind(logId).first().catch(() => null);
      }
    }

    if (step === 'intro') {
      if (phase === 'outreach') {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_intro', callSid ? `twilio:${callSid}` : undefined);
        const action = makeWebhookUrl(request, logId, 'outreach_ask_interest', 0);
        return gatherTwiml(action, 'Hello, this is DayDreamHub. Listing is free. Press 1 if you want our materials, or press 2 if you want a follow-up explanation call. You can also answer by voice.');
      }

      await updateCallLog(db, logId, 'awaiting_response', 'twilio_booking_intro', callSid ? `twilio:${callSid}` : undefined);
      const action = makeWebhookUrl(request, logId, 'ask_dayuse', 0);
      const checkIn = booking?.check_in_date || 'the requested date';
      const guests = Number(booking?.guests || 1);
      const prompt = `We have a guest looking for a day-use stay on ${checkIn} for ${guests} ${guests === 1 ? 'person' : 'people'}. Do you offer day-use plans? Press 1 or say yes. Press 2 or say no. Press 3 to hear this again.`;
      return gatherTwiml(action, prompt);
    }

    if (step === 'outreach_ask_interest') {
      const choice = isInterested(speech, digits);
      if (choice === 'materials' || choice === 'callback') {
        const outcome = choice === 'materials' ? 'interested' : 'appointment_set';
        await updateCallLog(db, logId, 'confirmed', `twilio_outreach_${choice}`, callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || `pressed ${digits}`}`);
        if (db && outreachLead?.id) {
          await db.prepare(`UPDATE outreach_leads SET status=?, needs_recall=?, updated_at=datetime('now') WHERE id=?`).bind(outcome, choice === 'callback' ? 1 : 0, outreachLead.id).run().catch(() => {});
          await db.prepare(`UPDATE outreach_call_attempts SET outcome=?, updated_at=datetime('now') WHERE lead_id=? AND call_log_id=?`).bind(outcome, outreachLead.id, logId).run().catch(() => {});
        }
        return twiml(`<Say voice="${VOICE}">Thank you. We recognized your response and will follow up shortly. Goodbye.</Say><Hangup/>`);
      }
      if (choice === 'reject') {
        await updateCallLog(db, logId, 'declined', 'twilio_outreach_rejected', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'not interested'}`);
        if (db && outreachLead?.id) {
          await db.prepare(`UPDATE outreach_leads SET status='not_interested', do_not_call=1, needs_recall=0, updated_at=datetime('now') WHERE id=?`).bind(outreachLead.id).run().catch(() => {});
          await db.prepare(`UPDATE outreach_call_attempts SET outcome='not_interested', updated_at=datetime('now') WHERE lead_id=? AND call_log_id=?`).bind(outreachLead.id, logId).run().catch(() => {});
        }
        return twiml(`<Say voice="${VOICE}">Thank you. Understood. Goodbye.</Say><Hangup/>`);
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_outreach_no_answer', callSid ? `twilio:${callSid}` : undefined);
        return twiml(`<Say voice="${VOICE}">We could not confirm your response after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'outreach_ask_interest', turn + 1);
      return gatherTwiml(action, 'Sorry, I could not hear your response clearly. Please say it again. Press 1 for materials, press 2 for a follow-up explanation call, or answer by voice.');
    }

    if (step === 'ask_dayuse') {
      if (isRepeat(speech, digits)) {
        const action = makeWebhookUrl(request, logId, 'ask_dayuse', turn + 1);
        const checkIn = booking?.check_in_date || 'the requested date';
        const guests = Number(booking?.guests || 1);
        return gatherTwiml(action, `We have a guest looking for a day-use stay on ${checkIn} for ${guests} ${guests === 1 ? 'person' : 'people'}. Do you offer day-use plans? Press 1 or say yes. Press 2 or say no.`);
      }
      if (isYes(speech, digits)) {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_dayuse_yes', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 1'}`);
        const action = makeWebhookUrl(request, logId, 'ask_price', 0);
        return gatherTwiml(action, 'What is the final total price in Japanese yen, including all service fees and taxes? You can say the amount, or enter numbers and press the hash key.', { timeout: 10, finishOnKey: '#', preface: 'Thank you. We recognized your answer.' });
      }
      if (isNo(speech, digits)) {
        await updateCallLog(db, logId, 'declined', 'twilio_dayuse_no', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 2'}`);
        if (db && booking?.id) {
          await db.prepare(`UPDATE bookings SET status='declined_by_hotel', updated_at=datetime('now') WHERE id=?`).bind(booking.id).run().catch(() => {});
        }
        return twiml(`<Say voice="${VOICE}">Thank you. We recognized your answer. Goodbye.</Say><Hangup/>`);
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_dayuse_no_answer', callSid ? `twilio:${callSid}` : undefined);
        return twiml(`<Say voice="${VOICE}">We could not confirm your response after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'ask_dayuse', turn + 1);
      return gatherTwiml(action, 'Sorry, I could not hear your response clearly. Please say it again. Press 1 or say yes if you offer day-use. Press 2 or say no if you do not.');
    }

    if (step === 'ask_price') {
      if (isRepeat(speech, digits)) {
        const action = makeWebhookUrl(request, logId, 'ask_price', turn + 1);
        return gatherTwiml(action, 'Please tell me the final total amount in Japanese yen including all taxes and fees. You may also use the keypad and then press the hash key.', { timeout: 10, finishOnKey: '#' });
      }
      const amount = parsePrice(speech, digits);
      if (amount != null) {
        await updateCallLog(db, logId, 'awaiting_response', `twilio_price:${amount}`, callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || `DTMF:${digits}`}\n[Agent]: Confirming price ${amount}`);
        const action = makeWebhookUrl(request, logId, 'confirm_booking', 0);
        return gatherTwiml(action, `To confirm, the final total is ${amount} yen. ${amount}円でよろしいですか？ Press 1 or say yes to confirm. Press 2 or say no. If the amount is different, say the correct amount or enter it by keypad.`, { preface: 'Thank you. We recognized your answer.' });
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_price_no_answer', callSid ? `twilio:${callSid}` : undefined);
        return twiml(`<Say voice="${VOICE}">We could not capture the amount after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'ask_price', turn + 1);
      return gatherTwiml(action, 'Sorry, I could not hear the amount clearly. Please say the final total in Japanese yen, or enter digits and press the hash key.');
    }

    if (step === 'confirm_booking') {
      const amount = parsePrice(speech, digits);
      if (amount != null && !isYes(speech, digits) && !isNo(speech, digits)) {
        await updateCallLog(db, logId, 'awaiting_response', `twilio_price_corrected:${amount}`, callSid ? `twilio:${callSid}` : undefined, `[Hotel]: corrected price ${amount}`);
        const action = makeWebhookUrl(request, logId, 'confirm_booking', turn + 1);
        return gatherTwiml(action, `Updated amount is ${amount} yen. ${amount}円でよろしいですか？ Press 1 or say yes to confirm, or press 2 or say no.`, { preface: 'Thank you. We recognized your answer.' });
      }
      if (isYes(speech, digits)) {
        await updateCallLog(db, logId, 'confirmed', 'twilio_booking_confirmed', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 1'}`);
        if (db && booking?.id) {
          await db.prepare(`UPDATE bookings SET status='confirmed_by_hotel', updated_at=datetime('now') WHERE id=?`).bind(booking.id).run().catch(() => {});
        }
        return twiml(`<Say voice="${VOICE}">Thank you. We recognized your answer. The booking request is confirmed. Goodbye.</Say><Hangup/>`);
      }
      if (isNo(speech, digits)) {
        await updateCallLog(db, logId, 'declined', 'twilio_booking_declined', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 2'}`);
        if (db && booking?.id) {
          await db.prepare(`UPDATE bookings SET status='declined_by_hotel', updated_at=datetime('now') WHERE id=?`).bind(booking.id).run().catch(() => {});
        }
        return twiml(`<Say voice="${VOICE}">Thank you. We recognized your answer. Goodbye.</Say><Hangup/>`);
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_confirm_no_answer', callSid ? `twilio:${callSid}` : undefined);
        return twiml(`<Say voice="${VOICE}">We could not confirm your response after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'confirm_booking', turn + 1);
      return gatherTwiml(action, 'Sorry, I could not hear your response clearly. Please say it again. Press 1 or say yes to confirm. Press 2 or say no to decline. You can also provide a corrected amount.');
    }

    return twiml(`<Say voice="Polly.Joanna">Invalid state. Goodbye.</Say><Hangup/>`);
  } catch (e: any) {
    console.error('[twilio-voice] fatal', e);
    return twiml(`<Say voice="Polly.Joanna">Temporary error. Goodbye.</Say><Hangup/>`);
  }
};

export const GET: APIRoute = async ({ url }) => {
  return new Response(JSON.stringify({ ok: true, provider: 'twilio', path: url.pathname }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
