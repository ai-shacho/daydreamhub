import type { APIRoute } from 'astro';
import { initiateNextGroupCall, processGroupRefund } from '../../../lib/tools';

type DbLike = {
  prepare: (sql: string) => {
    bind: (...args: any[]) => { run: () => Promise<any>; first: () => Promise<any>; all?: () => Promise<any> };
    run?: () => Promise<any>;
    all?: () => Promise<any>;
  };
};

type Step =
  | 'intro'
  | 'outreach_phase_0'
  | 'outreach_phase_1'
  | 'outreach_phase_2'
  | 'outreach_phase_4'
  | 'outreach_phase_5'
  | 'ask_dayuse'
  | 'ask_price'
  | 'confirm_booking';

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

function toAmPm(timeRaw: unknown): string {
  const t = String(timeRaw ?? '').trim();
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return t || 'the requested time';
  let h = Number(m[1]);
  const min = m[2];
  if (!Number.isFinite(h)) return t;
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${suffix}`;
}

function readQuotedAmountFromNote(note: unknown): number | null {
  const n = String(note ?? '');
  const matches = [...n.matchAll(/twilio_price(?:_corrected)?:([0-9]+(?:\.[0-9]+)?)/g)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1]?.[1] || '';
  const v = Number(last);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 100) / 100;
}

function readBookingTestMetaFromNote(note: unknown): { guest_name?: string; guest_count?: number; check_in_date?: string; check_in_time?: string; check_out_time?: string } | null {
  const text = String(note ?? '');
  const m = text.match(/\[booking-test:(\{.*\})\]/);
  if (!m?.[1]) return null;
  try {
    const parsed = JSON.parse(m[1]);
    return {
      guest_name: String(parsed?.guest_name || '').trim() || undefined,
      guest_count: Number(parsed?.guest_count || parsed?.guests || 0) || undefined,
      check_in_date: String(parsed?.check_in_date || '').trim() || undefined,
      check_in_time: String(parsed?.check_in_time || '').trim() || undefined,
      check_out_time: String(parsed?.check_out_time || '').trim() || undefined,
    };
  } catch {
    return null;
  }
}

function normalizeLogId(raw: string | null): string | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.trunc(n));
}

function normalizeStep(raw: string | null): Step {
  const s = String(raw || 'intro').trim().toLowerCase();
  if (s === 'outreach_phase_0' || s === 'outreach_ask_interest') return 'outreach_phase_0';
  if (s === 'outreach_phase_1') return 'outreach_phase_1';
  if (s === 'outreach_phase_2') return 'outreach_phase_2';
  if (s === 'outreach_phase_4') return 'outreach_phase_4';
  if (s === 'outreach_phase_5') return 'outreach_phase_5';
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

function safeJson(value: any): string {
  try { return JSON.stringify(value); } catch { return '{}'; }
}

async function insertCallLogEvent(
  db: DbLike | null,
  logId: string | null,
  event: {
    eventType: string;
    phase?: string;
    step?: string;
    turn?: number;
    callSid?: string;
    callStatus?: string;
    digits?: string;
    speech?: string;
    note?: string;
    payload?: any;
  }
) {
  if (!db || !logId) return;
  try {
    await db.prepare(`
      INSERT INTO call_log_events (
        call_log_id, provider, event_type, phase, step, turn, call_sid, call_status,
        digits, speech_result, note, payload_json, created_at
      ) VALUES (?1, 'twilio', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now'))
    `).bind(
      Number(logId),
      clamp(event.eventType, 80),
      event.phase ? clamp(event.phase, 40) : null,
      event.step ? clamp(event.step, 60) : null,
      Number.isFinite(event.turn as number) ? Math.max(0, Math.trunc(Number(event.turn))) : null,
      event.callSid ? clamp(event.callSid, 120) : null,
      event.callStatus ? clamp(event.callStatus, 40) : null,
      event.digits ? clamp(event.digits, 40) : null,
      event.speech ? clamp(event.speech, 1000) : null,
      event.note ? clamp(event.note, 500) : null,
      safeJson(event.payload || null),
    ).run();
  } catch (e) {
    console.error('[twilio-voice] insertCallLogEvent failed', e);
  }
}

async function updateCallLog(
  db: DbLike | null,
  logId: string | null,
  status: string,
  note?: string,
  sid?: string,
  transcript?: string,
  extra?: { phase?: string; step?: string; eventType?: string; callStatus?: string; answeredAt?: boolean; endedAt?: boolean }
) {
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
    if (cols.has('provider')) { sets.push(`provider = COALESCE(provider, 'twilio')`); }
    if (extra?.phase && cols.has('phase')) { sets.push(`phase = ?`); binds.push(clamp(extra.phase, 40)); }
    if (extra?.step && cols.has('last_step')) { sets.push(`last_step = ?`); binds.push(clamp(extra.step, 60)); }
    if (extra?.eventType && cols.has('last_event_type')) { sets.push(`last_event_type = ?`); binds.push(clamp(extra.eventType, 80)); }
    if (extra?.callStatus && cols.has('last_call_status')) { sets.push(`last_call_status = ?`); binds.push(clamp(extra.callStatus, 40)); }
    if (extra?.answeredAt && cols.has('answered_at')) { sets.push(`answered_at = COALESCE(answered_at, datetime('now'))`); }
    if (extra?.endedAt && cols.has('ended_at')) { sets.push(`ended_at = COALESCE(ended_at, datetime('now'))`); }
    if (cols.has('updated_at')) { sets.push(`updated_at = datetime('now')`); }

    binds.push(logId);
    await db.prepare(`UPDATE call_logs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  } catch (e) {
    console.error('[twilio-voice] updateCallLog failed', e);
  }
}

