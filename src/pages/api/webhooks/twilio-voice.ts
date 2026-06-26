import type { APIRoute } from 'astro';

function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeSpeech(speech: string, digits: string): string {
  const s = (speech || '').trim();
  if (s) return s;
  const d = (digits || '').trim();
  if (!d) return '';
  return `DTMF:${d}`;
}

function wantsToFinish(speech: string, digits: string): boolean {
  const d = (digits || '').trim();
  if (d === '2') return true;

  const s = (speech || '').toLowerCase();
  return /\b(no|nope|finish|end|stop|goodbye|bye)\b/.test(s);
}

async function getCallLogColumns(db: any): Promise<Set<string>> {
  try {
    const rows = await db.prepare(`PRAGMA table_info(call_logs)`).all();
    const list = Array.isArray(rows?.results) ? rows.results : [];
    return new Set(list.map((r: any) => String(r?.name || '')));
  } catch {
    return new Set(['id', 'status', 'note', 'telnyx_call_id']);
  }
}

async function updateStatus(db: any, logId: string | null, status: string, extra: Record<string, any> = {}) {
  if (!db || !logId) return;

  const note = extra.note ? String(extra.note) : null;
  const transcription = extra.transcription ? String(extra.transcription) : null;
  const sid = extra.sid ? String(extra.sid) : null;

  const cols = await getCallLogColumns(db);
  const hasTranscription = cols.has('transcription');
  const hasCallId = cols.has('telnyx_call_id');

  const sets: string[] = [];
  const binds: any[] = [];

  // Completed callback should not overwrite final statuses.
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

function makeWebhookUrl(base: URL, logId: string | null, step: string, event?: string): string {
  const u = new URL('/api/webhooks/twilio-voice', base.origin);
  if (logId) u.searchParams.set('lid', logId);
  u.searchParams.set('step', step);
  if (event) u.searchParams.set('event', event);
  return u.toString();
}

async function readTwilioParams(request: Request): Promise<URLSearchParams> {
  const contentType = (request.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const raw = await request.text();
    return new URLSearchParams(raw);
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
  try {
    const runtime = (locals as any).runtime;
    const db = runtime?.env?.DB;

    const logId = url.searchParams.get('lid');
    const event = url.searchParams.get('event') || '';
    const step = url.searchParams.get('step') || 'intro';

    const form = await readTwilioParams(request);
    const callSid = String(form.get('CallSid') || '');
    const digits = String(form.get('Digits') || '');
    const speech = String(form.get('SpeechResult') || '');

    console.log('[twilio-voice] webhook_received', {
      step,
      event,
      logId,
      callSid,
      digits,
      speech,
      callStatus: String(form.get('CallStatus') || ''),
      from: String(form.get('From') || ''),
      to: String(form.get('To') || ''),
      contentType: request.headers.get('content-type') || '',
    });

  // Status callback flow
  if (event === 'status') {
    const callStatus = String(form.get('CallStatus') || '').toLowerCase();
    let mapped = 'calling';
    if (callStatus === 'completed') mapped = 'no_answer';
    if (callStatus === 'busy' || callStatus === 'failed' || callStatus === 'canceled') mapped = 'failed';
    if (callStatus === 'in-progress' || callStatus === 'answered' || callStatus === 'ringing' || callStatus === 'queued' || callStatus === 'initiated') mapped = 'calling';

    await updateStatus(db, logId, mapped, {
      note: `twilio_status:${callStatus}`,
      sid: callSid ? `twilio:${callSid}` : null,
    });

    return new Response('ok', { status: 200 });
  }

  if (step === 'intro') {
    await updateStatus(db, logId, 'awaiting_response', {
      note: 'twilio_intro_prompted',
      sid: callSid ? `twilio:${callSid}` : null,
    });

    const gatherAction = makeWebhookUrl(url, logId, 'echo');

    return twiml(
      `<Gather input="speech dtmf" timeout="6" speechTimeout="auto" action="${esc(gatherAction)}" method="POST">` +
      `<Say voice="alice">Hello, this is a Twilio test call. Please say something.</Say>` +
      `</Gather>` +
      `<Say voice="alice">I did not hear anything. Goodbye.</Say><Hangup/>`
    );
  }

  if (step === 'echo') {
    const recognized = normalizeSpeech(speech, digits);

    if (!recognized) {
      await updateStatus(db, logId, 'no_answer', {
        note: 'twilio_no_input_on_echo',
        sid: callSid ? `twilio:${callSid}` : null,
      });
      return twiml(`<Say voice="alice">I did not catch that. Thank you. Goodbye.</Say><Hangup/>`);
    }

    const transcriptLine = `[Twilio][Hotel]: ${recognized} (sid:${callSid || 'none'})`;

    if (wantsToFinish(speech, digits)) {
      await updateStatus(db, logId, 'declined', {
        note: 'twilio_finish_word_detected',
        transcription: transcriptLine,
        sid: callSid ? `twilio:${callSid}` : null,
      });
      return twiml(`<Say voice="alice">Thank you. Goodbye.</Say><Hangup/>`);
    }

    await updateStatus(db, logId, 'awaiting_response', {
      note: 'twilio_echo_round',
      transcription: transcriptLine,
      sid: callSid ? `twilio:${callSid}` : null,
    });

    const gatherAction = makeWebhookUrl(url, logId, 'echo');
    return twiml(
      `<Gather input="speech dtmf" timeout="6" speechTimeout="auto" action="${esc(gatherAction)}" method="POST">` +
      `<Say voice="alice">I heard: ${esc(recognized)}. If you want to finish, please say No.</Say>` +
      `</Gather>` +
      `<Say voice="alice">No input received. Thank you. Goodbye.</Say><Hangup/>`
    );
  }

    return twiml(`<Say voice="alice">Invalid Twilio webhook step.</Say><Hangup/>`);
  } catch (e: any) {
    console.error('[twilio-voice] fatal webhook error', {
      message: e?.message || String(e),
      stack: e?.stack || null,
      url: request.url,
    });
    return twiml(`<Say voice="alice">Sorry, a temporary error occurred. Goodbye.</Say><Hangup/>`);
  }
};

export const GET: APIRoute = async ({ url }) => {
  return new Response(JSON.stringify({ ok: true, provider: 'twilio', path: url.pathname }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
