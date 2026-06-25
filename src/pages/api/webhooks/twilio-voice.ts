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

function classify(speech: string, digits: string): 'yes' | 'no' | 'repeat' | 'unknown' {
  const d = (digits || '').trim();
  if (d === '1') return 'yes';
  if (d === '2') return 'no';
  if (d === '3') return 'repeat';

  const s = (speech || '').toLowerCase();
  if (/\b(yes|yeah|yep|correct|sure|ok|okay|available)\b/.test(s)) return 'yes';
  if (/\b(no|nope|not available|unavailable|cannot|can't)\b/.test(s)) return 'no';
  if (/\b(repeat|again|pardon|sorry)\b/.test(s)) return 'repeat';
  return 'unknown';
}

async function updateStatus(db: any, logId: string | null, status: string, extra: Record<string, any> = {}) {
  if (!db || !logId) return;
  const note = extra.note ? String(extra.note) : null;
  const transcription = extra.transcription ? String(extra.transcription) : null;
  const sid = extra.sid ? String(extra.sid) : null;

  await db.prepare(`
    UPDATE call_logs
    SET status = ?1,
        note = CASE WHEN ?2 IS NOT NULL THEN COALESCE(note || ' | ', '') || ?2 ELSE note END,
        transcription = CASE WHEN ?3 IS NOT NULL THEN COALESCE(transcription || '\n', '') || ?3 ELSE transcription END,
        telnyx_call_id = CASE WHEN ?4 IS NOT NULL THEN ?4 ELSE telnyx_call_id END,
        ended_at = CASE WHEN ?1 IN ('confirmed','declined','no_answer','failed') THEN datetime('now') ELSE ended_at END
    WHERE id = ?5
  `).bind(status, note, transcription, sid, logId).run().catch(() => {});
}

export const POST: APIRoute = async ({ request, locals, url }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;

  const logId = url.searchParams.get('lid');
  const event = url.searchParams.get('event') || '';
  const step = url.searchParams.get('step') || 'intro';

  const form = await request.formData();
  const callSid = String(form.get('CallSid') || '');

  // Status callback flow
  if (event === 'status') {
    const callStatus = String(form.get('CallStatus') || '').toLowerCase();
    let mapped = 'calling';
    if (callStatus === 'completed') mapped = 'no_answer';
    if (callStatus === 'busy' || callStatus === 'failed' || callStatus === 'canceled') mapped = 'failed';
    if (callStatus === 'in-progress' || callStatus === 'answered' || callStatus === 'ringing' || callStatus === 'queued') mapped = 'calling';

    await updateStatus(db, logId, mapped, {
      note: `twilio_status:${callStatus}`,
      sid: callSid ? `twilio:${callSid}` : null,
    });

    return new Response('ok', { status: 200 });
  }

  // TwiML voice flow
  if (step === 'intro') {
    await updateStatus(db, logId, 'awaiting_response', {
      note: 'twilio_intro',
      sid: callSid ? `twilio:${callSid}` : null,
    });

    const gatherAction = `/api/webhooks/twilio-voice?lid=${encodeURIComponent(logId || '')}&step=decision`;
    const message =
      'Hello, this is DayDreamHub Twilio test call. Please say yes or press 1 if you can hear this clearly. ' +
      'Say no or press 2 if not. Press 3 to repeat.';

    return twiml(
      `<Gather input="speech dtmf" numDigits="1" timeout="5" speechTimeout="auto" action="${esc(gatherAction)}" method="POST">` +
      `<Say voice="alice">${esc(message)}</Say>` +
      `</Gather>` +
      `<Say voice="alice">No input received. Goodbye.</Say><Hangup/>`
    );
  }

  if (step === 'decision') {
    const digits = String(form.get('Digits') || '');
    const speech = String(form.get('SpeechResult') || '');
    const result = classify(speech, digits);

    if (result === 'yes') {
      await updateStatus(db, logId, 'confirmed', {
        note: 'twilio_test_success',
        transcription: `[Twilio][Hotel]: ${speech || `DTMF:${digits}`}`,
        sid: callSid ? `twilio:${callSid}` : null,
      });
      return twiml(`<Say voice="alice">Thank you. Twilio voice recognition test succeeded. Goodbye.</Say><Hangup/>`);
    }

    if (result === 'no') {
      await updateStatus(db, logId, 'declined', {
        note: 'twilio_test_declined',
        transcription: `[Twilio][Hotel]: ${speech || `DTMF:${digits}`}`,
        sid: callSid ? `twilio:${callSid}` : null,
      });
      return twiml(`<Say voice="alice">Understood. We will end this test call now. Goodbye.</Say><Hangup/>`);
    }

    if (result === 'repeat') {
      const retryUrl = `/api/webhooks/twilio-voice?lid=${encodeURIComponent(logId || '')}&step=intro`;
      await updateStatus(db, logId, 'awaiting_response', {
        note: 'twilio_repeat_requested',
        transcription: `[Twilio][Hotel]: ${speech || `DTMF:${digits}`}`,
      });
      return twiml(`<Redirect method="POST">${esc(retryUrl)}</Redirect>`);
    }

    await updateStatus(db, logId, 'no_answer', {
      note: 'twilio_unrecognized_input',
      transcription: `[Twilio][Hotel]: ${speech || `DTMF:${digits}` || 'no input'}`,
      sid: callSid ? `twilio:${callSid}` : null,
    });
    return twiml(`<Say voice="alice">Sorry, I could not understand that. Ending the test call. Goodbye.</Say><Hangup/>`);
  }

  return twiml(`<Say voice="alice">Invalid Twilio webhook step.</Say><Hangup/>`);
};

export const GET: APIRoute = async ({ url }) => {
  // quick health check
  return new Response(JSON.stringify({ ok: true, provider: 'twilio', path: url.pathname }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