async function updateOutreachState(
  db: DbLike | null,
  params: {
    leadId: number | null;
    logId: string | null;
    status: string;
    outcome?: string;
    personInChargeName?: string | null;
    needsRecall?: number | null;
    doNotCall?: number | null;
    materials?: number | null;
    explanation?: number | null;
    retryCount?: number | null;
  }
) {
  if (!db || !params.leadId || !params.logId) return;
  const outcome = params.outcome || params.status;
  const personName = params.personInChargeName ? clamp(params.personInChargeName, 80) : null;

  await db.prepare(`UPDATE outreach_call_attempts
      SET outcome=?,
          recognized_status=?,
          person_in_charge_name=COALESCE(?, person_in_charge_name),
          retry_count=COALESCE(?, retry_count),
          updated_at=datetime('now')
      WHERE lead_id=? AND call_log_id=?`)
    .bind(outcome, params.status, personName, params.retryCount ?? null, params.leadId, params.logId)
    .run().catch(() => {});

  await db.prepare(`UPDATE outreach_leads
      SET status=?,
          last_outreach_status=?,
          person_in_charge_name=COALESCE(?, person_in_charge_name),
          needs_recall=COALESCE(?, needs_recall),
          do_not_call=COALESCE(?, do_not_call),
          requested_materials=COALESCE(?, requested_materials),
          requested_explanation=COALESCE(?, requested_explanation),
          updated_at=datetime('now')
      WHERE id=?`)
    .bind(
      params.status,
      params.status,
      personName,
      params.needsRecall ?? null,
      params.doNotCall ?? null,
      params.materials ?? null,
      params.explanation ?? null,
      params.leadId
    )
    .run().catch(() => {});
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
function extractPersonName(speech: string): string | null {
  const s = clamp(speech, 200);
  const patterns = [
    /(?:my name is|this is|i am|i'm|speaking is)\s+([a-z][a-z\s.'-]{1,40})/i,
    /(?:person in charge is|manager is|owner is)\s+([a-z][a-z\s.'-]{1,40})/i,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (!m?.[1]) continue;
    const v = m[1].trim().replace(/\s{2,}/g, ' ');
    if (v.length >= 2 && v.length <= 50) return v;
  }
  return null;
}

function classifyOutreachPhase0(speech: string, digits: string): 'available' | 'absent' | 'reject' | 'unknown' {
  if (digits === '1') return 'available';
  if (digits === '2') return 'absent';
  if (/\b(yes|speaking|available|this is|i am|i'm)\b/i.test(speech)) return 'available';
  if (/\b(not here|absent|away|out of office|not available|left|later)\b/i.test(speech)) return 'absent';
  if (/\b(stop|remove|not interested|decline|do not call|dont call)\b/i.test(speech)) return 'reject';
  return 'unknown';
}

function classifyOutreachPhase2(speech: string, digits: string): 'materials' | 'meeting' | 'reject' | 'unknown' {
  if (digits === '1') return 'materials';
  if (digits === '2') return 'meeting';
  if (/\b(material|brochure|deck|document|send|info)\b/i.test(speech)) return 'materials';
  if (/\b(meeting|callback|call back|follow up|appointment|schedule|talk)\b/i.test(speech)) return 'meeting';
  if (/\b(not interested|no thanks|stop|remove|decline)\b/i.test(speech)) return 'reject';
  return 'unknown';
}

async function updateConciergeCallStatus(db: DbLike | null, conciergeCallId: string | null, status: string, extra: Record<string, any> = {}) {
  if (!db || !conciergeCallId) return;
  const fields = Object.entries({ status, ...extra }).map(([k]) => `${k} = ?`).join(', ');
  const values = [...Object.values({ status, ...extra }), conciergeCallId];
  await db.prepare(`UPDATE concierge_calls SET ${fields}, updated_at = datetime('now') WHERE id = ?`).bind(...values).run().catch((e) => {
    console.error('[twilio-voice] concierge update failed', e);
  });
}

async function advanceConciergeGroup(env: any, db: DbLike | null, conciergeCallId: string | null, outcome: 'booked' | 'available' | 'unavailable' | 'no_answer') {
  if (!db || !conciergeCallId) return;
  const call: any = await db.prepare(`SELECT call_group_id FROM concierge_calls WHERE id = ?`).bind(conciergeCallId).first().catch(() => null);
  const groupId = Number(call?.call_group_id || 0) || null;
  if (!groupId) return;

  if (outcome === 'booked' || outcome === 'available') {
    await db.prepare("UPDATE concierge_call_groups SET status = 'success', updated_at = datetime('now') WHERE id = ? AND status != 'success'")
      .bind(groupId).run().catch(() => {});
    return;
  }

  const next = await initiateNextGroupCall(env, db, groupId).catch((e) => {
    console.error('[twilio-voice] initiateNextGroupCall failed', e);
    return null;
  });

  if (next?.status === 'all_failed') {
    await processGroupRefund(env, db, groupId).catch((e) => {
      console.error('[twilio-voice] processGroupRefund failed', e);
    });
  }
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

    const phaseParam = String(url.searchParams.get('phase') || '').toLowerCase();

    await insertCallLogEvent(db, logId, {
      eventType: event === 'status' ? 'status_callback' : 'gather_webhook',
      phase: phaseParam || undefined,
      step,
      turn,
      callSid: callSid || undefined,
      callStatus: callStatus || undefined,
      digits: digits || undefined,
      speech: speech || undefined,
      payload: Object.fromEntries(form.entries()),
    });

    if (event === 'status') {
      const conciergeRow: any = (db && logId && (phaseParam === 'concierge' || phaseParam === ''))
        ? await db.prepare(`SELECT id, call_group_id, outcome, status FROM concierge_calls WHERE id = ?`).bind(logId).first().catch(() => null)
        : null;

      if (conciergeRow) {
        let conciergeStatus = 'calling';
        let outcome: 'unavailable' | 'no_answer' | null = null;

        if (['busy', 'failed', 'canceled'].includes(callStatus)) {
          conciergeStatus = 'completed';
          outcome = 'unavailable';
        } else if (['no-answer', 'completed'].includes(callStatus)) {
          conciergeStatus = 'completed';
          outcome = 'no_answer';
        }

        await updateConciergeCallStatus(db, String(conciergeRow.id), conciergeStatus, {
          telnyx_call_id: callSid ? `twilio:${callSid}` : undefined,
          outcome: outcome || undefined,
          ai_summary: outcome ? `twilio_status:${callStatus || 'unknown'}` : undefined,
        });

        if (outcome && !['booked', 'available'].includes(String(conciergeRow.outcome || ''))) {
          await advanceConciergeGroup(env, db, String(conciergeRow.id), outcome);
        }
        return new Response('ok', { status: 200 });
      }

      let mapped = 'calling';
      if (['busy', 'failed', 'canceled', 'no-answer'].includes(callStatus)) mapped = 'failed';
      if (callStatus === 'completed') mapped = 'no_answer';
      await updateCallLog(
        db,
        logId,
        mapped,
        `twilio_status:${callStatus || 'unknown'}`,
        callSid ? `twilio:${callSid}` : undefined,
        undefined,
        {
          phase: phaseParam || undefined,
          step,
          eventType: 'status_callback',
          callStatus: callStatus || undefined,
          answeredAt: callStatus === 'answered',
          endedAt: ['completed', 'busy', 'failed', 'canceled', 'no-answer'].includes(callStatus),
        }
      );
      return new Response('ok', { status: 200 });
    }

    let phase: 'booking' | 'outreach' | 'concierge' = 'booking';
    if (phaseParam === 'outreach') phase = 'outreach';
    if (phaseParam === 'concierge') phase = 'concierge';

    let booking: any = null;
    let outreachLead: any = null;
    let bookingTestMeta: { guest_name?: string; guest_count?: number; check_in_date?: string; check_in_time?: string; check_out_time?: string } | null = null;
    let quotedAmountFromNote: number | null = null;
    if (db && logId && phase !== 'concierge') {
      const row: any = await db.prepare(`SELECT id, booking_id, note FROM call_logs WHERE id = ?`).bind(logId).first().catch(() => null);
      quotedAmountFromNote = readQuotedAmountFromNote(row?.note);
      bookingTestMeta = readBookingTestMetaFromNote(row?.note);
      if (row?.booking_id) {
        booking = await db.prepare(`SELECT b.id, b.guest_name, b.check_in_date, COALESCE(b.check_in_time, p.check_in_time) AS check_in_time, COALESCE(b.check_out_time, p.check_out_time) AS check_out_time, (COALESCE(b.adults,0) + COALESCE(b.children,0)) AS guests, h.name AS hotel_name FROM bookings b LEFT JOIN hotels h ON h.id = b.hotel_id LEFT JOIN plans p ON p.id = b.plan_id WHERE b.id = ?`).bind(row.booking_id).first().catch(() => null);
      }
      if (String(row?.note || '').toLowerCase().includes('outreach')) {
        phase = 'outreach';
        outreachLead = await db.prepare(`SELECT l.id, l.hotel_name, l.person_in_charge_name FROM outreach_leads l WHERE l.call_log_id = ? ORDER BY l.id DESC LIMIT 1`).bind(logId).first().catch(() => null);
      }
    }

    const bookingCheckInDate = booking?.check_in_date || bookingTestMeta?.check_in_date || 'the requested date';
    const bookingCheckInTimeRaw = booking?.check_in_time || bookingTestMeta?.check_in_time || 'the requested start time';
    const bookingCheckOutTimeRaw = booking?.check_out_time || bookingTestMeta?.check_out_time || 'the requested end time';
    const bookingCheckInTime = toAmPm(bookingCheckInTimeRaw);
    const bookingCheckOutTime = toAmPm(bookingCheckOutTimeRaw);
    const bookingGuests = Number(booking?.guests || bookingTestMeta?.guest_count || 1);
    const bookingGuestName = booking?.guest_name || bookingTestMeta?.guest_name || 'the guest';

    if (step === 'intro') {
      if (phase === 'outreach') {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_phase_0', callSid ? `twilio:${callSid}` : undefined);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_0', 0);
        return gatherTwiml(action, 'Hello. We are DayDreamHub, a platform that matches guests with hotel day-use rooms. We are calling today to invite your property to be listed on our site. Is the manager or person in charge available? Press 1 if available now, or press 2 if not available. You can also answer by voice.');
      }

      await updateCallLog(db, logId, 'awaiting_response', 'twilio_booking_intro', callSid ? `twilio:${callSid}` : undefined);
      const action = makeWebhookUrl(request, logId, 'ask_dayuse', 0);
      const timeInfo = bookingCheckInTime && bookingCheckOutTime ? ` from ${bookingCheckInTime} to ${bookingCheckOutTime}` : '';
      const prompt = `We have a guest looking to book a day-use stay on ${bookingCheckInDate}${timeInfo}, for ${bookingGuests} ${bookingGuests === 1 ? 'person' : 'people'}. Do you offer day-use plans? Press 1 or say yes. Press 2 or say no. Press 3 to hear this again.`;
      return gatherTwiml(action, prompt);
    }

    if (step === 'outreach_phase_0') {
      const decision = classifyOutreachPhase0(speech, digits);
      if (decision === 'available') {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_phase_0_available', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || `pressed ${digits || '1'}`}`);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_2', 0);
        return gatherTwiml(action, 'Thank you. DayDreamHub offers free listings for hotels. Would you prefer we send materials first, or schedule a short explanation call? Press 1 for materials, or press 2 for a short meeting call.');
      }
      if (decision === 'absent') {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_phase_0_absent', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || `pressed ${digits || '2'}`}`);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_1', 0);
        return gatherTwiml(action, 'Understood. Could you share the name of the person in charge so we can follow up properly?');
      }
      if (decision === 'reject') {
        await updateCallLog(db, logId, 'declined', 'twilio_outreach_rejected_phase_0', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'not interested'}`);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'not_interested', outcome: 'not_interested', doNotCall: 1, needsRecall: 0, retryCount: turn });
        return twiml(`<Say voice="${VOICE}">Understood. Thank you for your time. Goodbye.</Say><Hangup/>`);
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_outreach_timeout_phase_0', callSid ? `twilio:${callSid}` : undefined);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'timeout_or_error', outcome: 'timeout_or_error', needsRecall: 1, retryCount: turn + 1 });
        return twiml(`<Say voice="${VOICE}">We could not confirm your response after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'outreach_phase_0', turn + 1);
      return gatherTwiml(action, 'Sorry, I could not hear your response clearly. Press 1 if the person in charge is available now, or press 2 if unavailable.');
    }

    if (step === 'outreach_phase_1') {
      const personName = extractPersonName(speech);
      if (personName) {
        await updateCallLog(db, logId, 'confirmed', `twilio_outreach_absent_name_acquired:${personName}`, callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech}`);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'absent_name_acquired', outcome: 'absent_name_acquired', personInChargeName: personName, needsRecall: 1, retryCount: turn });
        return twiml(`<Say voice="${VOICE}">Thank you. We will follow up with ${esc(personName)}. Goodbye.</Say><Hangup/>`);
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_outreach_timeout_phase_1', callSid ? `twilio:${callSid}` : undefined);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'timeout_or_error', outcome: 'timeout_or_error', needsRecall: 1, retryCount: turn + 1 });
        return twiml(`<Say voice="${VOICE}">Sorry, we could not capture the name clearly. We will try again later. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'outreach_phase_1', turn + 1);
      return gatherTwiml(action, 'Sorry, I did not catch the name. Please say the name of the person in charge once more.');
    }

    if (step === 'outreach_phase_2') {
      const intent = classifyOutreachPhase2(speech, digits);
      if (intent === 'materials') {
        const action = makeWebhookUrl(request, logId, 'outreach_phase_4', 0);
        return gatherTwiml(action, 'Great. To confirm, may we send our overview materials? Press 1 or say yes to confirm, or press 2 or say no.');
      }
      if (intent === 'meeting') {
        const action = makeWebhookUrl(request, logId, 'outreach_phase_5', 0);
        return gatherTwiml(action, 'Great. To confirm, may our team schedule a short follow-up meeting call? Press 1 or say yes to confirm, or press 2 or say no.');
      }
      if (intent === 'reject') {
        await updateCallLog(db, logId, 'declined', 'twilio_outreach_rejected_phase_2', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'not interested'}`);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'not_interested', outcome: 'not_interested', doNotCall: 1, needsRecall: 0, retryCount: turn });
        return twiml(`<Say voice="${VOICE}">Understood. Thank you for your time. Goodbye.</Say><Hangup/>`);
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_outreach_timeout_phase_2', callSid ? `twilio:${callSid}` : undefined);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'timeout_or_error', outcome: 'timeout_or_error', needsRecall: 1, retryCount: turn + 1 });
        return twiml(`<Say voice="${VOICE}">We could not confirm your preference after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'outreach_phase_2', turn + 1);
      return gatherTwiml(action, 'Sorry, I did not catch that. Press 1 for materials, or press 2 for a short meeting call.');
    }

    if (step === 'outreach_phase_4') {
      if (isYes(speech, digits)) {
        await updateCallLog(db, logId, 'confirmed', 'twilio_outreach_materials_agreed', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 1'}`);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'materials_agreed', outcome: 'materials_agreed', materials: 1, explanation: 0, needsRecall: 0, retryCount: turn });
        return twiml(`<Say voice="${VOICE}">Thank you. We will send the materials shortly. Goodbye.</Say><Hangup/>`);
      }
      if (isNo(speech, digits)) {
        await updateCallLog(db, logId, 'declined', 'twilio_outreach_materials_declined', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 2'}`);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'not_interested', outcome: 'not_interested', doNotCall: 1, needsRecall: 0, retryCount: turn });
        return twiml(`<Say voice="${VOICE}">Understood. Thank you for your time. Goodbye.</Say><Hangup/>`);
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_outreach_timeout_phase_4', callSid ? `twilio:${callSid}` : undefined);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'timeout_or_error', outcome: 'timeout_or_error', needsRecall: 1, retryCount: turn + 1 });
        return twiml(`<Say voice="${VOICE}">We could not confirm after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'outreach_phase_4', turn + 1);
      return gatherTwiml(action, 'Sorry, I did not catch that. Press 1 or say yes to receive materials, or press 2 or say no.');
    }

    if (step === 'outreach_phase_5') {
      if (isYes(speech, digits)) {
        await updateCallLog(db, logId, 'confirmed', 'twilio_outreach_meeting_agreed', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 1'}`);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'meeting_agreed', outcome: 'meeting_agreed', materials: 0, explanation: 1, needsRecall: 1, retryCount: turn });
        return twiml(`<Say voice="${VOICE}">Thank you. Our team will arrange a short follow-up meeting call. Goodbye.</Say><Hangup/>`);
      }
      if (isNo(speech, digits)) {
        await updateCallLog(db, logId, 'declined', 'twilio_outreach_meeting_declined', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 2'}`);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'not_interested', outcome: 'not_interested', doNotCall: 1, needsRecall: 0, retryCount: turn });
        return twiml(`<Say voice="${VOICE}">Understood. Thank you for your time. Goodbye.</Say><Hangup/>`);
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_outreach_timeout_phase_5', callSid ? `twilio:${callSid}` : undefined);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'timeout_or_error', outcome: 'timeout_or_error', needsRecall: 1, retryCount: turn + 1 });
        return twiml(`<Say voice="${VOICE}">We could not confirm after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'outreach_phase_5', turn + 1);
      return gatherTwiml(action, 'Sorry, I did not catch that. Press 1 or say yes to schedule a follow-up meeting call, or press 2 or say no.');
    }

    if (step === 'ask_dayuse') {
      if (isRepeat(speech, digits)) {
        const action = makeWebhookUrl(request, logId, 'ask_dayuse', turn + 1);
        const timeInfo = bookingCheckInTime && bookingCheckOutTime ? ` from ${bookingCheckInTime} to ${bookingCheckOutTime}` : '';
        return gatherTwiml(action, `We have a guest looking to book a day-use stay on ${bookingCheckInDate}${timeInfo}, for ${bookingGuests} ${bookingGuests === 1 ? 'person' : 'people'}. Do you offer day-use plans? Press 1 or say yes. Press 2 or say no.`);
      }
      if (isYes(speech, digits)) {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_dayuse_yes', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 1'}`);
        const action = makeWebhookUrl(request, logId, 'ask_price', 0);
        return gatherTwiml(action, 'What is the final total price in US dollars, including all service fees and taxes? The guest will pay the hotel directly on-site. For example, say fifty dollars, or enter the amount and press the hash key.', { timeout: 10, finishOnKey: '#', preface: 'Thank you.' });
      }
      if (isNo(speech, digits)) {
        await updateCallLog(db, logId, 'declined', 'twilio_dayuse_no', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 2'}`);
        if (db && booking?.id) {
          await db.prepare(`UPDATE bookings SET status='declined_by_hotel', updated_at=datetime('now') WHERE id=?`).bind(booking.id).run().catch(() => {});
        }
        return twiml(`<Say voice="${VOICE}">Understood. We currently have guests seeking day-use stays in your area. We may follow up to discuss whether a day-use plan could work for your property. Thank you for your time. Goodbye!</Say><Hangup/>`);
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
        return gatherTwiml(action, 'What is the final total price in US dollars, including all service fees and taxes? The guest will pay the hotel directly on-site. For example, say fifty dollars, or enter the amount and press the hash key.', { timeout: 10, finishOnKey: '#' });
      }
      const amount = parsePrice(speech, digits);
      if (amount != null) {
        await updateCallLog(db, logId, 'awaiting_response', `twilio_price:${amount}`, callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || `DTMF:${digits}`}\n[Agent]: Confirming price ${amount}`);
        const action = makeWebhookUrl(request, logId, 'confirm_booking', 0);
        return gatherTwiml(action, `To confirm your reservation: The date is ${bookingCheckInDate}, time is ${bookingCheckInTime} to ${bookingCheckOutTime}, for ${bookingGuests} ${bookingGuests === 1 ? 'person' : 'people'}. The final total amount including taxes and fees is ${amount} dollars, to be paid on-site at check-in. If you agree to all these details and confirm the booking, press 1 or say yes. To decline, press 2 or say no. If the amount is different, please say the correct amount, or enter the amount and then press the hash key.`, { preface: 'Thank you.' });
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_price_no_answer', callSid ? `twilio:${callSid}` : undefined);
        return twiml(`<Say voice="${VOICE}">We could not capture the amount after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'ask_price', turn + 1);
      return gatherTwiml(action, 'Could you please repeat the final total price in US dollars, including all service fees and taxes? The guest will pay the hotel directly on-site. You can also enter digits and press the hash key.');
    }

    if (step === 'confirm_booking') {
      const amount = parsePrice(speech, digits);
      if (amount != null && !isYes(speech, digits) && !isNo(speech, digits)) {
        await updateCallLog(db, logId, 'awaiting_response', `twilio_price_corrected:${amount}`, callSid ? `twilio:${callSid}` : undefined, `[Hotel]: corrected price ${amount}`);
        const action = makeWebhookUrl(request, logId, 'confirm_booking', turn + 1);
        return gatherTwiml(action, `To confirm your reservation: The date is ${bookingCheckInDate}, time is ${bookingCheckInTime} to ${bookingCheckOutTime}, for ${bookingGuests} ${bookingGuests === 1 ? 'person' : 'people'}. The final total amount including taxes and fees is ${amount} dollars, to be paid on-site at check-in. If you agree to all these details and confirm the booking, press 1 or say yes. To decline, press 2 or say no. If the amount is different, please say the correct amount, or enter the amount and then press the hash key.`, { preface: 'Thank you.' });
      }
      if (isYes(speech, digits)) {
        const finalAmount = quotedAmountFromNote;
        const guestName = bookingGuestName;
        await updateCallLog(db, logId, 'confirmed', 'twilio_booking_confirmed', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 1'}`);
        if (db && booking?.id) {
          await db.prepare(`UPDATE bookings SET status='confirmed_by_hotel', updated_at=datetime('now') WHERE id=?`).bind(booking.id).run().catch(() => {});
        }
        return twiml(`<Say voice="${VOICE}">Thank you! All consent checks are complete. The reservation is confirmed at a final total of ${esc(finalAmount != null ? finalAmount : 'the agreed')} dollars, including service fees and taxes. Payment will be made directly at the hotel by the guest. We will send a follow-up confirmation email shortly with all the details. For your immediate records, the guest's name is ${esc(guestName)}. Have a wonderful day!</Say><Hangup/>`);
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
      if (quotedAmountFromNote != null) {
        return gatherTwiml(action, `Sorry, I could not hear your response clearly. To confirm your reservation: The date is ${bookingCheckInDate}, time is ${bookingCheckInTime} to ${bookingCheckOutTime}, for ${bookingGuests} ${bookingGuests === 1 ? 'person' : 'people'}. The final total amount including taxes and fees is ${quotedAmountFromNote} dollars, to be paid on-site at check-in. If you agree to all these details and confirm the booking, press 1 or say yes. To decline, press 2 or say no. If the amount is different, please say the correct amount, or enter the amount and then press the hash key.`);
      }
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
