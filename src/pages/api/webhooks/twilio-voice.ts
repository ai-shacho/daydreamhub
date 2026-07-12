import type { APIRoute } from 'astro';
import { sendConciergeResultEmail, type ConciergeResultEmailType } from '../../../lib/email';
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
  | 'outreach_phase_0_5'
  | 'outreach_phase_1'
  | 'outreach_phase_2_verify'
  | 'outreach_phase_2'
  | 'outreach_phase_4'
  | 'outreach_phase_5'
  | 'outreach_phase_callback_time'
  | 'outreach_phase_callback_name'
  | 'outreach_phase_callback_email'
  | 'ask_dayuse'
  | 'ask_price'
  | 'confirm_booking'
  | 'confirm_booking_details';

const MAX_RETRY = 3;
const WEBHOOK_BASE = 'https://daydreamhub.com';
const VOICE = 'Polly.Joanna';

function getWebhookBase(request: Request): string {
  const reqUrl = new URL(request.url);
  const env = (globalThis as any)?.process?.env;
  const base = String(env?.PUBLIC_BASE_URL || env?.SITE_URL || reqUrl.origin || WEBHOOK_BASE).trim();
  if (!base) return WEBHOOK_BASE;
  return base.replace(/\/$/, '');
}

function sayText(text: string, opts?: { slow?: boolean }): string {
  const escaped = esc(text);
  const body = opts?.slow ? `<prosody rate="slow">${escaped}</prosody>` : escaped;
  return `<Say voice="${VOICE}">${body}</Say>`;
}

function gatherTwiml(action: string, prompt: string, opts?: { timeout?: number; finishOnKey?: string; preface?: string; slow?: boolean }): Response {
  const timeout = opts?.timeout ?? 8;
  const finishOnKey = opts?.finishOnKey ? ` finishOnKey="${esc(opts.finishOnKey)}"` : '';
  const preface = opts?.preface ? sayText(opts.preface, { slow: opts?.slow }) : '';
  return twiml(
    `${preface}<Gather input="speech dtmf" timeout="${timeout}" speechTimeout="auto" actionOnEmptyResult="true" language="en-US" action="${esc(action)}" method="POST"${finishOnKey}>` +
    `${sayText(prompt, { slow: opts?.slow })}` +
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
  if (s === 'outreach_phase_0_5') return 'outreach_phase_0_5';
  if (s === 'outreach_phase_1') return 'outreach_phase_1';
  if (s === 'outreach_phase_2_verify') return 'outreach_phase_2_verify';
  if (s === 'outreach_phase_2') return 'outreach_phase_2';
  if (s === 'outreach_phase_4') return 'outreach_phase_4';
  if (s === 'outreach_phase_5') return 'outreach_phase_5';
  if (s === 'outreach_phase_callback_time') return 'outreach_phase_callback_time';
  if (s === 'outreach_phase_callback_name') return 'outreach_phase_callback_name';
  if (s === 'outreach_phase_callback_email') return 'outreach_phase_callback_email';
  if (s === 'ask_dayuse') return 'ask_dayuse';
  if (s === 'ask_price') return 'ask_price';
  if (s === 'confirm_booking') return 'confirm_booking';
  if (s === 'confirm_booking_details') return 'confirm_booking_details';
  return 'intro';
}

function parseTurn(raw: string | null): number {
  const n = Number(raw || '0');
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), 8);
}

