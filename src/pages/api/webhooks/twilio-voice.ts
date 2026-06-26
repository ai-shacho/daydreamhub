import type { APIRoute } from 'astro';

type DbLike = {
  prepare: (sql: string) => {
    bind: (...args: any[]) => { run: () => Promise<any>; first: () => Promise<any> };
    run?: () => Promise<any>;
    all?: () => Promise<any>;
  };
};

const MAX_TURN_COUNT = 4;
const MAX_INPUT_CHARS = 512;
const MAX_NOTE_CHARS = 280;
const MAX_TRANSCRIPT_CHARS = 700;
const ALLOWED_STEPS = new Set(['intro', 'echo']);

function twiml(body: string): Response {
  const safeBody = typeof body === 'string'
    ? body
    : '<Say voice="Polly.Matthew" language="en-US">Temporary error. Goodbye.</Say><Hangup/>';
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response>${safeBody}</Response>`;
  console.log('Generated TwiML:', xml);
  return new Response(xml, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
    status: 200,
  });
}

function esc(v: string): string {
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clampText(v: unknown, max = MAX_INPUT_CHARS): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function normalizeLogId(raw: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.trunc(n));
}

function normalizeStep(raw: string | null): 'intro' | 'echo' {
  const s = String(raw || 'intro').toLowerCase().trim();
  if (ALLOWED_STEPS.has(s)) return s as 'intro' | 'echo';
  return 'intro';
}

function parseTurn(raw: string | null): number {
  const n = Number(raw || '0');
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), MAX_TURN_COUNT + 5);
}

function normalizeSpeech(speech: string, digits: string): string {
  const s = clampText(speech, MAX_INPUT_CHARS);
  if (s) return s;
  const d = clampText(digits, 64);
  if (!d) return '';
  return `DTMF:${d}`;
}

function wantsToFinish(speech: string, digits: string): boolean {
  const d = clampText(digits, 64);
  if (d === '2') return true;

  const s = clampText(speech, MAX_INPUT_CHARS).toLowerCase();
  return /\b(no|nope|finish|end|stop|goodbye|bye|cancel|quit)\b/.test(s);
}

async function getCallLogColumns(db: DbLike | null): Promise<Set<string>> {
  if (!db || typeof db.prepare !== 'function') {
    return new Set(['id', 'status', 'note', 'telnyx_call_id']);
  }

  try {
    const q = db.prepare(`PRAGMA table_info(call_logs)`);
    const rows = (typeof q.all === 'function') ? await q.all() : await q.bind().run();
    const list = Array.isArray(rows?.results) ? rows.results : [];
    return new Set(list.map((r: any) => String(r?.name || '')));
  } catch {
    return new Set(['id', 'status', 'note', 'telnyx_call_id']);
  }
}

async function updateStatus(
  db: DbLike | null,
  logId: string | null,
  status: string,
  extra: Record<string, any> = {},
): Promise<void> {
  if (!db || typeof db.prepare !== 'function' || !logId) return;

  const note = extra.note ? clampText(extra.note, MAX_NOTE_CHARS) : null;
  const transcription = extra.transcription ? clampText(extra.transcription, MAX_TRANSCRIPT_CHARS) : null;
  const sid = extra.sid ? clampText(extra.sid, 200) : null;

  const cols = await getCallLogColumns(db);
  const hasTranscription = cols.has('transcription');
  const hasCallId = cols.has('telnyx_call_id');

  const sets: string[] = [];
  const binds: any[] = [];

  // Keep final statuses stable if a delayed completed callback arrives.
  sets.push(`status = CASE WHEN ? = 'no_answer' AND status IN ('confirmed','declined','failed','no_answer') THEN status ELSE ? END`);
  binds.push(status, status);

  if (note !== null) {
    sets.push(`note = COALESCE(note || ' | ', '') || ?`);
    binds.push(note);
  }

  if (hasTranscription && transcription !== null) {
    sets.push(`transcription = COALESCE(transcription || '\n', '') || ?`);
    binds.push(transcription);
  }

  if (hasCallId && sid !== null) {
    sets.push(`telnyx_call_id = ?`);
    binds.push(sid);
  }

  if (!sets.length) return;

  binds.push(logId);
  const sql = `UPDATE call_logs SET ${sets.join(', ')} WHERE id = ?`;

  try {
    await db.prepare(sql).bind(...binds).run();
  } catch (e: any) {
    console.error('[twilio-voice] failed to update call_logs', {
      logId,
      status,
      message: e?.message || String(e),
    });
  }
}

function makeWebhookUrl(base: URL, logId: string | null, step: 'intro' | 'echo', turn = 0, event?: string): string {
  const u = new URL('/api/webhooks/twilio-voice', base.origin);
  if (logId) u.searchParams.set('lid', logId);
  u.searchParams.set('step', step);
  u.searchParams.set('turn', String(Math.max(0, Math.trunc(turn))));
  if (event) u.searchParams.set('event', event);
  return u.toString();
}

async function readTwilioParams(request: Request): Promise<URLSearchParams> {
  const contentType = (request.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const raw = await request.text().catch(() => '');
    return new URLSearchParams(raw || '');
  }

  if (contentType.includes('application/json')) {
    try {
      const json = await request.json() as Record<string, any>;
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(json || {})) {
        if (v !== null && v !== undefined) p.set(k, String(v));
      }
      return p;
    } catch {
      return new URLSearchParams();
    }
  }

  try {
    const form = await request.formData();
    const p = new URLSearchParams();
    for (const [k, v] of form.entries()) {
      p.set(k, typeof v === 'string' ? v : v.name);
    }
    return p;
  } catch {
    const raw = await request.text().catch(() => '');
    return new URLSearchParams(raw || '');
  }
}

export const POST: APIRoute = async ({ request, locals, url }) => {
  const safeGoodbye = () => twiml(`<Say voice="Polly.Matthew" language="en-US">Thank you. Goodbye.</Say><Hangup/>`);

  try {
    const runtime = (locals as any)?.runtime;
    const db: DbLike | null = (runtime?.env?.DB && typeof runtime?.env?.DB?.prepare === 'function') ? runtime.env.DB : null;

    const logId = normalizeLogId(url.searchParams.get('lid'));
    const event = clampText(url.searchParams.get('event') || '', 40).toLowerCase();
    const step = normalizeStep(url.searchParams.get('step'));
    const turn = parseTurn(url.searchParams.get('turn'));

    const form = await readTwilioParams(request);
    const callSid = clampText(form.get('CallSid') || '', 120);
    const digits = clampText(form.get('Digits') || '', 64);
    const speech = clampText(form.get('SpeechResult') || '', MAX_INPUT_CHARS);
    const callStatusRaw = clampText(form.get('CallStatus') || '', 64).toLowerCase();

    console.log('[twilio-voice] webhook_received', {
      step,
      event,
      turn,
      logId,
      callSid,
      digits,
      speech,
      callStatus: callStatusRaw,
      from: clampText(form.get('From') || '', 80),
      to: clampText(form.get('To') || '', 80),
      contentType: request.headers.get('content-type') || '',
    });

    // Status callback flow
    if (event === 'status') {
      let mapped = 'calling';
      if (callStatusRaw === 'completed') mapped = 'no_answer';
      if (callStatusRaw === 'busy' || callStatusRaw === 'failed' || callStatusRaw === 'canceled' || callStatusRaw === 'no-answer') mapped = 'failed';
      if (callStatusRaw === 'in-progress' || callStatusRaw === 'answered' || callStatusRaw === 'ringing' || callStatusRaw === 'queued' || callStatusRaw === 'initiated') mapped = 'calling';

      await updateStatus(db, logId, mapped, {
        note: `twilio_status:${callStatusRaw || 'unknown'}`,
        sid: callSid ? `twilio:${callSid}` : null,
      });

      return new Response('ok', { status: 200 });
    }

    if (step === 'intro') {
      await updateStatus(db, logId, 'awaiting_response', {
        note: 'twilio_intro_prompted',
        sid: callSid ? `twilio:${callSid}` : null,
      });

      const gatherAction = makeWebhookUrl(url, logId, 'echo', 1);

      return twiml(
        `<Gather input="speech dtmf" timeout="6" speechTimeout="auto" action="${esc(gatherAction)}" method="POST">` +
        `<Say voice="Polly.Matthew" language="en-US">Hello, this is a Twilio test call. Please say something.</Say>` +
        `</Gather>` +
        `<Say voice="Polly.Matthew" language="en-US">I did not hear anything. Goodbye.</Say><Hangup/>`
      );
    }

    if (step === 'echo') {
      const recognized = normalizeSpeech(speech, digits);

      if (!recognized) {
        await updateStatus(db, logId, 'no_answer', {
          note: turn >= MAX_TURN_COUNT ? 'twilio_no_input_max_turns' : 'twilio_no_input_on_echo',
          sid: callSid ? `twilio:${callSid}` : null,
        });
        return twiml(`<Say voice="Polly.Matthew" language="en-US">I did not catch that. Thank you. Goodbye.</Say><Hangup/>`);
      }

      const transcriptLine = clampText(`[Twilio][Hotel]: ${recognized} (sid:${callSid || 'none'})`, MAX_TRANSCRIPT_CHARS);

      if (wantsToFinish(speech, digits)) {
        await updateStatus(db, logId, 'declined', {
          note: 'twilio_finish_word_detected',
          transcription: transcriptLine,
          sid: callSid ? `twilio:${callSid}` : null,
        });
        return safeGoodbye();
      }

      if (turn >= MAX_TURN_COUNT) {
        await updateStatus(db, logId, 'no_answer', {
          note: 'twilio_turn_limit_reached',
          transcription: transcriptLine,
          sid: callSid ? `twilio:${callSid}` : null,
        });
        return twiml(`<Say voice="Polly.Matthew" language="en-US">Thanks for your time. We will end this call now. Goodbye.</Say><Hangup/>`);
      }

      await updateStatus(db, logId, 'awaiting_response', {
        note: `twilio_echo_round_${turn || 1}`,
        transcription: transcriptLine,
        sid: callSid ? `twilio:${callSid}` : null,
      });

      const gatherAction = makeWebhookUrl(url, logId, 'echo', turn + 1);
      return twiml(
        `<Gather input="speech dtmf" timeout="6" speechTimeout="auto" action="${esc(gatherAction)}" method="POST">` +
        `<Say voice="Polly.Matthew" language="en-US">I heard: ${esc(recognized)}. If you want to finish, please say No.</Say>` +
        `</Gather>` +
        `<Say voice="Polly.Matthew" language="en-US">No input received. Thank you. Goodbye.</Say><Hangup/>`
      );
    }

    // Fallback for any unexpected step value
    await updateStatus(db, logId, 'awaiting_response', {
      note: `twilio_invalid_step_fallback:${step}`,
      sid: callSid ? `twilio:${callSid}` : null,
    });
    return twiml(`<Say voice="Polly.Matthew" language="en-US">Invalid state detected. Restarting.</Say><Redirect method="POST">${esc(makeWebhookUrl(url, logId, 'intro', 0))}</Redirect>`);
  } catch (e: any) {
    console.error('[twilio-voice] fatal webhook error', {
      message: e?.message || String(e),
      stack: e?.stack || null,
      url: request.url,
    });
    return twiml(`<Say voice="Polly.Matthew" language="en-US">Sorry, a temporary error occurred. Goodbye.</Say><Hangup/>`);
  }
};

export const GET: APIRoute = async ({ url }) => {
  return new Response(JSON.stringify({ ok: true, provider: 'twilio', path: url.pathname }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