function makeWebhookUrl(request: Request, logId: string | null, step: Step, phase: 'booking' | 'outreach' | 'concierge', turn = 0, event?: string): string {
  const u = new URL('/api/webhooks/twilio-voice', getWebhookBase(request));
  if (logId) u.searchParams.set('lid', logId);
  if (phase === 'concierge') {
    const conciergeId = logId && /^\d+$/.test(logId) ? logId : null;
    if (conciergeId) u.searchParams.set('cid', conciergeId);
  }
  u.searchParams.set('step', step);
  u.searchParams.set('turn', String(turn));
  u.searchParams.set('phase', phase);
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

function parseJsonWithGuard(raw: unknown, context: string): any {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;

  const text = String(raw).trim();
  if (!text) return {};

  try {
    const first = JSON.parse(text);
    if (typeof first === 'string') {
      const nested = first.trim();
      if (!nested) return {};
      try {
        return JSON.parse(nested);
      } catch (nestedErr) {
        console.error(`[twilio-voice] ${context} double-JSON parse failed`, {
          error: nestedErr,
          sample: clamp(nested, 300),
        });
        return {};
      }
    }
    if (first && typeof first === 'object') return first;
    return {};
  } catch (err) {
    console.error(`[twilio-voice] ${context} JSON.parse failed`, {
      error: err,
      sample: clamp(text, 300),
    });
    return {};
  }
}

function normalizeConciergeDetails(raw: any): any {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const adults = Number(src.adults || 0) || 0;
  const children = Number(src.children || 0) || 0;
  const guestsNum = Number(src.guests ?? src.guest_count);
  const guests = Number.isFinite(guestsNum) && guestsNum > 0
    ? guestsNum
    : ((adults > 0 ? adults : 1) + children);

  return {
    ...src,
    check_in_date: src.check_in_date || src.date || '',
    check_in_time: src.check_in_time || src.check_in || '',
    check_out_time: src.check_out_time || src.check_out || '',
    guests,
  };
}

function hasCoreConciergeSchedule(details: any): boolean {
  if (!details || typeof details !== 'object') return false;
  return Boolean(
    String(details.check_in_date || '').trim() &&
    String(details.check_in_time || '').trim() &&
    String(details.check_out_time || '').trim()
  );
}

async function findConciergeCallIdFromLog(db: DbLike | null, logId: string | null): Promise<string | null> {
  if (!db || !logId) return null;
  try {
    const colsQ = db.prepare(`PRAGMA table_info(call_logs)`);
    const colsR = (typeof colsQ.all === 'function') ? await colsQ.all() : await colsQ.bind().run();
    const cols = new Set((colsR?.results || []).map((r: any) => String(r?.name || '')));

    const candidates = ['concierge_call_id', 'concierge_id', 'related_concierge_call_id'].filter((c) => cols.has(c));
    for (const col of candidates) {
      const row: any = await db.prepare(`SELECT ${col} AS concierge_call_id FROM call_logs WHERE id = ? LIMIT 1`).bind(logId).first().catch((e: any) => {
        console.error('[twilio-voice] findConciergeCallIdFromLog SELECT failed', { col, logId, message: e?.message || String(e) });
        return null;
      });
      const v = String(row?.concierge_call_id || '').trim();
      if (v && /^\d+$/.test(v)) return v;
    }
    return null;
  } catch (e) {
    console.error('[twilio-voice] findConciergeCallIdFromLog failed', e);
    return null;
  }
}

async function resolveConciergeCallByClues(
  db: DbLike | null,
  clues: { cid?: string | null; logId?: string | null; linkedConciergeCallIdFromLog?: string | null; callSid?: string | null }
): Promise<{ row: any | null; resolvedId: string | null; attemptedPaths: string[] }> {
  if (!db) return { row: null, resolvedId: null, attemptedPaths: [] };

  const cid = String(clues.cid || '').trim() || null;
  const logId = String(clues.logId || '').trim() || null;
  const linked = String(clues.linkedConciergeCallIdFromLog || '').trim() || null;
  const callSid = String(clues.callSid || '').trim() || null;
  const twilioCallRef = callSid ? `twilio:${callSid}` : null;

  const attemptedPaths: string[] = [];
  const colsQ = db.prepare(`PRAGMA table_info(concierge_calls)`);
  const colsR = (typeof colsQ.all === 'function') ? await colsQ.all() : await colsQ.bind().run();
  const cols = new Set((colsR?.results || []).map((r: any) => String(r?.name || '')));

  const tryFetchBy = async (label: string, sql: string, ...binds: any[]) => {
    attemptedPaths.push(label);
    return await db.prepare(sql).bind(...binds).first().catch((e: any) => {
      console.error('[twilio-voice] resolveConciergeCallByClues SELECT failed', {
        label,
        binds,
        message: e?.message || String(e),
      });
      return null;
    });
  };

  // Absolute rule for concierge phase:
  // if cid is present, resolve concierge_calls.id = cid first and do not fall back to call_logs clues.
  if (cid && /^\d+$/.test(cid)) {
    const row = await tryFetchBy('concierge_calls.id_from_cid', `SELECT id, call_group_id, outcome, status, guest_name, guest_email, hotel_name, hotel_phone, request_details, price_quoted, ai_summary FROM concierge_calls WHERE id = ? LIMIT 1`, cid);
    if (row?.id) return { row, resolvedId: String(row.id), attemptedPaths };
    return { row: null, resolvedId: cid, attemptedPaths };
  }

  if (linked && /^\d+$/.test(linked)) {
    const row = await tryFetchBy('linked_concierge_call_id_from_log', `SELECT id, call_group_id, outcome, status, guest_name, guest_email, hotel_name, hotel_phone, request_details, price_quoted, ai_summary FROM concierge_calls WHERE id = ? LIMIT 1`, linked);
    if (row?.id) return { row, resolvedId: String(row.id), attemptedPaths };
  }

  if (twilioCallRef && cols.has('telnyx_call_id')) {
    const row = await tryFetchBy('telnyx_call_id_from_twilio_callsid', `SELECT id, call_group_id, outcome, status, guest_name, guest_email, hotel_name, hotel_phone, request_details, price_quoted, ai_summary FROM concierge_calls WHERE telnyx_call_id = ? ORDER BY id DESC LIMIT 1`, twilioCallRef);
    if (row?.id) return { row, resolvedId: String(row.id), attemptedPaths };
  }

  if (logId && /^\d+$/.test(logId)) {
    const row = await tryFetchBy('concierge_calls.id_from_lid', `SELECT id, call_group_id, outcome, status, guest_name, guest_email, hotel_name, hotel_phone, request_details, price_quoted, ai_summary FROM concierge_calls WHERE id = ? LIMIT 1`, logId);
    if (row?.id) return { row, resolvedId: String(row.id), attemptedPaths };
  }

  const possibleLogIdCols = ['call_log_id', 'related_call_log_id', 'source_call_log_id'].filter((c) => cols.has(c));
  for (const col of possibleLogIdCols) {
    if (!logId) break;
    const row = await tryFetchBy(`concierge_calls.${col}_from_lid`, `SELECT id, call_group_id, outcome, status, guest_name, guest_email, hotel_name, hotel_phone, request_details, price_quoted, ai_summary FROM concierge_calls WHERE ${col} = ? ORDER BY id DESC LIMIT 1`, logId);
    if (row?.id) return { row, resolvedId: String(row.id), attemptedPaths };
  }

  return { row: null, resolvedId: null, attemptedPaths };
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

function isCallbackIntent(speech: string): boolean {
  return /\b(callback|call back|call me back|have .*call you back|we.?ll call you back|ring you back|return your call|later today|another time)\b/i.test(speech);
}

function looksLikeConcreteDateTime(speech: string): boolean {
  const s = String(speech || '');
  if (/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this afternoon|this evening)\b/i.test(s)) return true;
  if (/\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(s)) return true;
  if (/\b\d{1,2}\s?(o'clock)?\b/i.test(s) && /\b(at|around|by)\b/i.test(s)) return true;
  if (/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/.test(s)) return true;
  return false;
}

function extractEmail(speech: string): string | null {
  const normalized = String(speech || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const direct = normalized.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  if (direct) return direct;
  const spoken = normalized
    .replace(/\s+at\s+/g, '@')
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s+/g, '');
  const fromSpoken = spoken.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  return fromSpoken || null;
}

function classifyOutreachPhase0(speech: string, digits: string): 'available' | 'transfer' | 'absent' | 'callback' | 'reject' | 'unknown' {
  if (digits === '1') return 'available';
  if (digits === '2') return 'absent';
  if (/\b(yes|speaking|available|this is|i am|i'm)\b/i.test(speech)) return 'available';
  if (/\b(transfer|hold on|hold please|please hold|put you through|connecting you|one moment)\b/i.test(speech)) return 'transfer';
  if (isCallbackIntent(speech)) return 'callback';
  if (/\b(not here|absent|away|out of office|not available|left|later)\b/i.test(speech)) return 'absent';
  if (/\b(stop|remove|not interested|decline|do not call|dont call)\b/i.test(speech)) return 'reject';
  return 'unknown';
}

function classifyOutreachPhase2(speech: string, digits: string): 'materials' | 'meeting' | 'callback' | 'reject' | 'unknown' {
  if (digits === '1') return 'materials';
  if (digits === '2') return 'meeting';
  if (/\b(material|brochure|deck|document|send|info)\b/i.test(speech)) return 'materials';
  if (isCallbackIntent(speech)) return 'callback';
  if (/\b(meeting|follow up|appointment|schedule|talk)\b/i.test(speech)) return 'meeting';
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

async function sendResultEmailOnce(env: any, db: DbLike | null, conciergeCallId: string | null, resultType: ConciergeResultEmailType) {
  if (!db || !conciergeCallId || !env?.RESEND_API_KEY) return;
  const call: any = await db.prepare(
    `SELECT id, call_group_id, guest_name, guest_email, hotel_name, hotel_phone, request_details, ai_summary, price_quoted
       FROM concierge_calls WHERE id = ?`
  ).bind(conciergeCallId).first().catch((e: any) => {
    console.error('[twilio-voice] sendResultEmailOnce SELECT concierge_calls failed', { conciergeCallId, message: e?.message || String(e) });
    return null;
  });
  if (!call?.guest_email) return;

  if (resultType === 'all_failed' && call.call_group_id) {
    const claim: any = await db.prepare(
      `UPDATE concierge_calls SET result_email_sent = 1, updated_at = datetime('now') WHERE call_group_id = ? AND result_email_sent = 0`
    ).bind(call.call_group_id).run().catch((e: any) => {
      console.error('[twilio-voice] sendResultEmailOnce claim all_failed update failed', { call_group_id: call.call_group_id, message: e?.message || String(e) });
      return null;
    });
    if (Number(claim?.meta?.changes || 0) === 0) return;

    const attemptedRows: any[] = await db.prepare(
      `SELECT hotel_name FROM concierge_calls WHERE call_group_id = ? ORDER BY call_order ASC, id ASC`
    ).bind(call.call_group_id).all().then((r: any) => r?.results || []).catch(() => []);

    const details: any = normalizeConciergeDetails(parseJsonWithGuard(call.request_details, 'concierge_calls.request_details(all_failed_email)'));

    await sendConciergeResultEmail(env.RESEND_API_KEY, {
      guestName: call.guest_name || 'Guest',
      guestEmail: call.guest_email,
      resultType: 'all_failed',
      date: details.check_in_date || details.date || '',
      checkIn: details.check_in_time || details.check_in || '',
      checkOut: details.check_out_time || details.check_out || '',
      guests: details.guests || 1,
      aiSummary: call.ai_summary || undefined,
      attemptedHotels: attemptedRows.map((r: any) => r.hotel_name).filter(Boolean),
    }).catch((e: any) => console.error('[twilio-voice] result email failed', e));
    return;
  }

  const claim: any = await db.prepare(
    `UPDATE concierge_calls SET result_email_sent = 1, updated_at = datetime('now') WHERE id = ? AND result_email_sent = 0`
  ).bind(conciergeCallId).run().catch((e: any) => {
    console.error('[twilio-voice] sendResultEmailOnce claim single update failed', { conciergeCallId, message: e?.message || String(e) });
    return null;
  });
  if (Number(claim?.meta?.changes || 0) === 0) return;

  const details: any = normalizeConciergeDetails(parseJsonWithGuard(call.request_details, 'concierge_calls.request_details(result_email)'));

  await sendConciergeResultEmail(env.RESEND_API_KEY, {
    guestName: call.guest_name || 'Guest',
    guestEmail: call.guest_email,
    resultType,
    hotelName: call.hotel_name || undefined,
    hotelPhone: call.hotel_phone || undefined,
    date: details.check_in_date || details.date || '',
    checkIn: details.check_in_time || details.check_in || '',
    checkOut: details.check_out_time || details.check_out || '',
    guests: details.guests || 1,
    priceQuoted: call.price_quoted || undefined,
    aiSummary: call.ai_summary || undefined,
  }).catch((e: any) => console.error('[twilio-voice] result email failed', e));
}

async function sendAdminConciergeBookedEmail(env: any, db: DbLike | null, conciergeCallId: string | null) {
  if (!db || !conciergeCallId || !env?.RESEND_API_KEY || !env?.ADMIN_EMAIL) return;
  const call: any = await db.prepare(
    `SELECT id, guest_name, guest_email, hotel_name, hotel_phone, request_details, ai_summary, price_quoted
     FROM concierge_calls WHERE id = ?`
  ).bind(conciergeCallId).first().catch((e: any) => {
    console.error('[twilio-voice] sendAdminConciergeBookedEmail SELECT concierge_calls failed', { conciergeCallId, message: e?.message || String(e) });
    return null;
  });
  if (!call) return;

  const details: any = normalizeConciergeDetails(parseJsonWithGuard(call.request_details, 'concierge_calls.request_details(admin_email)'));

  const payload = {
    from: 'DaydreamHub <noreply@daydreamhub.com>',
    to: [env.ADMIN_EMAIL],
    subject: `[AI Concierge] Booking confirmed - ${call.hotel_name || 'Unknown hotel'}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#111827">
        <h2 style="margin:0 0 16px">AI Concierge Booking Confirmed (Twilio)</h2>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Guest Name</td><td style="padding:8px;border:1px solid #e5e7eb">${call.guest_name || '-'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Guest Email</td><td style="padding:8px;border:1px solid #e5e7eb">${call.guest_email || '-'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Guest Phone</td><td style="padding:8px;border:1px solid #e5e7eb">${details.guest_phone || '-'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Hotel</td><td style="padding:8px;border:1px solid #e5e7eb">${call.hotel_name || '-'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Hotel Phone</td><td style="padding:8px;border:1px solid #e5e7eb">${call.hotel_phone || '-'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Date</td><td style="padding:8px;border:1px solid #e5e7eb">${details.check_in_date || details.date || '-'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">Check-in / Check-out</td><td style="padding:8px;border:1px solid #e5e7eb">${details.check_in_time || details.check_in || '-'} / ${details.check_out_time || details.check_out || '-'}</td></tr>
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
  }).catch((e: any) => console.error('[twilio-voice] admin concierge email failed', e));
}

async function finalizeConciergeOutcome(
  env: any,
  db: DbLike | null,
  conciergeCallId: string | null,
  outcome: 'booked' | 'available' | 'unavailable' | 'no_answer',
  aiSummary: string,
  opts: { priceQuoted?: number | null; sendAdminBooked?: boolean } = {}
): Promise<boolean> {
  if (!db || !conciergeCallId) return false;
  const claim: any = await db.prepare(
    `UPDATE concierge_calls
       SET status = 'completed',
           outcome = ?,
           ai_summary = ?,
           price_quoted = COALESCE(?, price_quoted),
           updated_at = datetime('now')
     WHERE id = ?
       AND COALESCE(outcome, '') NOT IN ('booked','available','unavailable','no_answer')`
  ).bind(outcome, clamp(aiSummary, 500), opts.priceQuoted ?? null, conciergeCallId).run().catch((e: any) => {
    console.error('[twilio-voice] finalizeConciergeOutcome UPDATE concierge_calls failed', { conciergeCallId, outcome, message: e?.message || String(e) });
    return null;
  });

  if (Number(claim?.meta?.changes || 0) === 0) return false;

  if (outcome === 'booked') {
    await sendResultEmailOnce(env, db, conciergeCallId, 'success');
    if (opts.sendAdminBooked) await sendAdminConciergeBookedEmail(env, db, conciergeCallId);
  } else if (outcome === 'unavailable') {
    await sendResultEmailOnce(env, db, conciergeCallId, 'declined');
  } else if (outcome === 'no_answer') {
    await sendResultEmailOnce(env, db, conciergeCallId, 'no_answer');
  }

  const call: any = await db.prepare(`SELECT call_group_id FROM concierge_calls WHERE id = ?`).bind(conciergeCallId).first().catch((e: any) => {
    console.error('[twilio-voice] finalizeConciergeOutcome SELECT call_group_id failed', { conciergeCallId, message: e?.message || String(e) });
    return null;
  });
  const groupId = Number(call?.call_group_id || 0) || null;
  if (!groupId) return true;

  if (outcome === 'booked' || outcome === 'available') {
    await db.prepare("UPDATE concierge_call_groups SET status = 'success', updated_at = datetime('now') WHERE id = ? AND status != 'success'")
      .bind(groupId).run().catch(() => {});
    return true;
  }

  const next = await initiateNextGroupCall(env, db, groupId).catch((e) => {
    console.error('[twilio-voice] initiateNextGroupCall failed', e);
    return null;
  });

  if (next?.status === 'all_failed') {
    await processGroupRefund(env, db, groupId).catch((e) => {
      console.error('[twilio-voice] processGroupRefund failed', e);
    });
    await sendResultEmailOnce(env, db, conciergeCallId, 'all_failed');
  }
  return true;
}

export const POST: APIRoute = async ({ request, locals, url }) => {
  try {
    const env = (locals as any)?.runtime?.env;
    const db: DbLike | null = env?.DB && typeof env.DB.prepare === 'function' ? env.DB : null;

    const logId = normalizeLogId(url.searchParams.get('lid'));
    const cid = normalizeLogId(url.searchParams.get('cid'));
    const step = normalizeStep(url.searchParams.get('step'));
    const turn = parseTurn(url.searchParams.get('turn'));
    const event = clamp(url.searchParams.get('event') || '', 40).toLowerCase();

    const form = await readTwilioParams(request);
    const callSid = clamp(form.get('CallSid') || '', 120);
    const digits = clamp(form.get('Digits') || '', 32);
    const speech = clamp(form.get('SpeechResult') || form.get('UnstableSpeechResult') || '', 500);
    const callStatus = clamp(form.get('CallStatus') || '', 40).toLowerCase();

    const phaseParam = String(url.searchParams.get('phase') || '').toLowerCase();
    const logRow: any = (db && logId)
      ? await db.prepare(`SELECT id, booking_id, note, phase FROM call_logs WHERE id = ?`).bind(logId).first().catch((e: any) => {
        console.error('[twilio-voice] POST SELECT call_logs failed', { logId, message: e?.message || String(e) });
        return null;
      })
      : null;

    const inferredPhase = (() => {
      if (phaseParam === 'outreach' || phaseParam === 'concierge' || phaseParam === 'booking') return phaseParam;
      const p = String(logRow?.phase || '').toLowerCase();
      if (p === 'outreach' || p === 'concierge' || p === 'booking') return p;
      if (String(logRow?.note || '').toLowerCase().includes('outreach')) return 'outreach';
      return 'booking';
    })();

    await insertCallLogEvent(db, logId, {
      eventType: event === 'status' ? 'status_callback' : 'gather_webhook',
      phase: inferredPhase || undefined,
      step,
      turn,
      callSid: callSid || undefined,
      callStatus: callStatus || undefined,
      digits: digits || undefined,
      speech: speech || undefined,
      payload: Object.fromEntries(form.entries()),
    });

    if (event === 'status') {
      const linkedConciergeCallIdFromLog = (db && logId && inferredPhase === 'concierge' && !cid)
        ? await findConciergeCallIdFromLog(db, logId)
        : null;

      const conciergeResolution = (db && inferredPhase === 'concierge')
        ? await resolveConciergeCallByClues(db, {
            cid,
            logId,
            linkedConciergeCallIdFromLog,
            callSid,
          })
        : { row: null, resolvedId: null, attemptedPaths: [] as string[] };

      const conciergeRow: any = conciergeResolution.row;
      const statusTargetConciergeCallId = conciergeResolution.resolvedId || cid || linkedConciergeCallIdFromLog || logId;

      if (!conciergeRow && inferredPhase === 'concierge') {
        console.warn('[twilio-voice] concierge status callback could not resolve target record before placeholder fallback', {
          phaseParam,
          inferredPhase,
          logId,
          linkedConciergeCallIdFromLog,
          statusTargetConciergeCallId,
          callSid: callSid || null,
          twilioCallRef: callSid ? `twilio:${callSid}` : null,
          callStatus: callStatus || null,
          attemptedPaths: conciergeResolution.attemptedPaths || [],
        });
      }

      if (conciergeRow) {
        const alreadyTerminal = ['booked', 'available', 'unavailable', 'no_answer'].includes(String(conciergeRow.outcome || ''));
        if (alreadyTerminal) return new Response('ok', { status: 200 });

        if (['busy', 'failed', 'canceled'].includes(callStatus)) {
          await finalizeConciergeOutcome(env, db, String(conciergeRow.id), 'unavailable', `twilio_status:${callStatus || 'unknown'}`);
        } else if (callStatus === 'no-answer') {
          await finalizeConciergeOutcome(env, db, String(conciergeRow.id), 'no_answer', `twilio_status:${callStatus || 'unknown'}`);
        } else {
          await updateConciergeCallStatus(db, String(conciergeRow.id), callStatus === 'completed' ? 'completed' : 'calling', {
            telnyx_call_id: callSid ? `twilio:${callSid}` : undefined,
            ai_summary: `twilio_status:${callStatus || 'unknown'}`,
          });
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
          phase: inferredPhase || undefined,
          step,
          eventType: 'status_callback',
          callStatus: callStatus || undefined,
          answeredAt: callStatus === 'answered',
          endedAt: ['completed', 'busy', 'failed', 'canceled', 'no-answer'].includes(callStatus),
        }
      );
      return new Response('ok', { status: 200 });
    }

    let phase: 'booking' | 'outreach' | 'concierge' = inferredPhase === 'outreach' || inferredPhase === 'concierge'
      ? inferredPhase
      : 'booking';

    let booking: any = null;
    let outreachLead: any = null;
    let conciergeCall: any = null;
    let conciergeDetails: any = {};
    let resolvedConciergeCallId: string | null = null;
    let bookingTestMeta: { guest_name?: string; guest_count?: number; check_in_date?: string; check_in_time?: string; check_out_time?: string } | null = null;
    let quotedAmountFromNote: number | null = readQuotedAmountFromNote(logRow?.note);

    if (db && logId) {
      if (phase !== 'concierge') {
        bookingTestMeta = readBookingTestMetaFromNote(logRow?.note);
        if (logRow?.booking_id) {
          booking = await db.prepare(`SELECT b.id, b.guest_name, b.guest_email, b.guest_phone, b.check_in_date, COALESCE(b.check_in_time, p.check_in_time) AS check_in_time, COALESCE(b.check_out_time, p.check_out_time) AS check_out_time, (COALESCE(b.adults,0) + COALESCE(b.children,0)) AS guests, h.name AS hotel_name FROM bookings b LEFT JOIN hotels h ON h.id = b.hotel_id LEFT JOIN plans p ON p.id = b.plan_id WHERE b.id = ?`).bind(logRow.booking_id).first().catch((e: any) => {
            console.error('[twilio-voice] POST SELECT bookings failed', { bookingId: logRow.booking_id, message: e?.message || String(e) });
            return null;
          });
        }
        if (String(logRow?.note || '').toLowerCase().includes('outreach')) {
          phase = 'outreach';
          outreachLead = await db.prepare(`SELECT l.id, l.hotel_name, l.person_in_charge_name FROM outreach_leads l WHERE l.call_log_id = ? ORDER BY l.id DESC LIMIT 1`).bind(logId).first().catch((e: any) => {
            console.error('[twilio-voice] POST SELECT outreach_leads failed', { logId, message: e?.message || String(e) });
            return null;
          });
        }
      } else {
        const linkedConciergeCallIdFromLog = cid ? null : await findConciergeCallIdFromLog(db, logId);
        const conciergeResolution = await resolveConciergeCallByClues(db, {
          cid,
          logId,
          linkedConciergeCallIdFromLog,
          callSid,
        });

        conciergeCall = conciergeResolution.row;
        resolvedConciergeCallId = conciergeResolution.resolvedId || cid || linkedConciergeCallIdFromLog || logId;

        if (!conciergeCall?.id) {
          console.warn('[twilio-voice] concierge gather webhook could not resolve concierge_calls record before placeholder fallback', {
            phaseParam,
            inferredPhase,
            logId,
            linkedConciergeCallIdFromLog,
            resolvedConciergeCallId,
            callSid: callSid || null,
            twilioCallRef: callSid ? `twilio:${callSid}` : null,
            attemptedPaths: conciergeResolution.attemptedPaths || [],
          });
        }

        if (conciergeCall?.request_details) {
          conciergeDetails = normalizeConciergeDetails(parseJsonWithGuard(conciergeCall.request_details, 'concierge_calls.request_details'));
          if (Object.keys(conciergeDetails || {}).length === 0) {
            console.error('[Twilio Webhook Error] concierge_calls.request_details parsed to empty object.', {
              phaseParam,
              logId,
              resolvedConciergeCallId,
              requestDetailsSample: clamp(conciergeCall.request_details, 300),
            });
          }
        }

        if ((!hasCoreConciergeSchedule(conciergeDetails)) && conciergeCall?.call_group_id) {
          const groupRow: any = await db
            .prepare('SELECT request_details FROM concierge_call_groups WHERE id = ? LIMIT 1')
            .bind(conciergeCall.call_group_id)
            .first()
            .catch((e: any) => {
              console.error('[twilio-voice] POST SELECT concierge_call_groups failed', { call_group_id: conciergeCall.call_group_id, message: e?.message || String(e) });
              return null;
            });
          if (groupRow?.request_details) {
            const groupDetails = normalizeConciergeDetails(parseJsonWithGuard(groupRow.request_details, 'concierge_call_groups.request_details'));
            conciergeDetails = normalizeConciergeDetails({ ...groupDetails, ...conciergeDetails });
          }
        }

        const requiredConciergeDetailKeys = ['check_in_date', 'check_in_time', 'check_out_time'];
        const missingRequiredConciergeKeys = requiredConciergeDetailKeys.filter((k) => conciergeDetails?.[k] == null || String(conciergeDetails[k]).trim() === '');
        if (missingRequiredConciergeKeys.length > 0) {
          console.warn('[Twilio Webhook Warn] conciergeDetails missing required keys.', {
            phaseParam,
            logId,
            resolvedConciergeCallId,
            missingKeys: missingRequiredConciergeKeys,
            availableKeys: Object.keys(conciergeDetails || {}),
            call_group_id: conciergeCall?.call_group_id || null,
          });
        }
      }
    }

    const bookingCheckInDate = phase === 'concierge'
      ? (conciergeDetails.check_in_date || conciergeDetails.date || 'the requested date')
      : (booking?.check_in_date || bookingTestMeta?.check_in_date || 'the requested date');
    const bookingCheckInTimeRaw = phase === 'concierge'
      ? (conciergeDetails.check_in_time || conciergeDetails.check_in || 'the requested start time')
      : (booking?.check_in_time || bookingTestMeta?.check_in_time || 'the requested start time');
    const bookingCheckOutTimeRaw = phase === 'concierge'
      ? (conciergeDetails.check_out_time || conciergeDetails.check_out || 'the requested end time')
      : (booking?.check_out_time || bookingTestMeta?.check_out_time || 'the requested end time');
    const bookingCheckInTime = toAmPm(bookingCheckInTimeRaw);
    const bookingCheckOutTime = toAmPm(bookingCheckOutTimeRaw);
    const bookingGuests = Number(
      phase === 'concierge'
        ? (conciergeDetails.guests ?? ((conciergeDetails.adults || 1) + (conciergeDetails.children || 0)) ?? 1)
        : (booking?.guests || bookingTestMeta?.guest_count || 1)
    );
    const bookingGuestName = phase === 'concierge'
      ? (conciergeCall?.guest_name || conciergeDetails.guest_name || 'the guest')
      : (booking?.guest_name || bookingTestMeta?.guest_name || 'the guest');
    const bookingGuestEmail = phase === 'concierge'
      ? (conciergeCall?.guest_email || conciergeDetails.guest_email || '')
      : (booking?.guest_email || '');
    const bookingGuestPhone = phase === 'concierge'
      ? (conciergeCall?.guest_phone || conciergeDetails.guest_phone || '')
      : (booking?.guest_phone || '');
    if (phase === 'concierge' && quotedAmountFromNote == null) {
      const q = Number(conciergeCall?.price_quoted || 0);
      if (Number.isFinite(q) && q > 0) quotedAmountFromNote = q;
    }

    if (step === 'intro') {
      if (phase === 'outreach') {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_phase_0', callSid ? `twilio:${callSid}` : undefined);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_0', inferredPhase, 0);
        return gatherTwiml(action, 'Hello. We are DayDreamHub, a platform that matches guests with hotel day-use rooms. We are calling today to invite your property to be listed on our site. Is the manager or person in charge available? Press 1 if available now, or press 2 if not available. You can also answer by voice.');
      }

      await updateCallLog(db, logId, 'awaiting_response', 'twilio_booking_intro', callSid ? `twilio:${callSid}` : undefined);
      const action = makeWebhookUrl(request, logId, 'ask_dayuse', inferredPhase, 0);
      const timeInfo = bookingCheckInTime && bookingCheckOutTime ? ` from ${bookingCheckInTime} to ${bookingCheckOutTime}` : '';
      const prompt = `We have a guest looking to book a day-use stay on ${bookingCheckInDate}${timeInfo}, for ${bookingGuests} ${bookingGuests === 1 ? 'person' : 'people'}. Do you offer day-use plans? Press 1 or say yes. Press 2 or say no. Press 3 to hear this again.`;
      return gatherTwiml(action, prompt);
    }

    if (step === 'outreach_phase_0') {
      const decision = classifyOutreachPhase0(speech, digits);
      if (decision === 'available') {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_phase_0_available', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || `pressed ${digits || '1'}`}`);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_2', inferredPhase, 0);
        return gatherTwiml(action, 'Thank you. DayDreamHub offers free listings for hotels. Would you prefer we send materials first, or schedule a short explanation call? Press 1 for materials, or press 2 for a short meeting call.');
      }
      if (decision === 'transfer') {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_phase_0_transfer_detected', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'transfer indicated'}`);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_0_5', inferredPhase, 0);
        return gatherTwiml(action, 'Thank you. I will hold. Hello, this is DayDreamHub. If the person in charge is now on the line, please say hello.', { timeout: 12 });
      }
      if (decision === 'callback') {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_callback_requested_phase_0', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech}`);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_callback_time', inferredPhase, 0);
        return gatherTwiml(action, 'Certainly. What date and time should we call back?', { timeout: 10 });
      }
      if (decision === 'absent') {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_phase_0_absent', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || `pressed ${digits || '2'}`}`);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_1', inferredPhase, 0);
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
      const action = makeWebhookUrl(request, logId, 'outreach_phase_0', inferredPhase, turn + 1);
      return gatherTwiml(action, 'Sorry, I could not hear your response clearly. Press 1 if the person in charge is available now, or press 2 if unavailable.');
    }

    if (step === 'outreach_phase_0_5') {
      const heardSomeone = /\b(hello|yes|speaking|this is|i am|i'm|person in charge|manager|owner)\b/i.test(speech) || digits === '1';
      if (heardSomeone) {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_phase_0_5_connected', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'connected via transfer hold'}`);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_2_verify', inferredPhase, 0);
        return gatherTwiml(action, 'Thank you for taking the transfer. Are you the person in charge of decisions about hotel partnership listings? Please say yes or no.');
      }

      if (turn < 1) {
        const action = makeWebhookUrl(request, logId, 'outreach_phase_0_5', inferredPhase, turn + 1);
        return gatherTwiml(action, 'I will continue to hold briefly. Hello, this is DayDreamHub checking in again. If the person in charge is on the line, please say hello.', { timeout: 12 });
      }

      await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_phase_0_5_timeout', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: hold timeout`);
      const action = makeWebhookUrl(request, logId, 'outreach_phase_1', inferredPhase, 0);
      return gatherTwiml(action, 'I could not connect with the person in charge while holding. Before we hang up, may I have the person in charge name for follow-up?');
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
      const action = makeWebhookUrl(request, logId, 'outreach_phase_1', inferredPhase, turn + 1);
      return gatherTwiml(action, 'Sorry, I did not catch the name. Please say the name of the person in charge once more.');
    }

    if (step === 'outreach_phase_2_verify') {
      if (isYes(speech, digits)) {
        const action = makeWebhookUrl(request, logId, 'outreach_phase_2', inferredPhase, 0);
        return gatherTwiml(action, 'Great, thank you. DayDreamHub offers free listings for hotels. Would you prefer we send materials first, or schedule a short explanation call? Press 1 for materials, or press 2 for a short meeting call.');
      }
      if (isNo(speech, digits)) {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_phase_2_verify_not_pic', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'not person in charge'}`);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_1', inferredPhase, 0);
        return gatherTwiml(action, 'Understood. Before we end, may I have the name of the person in charge so we can follow up correctly?');
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_outreach_timeout_phase_2_verify', callSid ? `twilio:${callSid}` : undefined);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_1', inferredPhase, 0);
        return gatherTwiml(action, 'Sorry, I could not confirm. Before we end, may I have the name of the person in charge for follow-up?');
      }
      const action = makeWebhookUrl(request, logId, 'outreach_phase_2_verify', inferredPhase, turn + 1);
      return gatherTwiml(action, 'Sorry, I did not catch that. Are you the person in charge of partnership listing decisions? Please say yes or no.');
    }

    if (step === 'outreach_phase_2') {
      const intent = classifyOutreachPhase2(speech, digits);
      if (intent === 'materials') {
        const action = makeWebhookUrl(request, logId, 'outreach_phase_4', inferredPhase, 0);
        return gatherTwiml(action, 'Great. To confirm, may we send our overview materials? Press 1 or say yes to confirm, or press 2 or say no.');
      }
      if (intent === 'meeting') {
        const action = makeWebhookUrl(request, logId, 'outreach_phase_5', inferredPhase, 0);
        return gatherTwiml(action, 'Great. To confirm, may our team schedule a short follow-up meeting call? Press 1 or say yes to confirm, or press 2 or say no.');
      }
      if (intent === 'callback') {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_outreach_callback_requested_phase_2', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech}`);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_callback_time', inferredPhase, 0);
        return gatherTwiml(action, 'Certainly. What date and time should we call back?', { timeout: 10 });
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
      const action = makeWebhookUrl(request, logId, 'outreach_phase_2', inferredPhase, turn + 1);
      return gatherTwiml(action, 'Sorry, I did not catch that. Press 1 for materials, or press 2 for a short meeting call.');
    }

    if (step === 'outreach_phase_callback_time') {
      if (looksLikeConcreteDateTime(speech)) {
        await updateCallLog(db, logId, 'confirmed', `twilio_outreach_callback_scheduled:${clamp(speech, 120)}`, callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech}`);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'callback_scheduled', outcome: 'callback_scheduled', needsRecall: 1, retryCount: turn });
        return twiml(`<Say voice="${VOICE}">Perfect. We will call back at ${esc(clamp(speech, 120))}. Thank you and goodbye.</Say><Hangup/>`);
      }
      if (turn >= 1) {
        const action = makeWebhookUrl(request, logId, 'outreach_phase_callback_name', inferredPhase, 0);
        return gatherTwiml(action, 'Understood. To make sure we follow up properly, may I have your name?');
      }
      const action = makeWebhookUrl(request, logId, 'outreach_phase_callback_time', inferredPhase, turn + 1);
      return gatherTwiml(action, 'Sorry, I did not catch the callback date and time. Please tell me a specific day and time for our callback.', { timeout: 10 });
    }

    if (step === 'outreach_phase_callback_name') {
      const personName = extractPersonName(speech) || (speech ? clamp(speech, 80) : null);
      if (personName) {
        await updateCallLog(db, logId, 'awaiting_response', `twilio_outreach_callback_name:${personName}`, callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech}`);
        const action = makeWebhookUrl(request, logId, 'outreach_phase_callback_email', inferredPhase, 0);
        return gatherTwiml(action, 'Thank you. Could you also share your email address for callback coordination?');
      }
      if (turn >= 1) {
        await updateCallLog(db, logId, 'confirmed', 'twilio_outreach_callback_no_datetime_no_contact', callSid ? `twilio:${callSid}` : undefined);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'callback_pending_contact', outcome: 'callback_pending_contact', needsRecall: 1, retryCount: turn + 1 });
        return twiml(`<Say voice="${VOICE}">No problem. We will have our team follow up through our existing channels. Thank you and goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'outreach_phase_callback_name', inferredPhase, turn + 1);
      return gatherTwiml(action, 'Sorry, I did not catch your name. Please tell me your name once more.');
    }

    if (step === 'outreach_phase_callback_email') {
      const email = extractEmail(speech);
      if (email) {
        await updateCallLog(db, logId, 'confirmed', `twilio_outreach_callback_email:${email}`, callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech}`);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'callback_pending_contact', outcome: 'callback_pending_contact', needsRecall: 1, retryCount: turn });
        return twiml(`<Say voice="${VOICE}">Thank you. We will coordinate the callback and follow up by email as needed. Goodbye.</Say><Hangup/>`);
      }
      if (turn >= 1) {
        await updateCallLog(db, logId, 'confirmed', 'twilio_outreach_callback_email_not_captured', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech}`);
        await updateOutreachState(db, { leadId: Number(outreachLead?.id || 0) || null, logId, status: 'callback_pending_contact', outcome: 'callback_pending_contact', needsRecall: 1, retryCount: turn + 1 });
        return twiml(`<Say voice="${VOICE}">Understood. Thank you. We will arrange a callback through our existing contact record. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'outreach_phase_callback_email', inferredPhase, turn + 1);
      return gatherTwiml(action, 'Sorry, I could not capture the email clearly. Please say it again, for example name at hotel dot com.');
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
      const action = makeWebhookUrl(request, logId, 'outreach_phase_4', inferredPhase, turn + 1);
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
      const action = makeWebhookUrl(request, logId, 'outreach_phase_5', inferredPhase, turn + 1);
      return gatherTwiml(action, 'Sorry, I did not catch that. Press 1 or say yes to schedule a follow-up meeting call, or press 2 or say no.');
    }

    if (step === 'ask_dayuse') {
      if (isRepeat(speech, digits)) {
        const action = makeWebhookUrl(request, logId, 'ask_dayuse', inferredPhase, turn + 1);
        const timeInfo = bookingCheckInTime && bookingCheckOutTime ? ` from ${bookingCheckInTime} to ${bookingCheckOutTime}` : '';
        return gatherTwiml(action, `We have a guest looking to book a day-use stay on ${bookingCheckInDate}${timeInfo}, for ${bookingGuests} ${bookingGuests === 1 ? 'person' : 'people'}. Do you offer day-use plans? Press 1 or say yes. Press 2 or say no.`);
      }
      if (isYes(speech, digits)) {
        await updateCallLog(db, logId, 'awaiting_response', 'twilio_dayuse_yes', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 1'}`);
        const action = makeWebhookUrl(request, logId, 'ask_price', inferredPhase, 0);
        return gatherTwiml(action, 'What is the final total price in US dollars, including all service fees and taxes? The guest will pay the hotel directly on-site. For example, say fifty dollars, or enter the amount and press the hash key.', { timeout: 10, finishOnKey: '#', preface: 'Thank you.' });
      }
      if (isNo(speech, digits)) {
        await updateCallLog(db, logId, 'declined', 'twilio_dayuse_no', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 2'}`);
        if (phase === 'concierge') {
          await finalizeConciergeOutcome(env, db, resolvedConciergeCallId || logId, 'unavailable', 'hotel_declined_dayuse');
          return twiml(`<Say voice="${VOICE}">Understood. Thank you for confirming. Goodbye.</Say><Hangup/>`);
        }
        if (db && booking?.id) {
          await db.prepare(`UPDATE bookings SET status='declined_by_hotel', updated_at=datetime('now') WHERE id=?`).bind(booking.id).run().catch(() => {});
        }
        return twiml(`<Say voice="${VOICE}">Understood. We currently have guests seeking day-use stays in your area. We may follow up to discuss whether a day-use plan could work for your property. Thank you for your time. Goodbye!</Say><Hangup/>`);
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_dayuse_no_answer', callSid ? `twilio:${callSid}` : undefined);
        if (phase === 'concierge') {
          await finalizeConciergeOutcome(env, db, resolvedConciergeCallId || logId, 'no_answer', 'no_response_dayuse_question');
        }
        return twiml(`<Say voice="${VOICE}">We could not confirm your response after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'ask_dayuse', inferredPhase, turn + 1);
      return gatherTwiml(action, 'Sorry, I could not hear your response clearly. Please say it again. Press 1 or say yes if you offer day-use. Press 2 or say no if you do not.');
    }

    if (step === 'ask_price') {
      if (isRepeat(speech, digits)) {
        const action = makeWebhookUrl(request, logId, 'ask_price', inferredPhase, turn + 1);
        return gatherTwiml(action, 'What is the final total price in US dollars, including all service fees and taxes? The guest will pay the hotel directly on-site. For example, say fifty dollars, or enter the amount and press the hash key.', { timeout: 10, finishOnKey: '#' });
      }
      const amount = parsePrice(speech, digits);
      if (amount != null) {
        await updateCallLog(db, logId, 'awaiting_response', `twilio_price:${amount}`, callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || `DTMF:${digits}`}\n[Agent]: Confirming price ${amount}`);
        const action = makeWebhookUrl(request, logId, 'confirm_booking', inferredPhase, 0);
        return gatherTwiml(action, `To confirm your reservation: The date is ${bookingCheckInDate}, time is ${bookingCheckInTime} to ${bookingCheckOutTime}, for ${bookingGuests} ${bookingGuests === 1 ? 'person' : 'people'}. The final total amount including taxes and fees is ${amount} dollars, to be paid on-site at check-in. If you agree to all these details and confirm the booking, press 1 or say yes. To decline, press 2 or say no. If the amount is different, please say the correct amount, or enter the amount and then press the hash key.`, { preface: 'Thank you.' });
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_price_no_answer', callSid ? `twilio:${callSid}` : undefined);
        if (phase === 'concierge') {
          await finalizeConciergeOutcome(env, db, resolvedConciergeCallId || logId, 'no_answer', 'no_price_captured');
        }
        return twiml(`<Say voice="${VOICE}">We could not capture the amount after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'ask_price', inferredPhase, turn + 1);
      return gatherTwiml(action, 'Could you please repeat the final total price in US dollars, including all service fees and taxes? The guest will pay the hotel directly on-site. You can also enter digits and press the hash key.');
    }

    if (step === 'confirm_booking') {
      const amount = parsePrice(speech, digits);
      if (amount != null && !isYes(speech, digits) && !isNo(speech, digits)) {
        await updateCallLog(db, logId, 'awaiting_response', `twilio_price_corrected:${amount}`, callSid ? `twilio:${callSid}` : undefined, `[Hotel]: corrected price ${amount}`);
        const action = makeWebhookUrl(request, logId, 'confirm_booking', inferredPhase, turn + 1);
        return gatherTwiml(action, `To confirm your reservation: The date is ${bookingCheckInDate}, time is ${bookingCheckInTime} to ${bookingCheckOutTime}, for ${bookingGuests} ${bookingGuests === 1 ? 'person' : 'people'}. The final total amount including taxes and fees is ${amount} dollars, to be paid on-site at check-in. If you agree to all these details and confirm the booking, press 1 or say yes. To decline, press 2 or say no. If the amount is different, please say the correct amount, or enter the amount and then press the hash key.`);
      }
      if (isYes(speech, digits)) {
        const finalAmount = quotedAmountFromNote;
        const guestName = bookingGuestName;
        const guestPhoneSpeech = formatPhoneForSpeech(bookingGuestPhone);
        const guestEmailSpeech = formatEmailForSpeech(bookingGuestEmail);
        await updateCallLog(db, logId, 'confirmed', 'twilio_booking_confirmed', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 1'}`);
        if (phase === 'concierge') {
          await finalizeConciergeOutcome(
            env,
            db,
            resolvedConciergeCallId || logId,
            'booked',
            `confirmed_by_hotel;guest=${bookingGuestName};guest_email=${bookingGuestEmail || 'n/a'};guest_phone=${bookingGuestPhone || 'n/a'}`,
            { priceQuoted: finalAmount, sendAdminBooked: true }
          );
        } else if (db && booking?.id) {
          await db.prepare(`UPDATE bookings SET status='confirmed_by_hotel', updated_at=datetime('now') WHERE id=?`).bind(booking.id).run().catch(() => {});
        }
        const detailAction = makeWebhookUrl(request, logId, 'confirm_booking_details', inferredPhase, 0);
        return twiml(
          `${sayText(`Thank you. All consent checks are complete. The reservation is confirmed at a final total of ${finalAmount != null ? finalAmount : 'the agreed'} dollars, including service fees and taxes. Payment will be made directly at the hotel by the guest. We will send a follow-up confirmation email shortly with all the details.`)}` +
          `<Pause length="1"/>` +
          `${sayText(`For your immediate records, I will share the guest details slowly.`)}` +
          `<Pause length="1"/>` +
          `${sayText(`Guest name: ${guestName}.`, { slow: true })}` +
          `<Pause length="1"/>` +
          `${sayText(`Guest phone: ${guestPhoneSpeech}.`, { slow: true })}` +
          `<Pause length="1"/>` +
          `${sayText(`Guest email: ${guestEmailSpeech}.`, { slow: true })}` +
          `<Pause length="1"/>` +
          `<Gather input="speech dtmf" timeout="8" speechTimeout="auto" actionOnEmptyResult="true" language="en-US" action="${esc(detailAction)}" method="POST">` +
          `${sayText('If you would like me to repeat these details slowly, press 3 or say repeat. Otherwise, press 1 or say yes to finish this call.')}` +
          `</Gather>`
        );
      }
      if (isNo(speech, digits)) {
        await updateCallLog(db, logId, 'declined', 'twilio_booking_declined', callSid ? `twilio:${callSid}` : undefined, `[Hotel]: ${speech || 'pressed 2'}`);
        if (phase === 'concierge') {
          await finalizeConciergeOutcome(env, db, resolvedConciergeCallId || logId, 'unavailable', 'declined_at_confirmation');
        } else if (db && booking?.id) {
          await db.prepare(`UPDATE bookings SET status='declined_by_hotel', updated_at=datetime('now') WHERE id=?`).bind(booking.id).run().catch(() => {});
        }
        return twiml(`<Say voice="${VOICE}">Thank you. We recognized your answer. Goodbye.</Say><Hangup/>`);
      }
      if (turn >= MAX_RETRY) {
        await updateCallLog(db, logId, 'no_answer', 'twilio_confirm_no_answer', callSid ? `twilio:${callSid}` : undefined);
        if (phase === 'concierge') {
          await finalizeConciergeOutcome(env, db, resolvedConciergeCallId || logId, 'no_answer', 'no_response_confirmation');
        }
        return twiml(`<Say voice="${VOICE}">We could not confirm your response after multiple attempts. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'confirm_booking', inferredPhase, turn + 1);
      if (quotedAmountFromNote != null) {
        return gatherTwiml(action, `Sorry, I could not hear your response clearly. To confirm your reservation: The date is ${bookingCheckInDate}, time is ${bookingCheckInTime} to ${bookingCheckOutTime}, for ${bookingGuests} ${bookingGuests === 1 ? 'person' : 'people'}. The final total amount including taxes and fees is ${quotedAmountFromNote} dollars, to be paid on-site at check-in. If you agree to all these details and confirm the booking, press 1 or say yes. To decline, press 2 or say no. If the amount is different, please say the correct amount, or enter the amount and then press the hash key.`);
      }
      return gatherTwiml(action, 'Sorry, I could not hear your response clearly. Please say it again. Press 1 or say yes to confirm. Press 2 or say no to decline. You can also provide a corrected amount.');
    }

    if (step === 'confirm_booking_details') {
      const guestName = bookingGuestName;
      const guestPhoneSpeech = formatPhoneForSpeech(bookingGuestPhone);
      const guestEmailSpeech = formatEmailForSpeech(bookingGuestEmail);
      if (isRepeat(speech, digits)) {
        const action = makeWebhookUrl(request, logId, 'confirm_booking_details', inferredPhase, turn + 1);
        return gatherTwiml(
          action,
          `Repeating slowly. Guest name: ${guestName}. Guest phone: ${guestPhoneSpeech}. Guest email: ${guestEmailSpeech}. If you would like another repeat, press 3 or say repeat. Otherwise, press 1 or say yes to finish this call.`,
          { slow: true }
        );
      }
      if (isYes(speech, digits)) {
        return twiml(`<Say voice="${VOICE}">Thank you. Goodbye.</Say><Hangup/>`);
      }
      if (turn >= MAX_RETRY) {
        return twiml(`<Say voice="${VOICE}">Thank you for your time. Goodbye.</Say><Hangup/>`);
      }
      const action = makeWebhookUrl(request, logId, 'confirm_booking_details', inferredPhase, turn + 1);
      return gatherTwiml(action, 'If you want the guest details repeated slowly, press 3 or say repeat. Otherwise, press 1 or say yes to finish this call.', { slow: true });
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
