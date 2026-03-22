import type { APIRoute } from 'astro';
import { getAccessToken, refundCapture } from '../../../lib/paypal';
import { sendConciergeConfirmation } from '../../../lib/email';
import { getCurrencyForCountry, getExchangeRates, formatPriceWithUSD, initiateNextGroupCall } from '../../../lib/tools';

const FAX_PATTERNS = [
  /(?:FAX|ファクス|ＦＡＸ)[\s:：]*([+\d\-()（）\s]{8,})/i,
  /(?:fax|facsimile)[\s:：]*([+\d\-()（）\s]{8,})/i,
];

async function findFaxAndSend(env: any, callData: any): Promise<boolean> {
  if (!env?.TELNYX_API_KEY || !env?.TELNYX_FROM_NUMBER) {
    console.log('FAX: Telnyx not configured, skipping');
    return false;
  }
  const faxNumber = await findFaxNumber(env, callData.hotelName);
  if (!faxNumber) {
    console.log(`FAX: No FAX number found for ${callData.hotelName}, skipping`);
    return false;
  }
  const confirmationText = generateConfirmationText(callData);
  const r2 = env?.IMAGES;
  if (!r2) {
    console.log('FAX: R2 not available, skipping');
    return false;
  }
  const faxKey = `fax/concierge-${callData.callId}-${Date.now()}.txt`;
  await r2.put(faxKey, confirmationText, {
    httpMetadata: { contentType: 'text/plain; charset=utf-8' },
  });
  const baseUrl = env.SITE_URL || 'https://daydreamhub.com';
  const mediaUrl = `${baseUrl}/api/r2/${faxKey}`;
  const res = await fetch('https://api.telnyx.com/v2/faxes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connection_id: env.TELNYX_CONNECTION_ID,
      to: faxNumber,
      from: env.TELNYX_FROM_NUMBER,
      media_url: mediaUrl,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`FAX send failed: ${res.status} ${text}`);
    return false;
  }
  console.log(`FAX sent to ${faxNumber} for ${callData.hotelName}`);
  return true;
}

async function findFaxNumber(env: any, hotelName: string): Promise<string | null> {
  const googleApiKey = env?.GOOGLE_PLACES_API_KEY;
  if (!googleApiKey) return null;
  try {
    const cseId = env?.GOOGLE_CSE_ID;
    if (!cseId) return null;
    const query = encodeURIComponent(`${hotelName} FAX番号 ファクス`);
    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${cseId}&q=${query}&num=5`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const items = data.items || [];
    for (const item of items) {
      const text = `${item.snippet || ''} ${item.title || ''}`;
      const fax = extractFaxFromText(text);
      if (fax) return fax;
    }
    if (items.length > 0 && items[0].link) {
      try {
        const pageRes = await fetch(items[0].link, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DaydreamHubBot/1.0)' },
          signal: AbortSignal.timeout(5000),
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const fax = extractFaxFromText(html);
          if (fax) return fax;
        }
      } catch {}
    }
  } catch (e) {
    console.error('FAX number search error:', e);
  }
  return null;
}

function extractFaxFromText(text: string): string | null {
  for (const pattern of FAX_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      let num = match[1].replace(/[\s（）()]/g, '').replace(/[‐－ー]/g, '-');
      num = num.replace(/[^\d+\-]/g, '');
      if (num.replace(/[^\d]/g, '').length >= 8) {
        return num;
      }
    }
  }
  return null;
}

function generateConfirmationText(data: any): string {
  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        ご予約確認書
        Booking Confirmation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DaydreamHub AIコンシェルジュサービスより
ご予約内容をご確認ください。

■ ホテル名: ${data.hotelName}
■ ゲスト名: ${data.guestName}
■ 日付:     ${data.date}
■ チェックイン:  ${data.checkIn}
■ チェックアウト: ${data.checkOut}
■ 人数:     ${data.guests}名
${data.priceQuoted ? `■ 料金:     ${data.priceQuoted}（ホテルにてお支払い）` : ''}

※ 宿泊料金はチェックイン時にホテルにて直接お支払いいただきます。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DaydreamHub - AI Hotel Booking Concierge
https://daydreamhub.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}

export function parseConciergeOutcome(summary: string, transcript: string): string {
  const text = `${summary} ${transcript}`.toLowerCase();
  if (/booked|reserved|confirmed|予約完了|承知|確定/.test(text)) return 'booked';
  if (/over.?budget|exceed.*budget|higher than.*budget|予算超/.test(text)) return 'over_budget';
  if (/available|空いて|空き|利用可能|ございます/.test(text)) return 'available';
  if (/full|no.*available|sold out|満室|空きがない|埋まって/.test(text)) return 'unavailable';
  if (/call back|later|callback|改めて|折り返し/.test(text)) return 'callback';
  if (/voicemail|留守番/.test(text)) return 'voicemail';
  if (/no answer|unanswered|応答なし/.test(text)) return 'no_answer';
  return 'available';
}

export function extractPrice(summary: string, transcript: string): string | null {
  const text = `${summary} ${transcript}`;
  const match = text.match(
    /[\$€£¥￥฿₩₹][\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*(?:円|yen|baht|THB|EUR|GBP|SGD|MYR|IDR|VND|KRW|CNY|AUD|NZD|HKD|PHP|INR|AED|CHF|SEK|NOK|USD|JPY|dollars?)/i
  );
  return match ? match[0] : null;
}

async function processRefund(env: any, db: any, callId: number) {
  const call = await db
    .prepare(
      'SELECT paypal_capture_id, payment_status, refund_status FROM concierge_calls WHERE id = ?'
    )
    .bind(callId)
    .first();
  if (!call || call.payment_status !== 'paid' || call.refund_status === 'refunded') return;
  if (!call.paypal_capture_id) return;
  if (!env?.PAYPAL_CLIENT_ID || !env?.PAYPAL_SECRET) return;
  const mode = env.PAYPAL_MODE || 'live';
  const accessToken = await getAccessToken(env.PAYPAL_CLIENT_ID, env.PAYPAL_SECRET, mode);
  const result = await refundCapture(accessToken, call.paypal_capture_id, mode);
  await db
    .prepare(
      "UPDATE concierge_calls SET refund_status = ?, refund_id = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .bind(result.status === 'COMPLETED' ? 'refunded' : 'refund_failed', result.id, callId)
    .run();
}

async function processGroupRefund(env: any, db: any, groupId: number) {
  const group = await db
    .prepare(
      'SELECT paypal_capture_id, payment_status, refund_status FROM concierge_call_groups WHERE id = ?'
    )
    .bind(groupId)
    .first();
  if (!group || group.payment_status !== 'paid' || group.refund_status === 'refunded') return;
  if (!group.paypal_capture_id) return;
  if (!env?.PAYPAL_CLIENT_ID || !env?.PAYPAL_SECRET) return;
  const mode = env.PAYPAL_MODE || 'live';
  const accessToken = await getAccessToken(env.PAYPAL_CLIENT_ID, env.PAYPAL_SECRET, mode);
  const result = await refundCapture(accessToken, group.paypal_capture_id, mode);
  await db
    .prepare(
      "UPDATE concierge_call_groups SET refund_status = ?, refund_id = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .bind(result.status === 'COMPLETED' ? 'refunded' : 'refund_failed', result.id, groupId)
    .run();
}

async function sendBookingConfirmations(env: any, db: any, callId: number) {
  const call = await db
    .prepare(
      `SELECT id, hotel_name, hotel_phone, guest_name, guest_email, request_details, ai_summary, price_quoted
       FROM concierge_calls WHERE id = ?`
    )
    .bind(callId)
    .first();
  if (!call) return;
  let details: any = {};
  try {
    details = JSON.parse(call.request_details || '{}');
  } catch {}
  if (call.guest_email && env?.RESEND_API_KEY) {
    try {
      const emailResult = await sendConciergeConfirmation(env.RESEND_API_KEY, {
        guestName: call.guest_name || 'Guest',
        guestEmail: call.guest_email,
        hotelName: call.hotel_name,
        hotelPhone: call.hotel_phone || '',
        date: details.date || '',
        checkIn: details.check_in_time || '',
        checkOut: details.check_out_time || '',
        guests: details.guests || 1,
        priceQuoted: call.price_quoted || undefined,
        aiSummary: call.ai_summary || undefined,
      });
      if (emailResult.success) {
        await db
          .prepare('UPDATE concierge_calls SET confirmation_email_sent = 1 WHERE id = ?')
          .bind(callId)
          .run();
      }
    } catch (e) {
      console.error('Email confirmation failed:', e);
    }
  }
  try {
    const faxSent = await findFaxAndSend(env, {
      hotelName: call.hotel_name,
      hotelPhone: call.hotel_phone,
      guestName: call.guest_name || 'Guest',
      date: details.date || '',
      checkIn: details.check_in_time || '',
      checkOut: details.check_out_time || '',
      guests: details.guests || 1,
      priceQuoted: call.price_quoted || undefined,
      callId,
    });
    if (faxSent) {
      await db
        .prepare('UPDATE concierge_calls SET confirmation_fax_sent = 1 WHERE id = ?')
        .bind(callId)
        .run();
    }
  } catch (e) {
    console.error('FAX confirmation failed (non-critical):', e);
  }
}

function parseOutcome(summary: string, transcript: string): string {
  const text = `${summary} ${transcript}`.toLowerCase();
  if (
    /appointment|zoom|meeting|schedule|demo|予約|ミーティング|デモ/.test(text) &&
    /agree|confirm|set|book|ok|はい|承知|了解/.test(text)
  )
    return 'appointment_set';
  if (/interest|curious|tell me more|send info|詳しく|興味|資料/.test(text)) return 'interested';
  if (/not interested|no thank|decline|結構|いりません|不要/.test(text)) return 'not_interested';
  if (/call back|later|busy|another time|改めて|また|忙しい/.test(text))
    return 'callback_requested';
  if (/voicemail|留守番/.test(text)) return 'voicemail';
  if (/no answer|unanswered|応答なし/.test(text)) return 'no_answer';
  return 'interested';
}

function outcomeToTargetStatus(outcome: string): string {
  switch (outcome) {
    case 'appointment_set':
      return 'appointment_set';
    case 'interested':
      return 'interested';
    case 'not_interested':
      return 'not_interested';
    case 'callback_requested':
      return 'called';
    case 'voicemail':
      return 'called';
    case 'no_answer':
      return 'no_answer';
    default:
      return 'called';
  }
}

function extractZoomDate(summary: string, transcript: string): string | null {
  const text = `${summary} ${transcript}`;
  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  return null;
}

function extractCallbackTime(summary: string, transcript: string): string {
  const text = `${summary} ${transcript}`.toLowerCase();
  if (/tomorrow|明日/.test(text)) {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setUTCHours(10, 0, 0, 0);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  for (let i = 0; i < days.length; i++) {
    if (text.includes(days[i])) {
      const now = new Date();
      const currentDay = now.getUTCDay();
      const targetDay = i + 1;
      let daysAhead = targetDay - currentDay;
      if (daysAhead <= 0) daysAhead += 7;
      const d = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
      d.setUTCHours(10, 0, 0, 0);
      return d.toISOString().replace('T', ' ').slice(0, 19);
    }
  }
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setUTCHours(10, 0, 0, 0);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const data = payload.data || payload;
  const callSid = data.call_sid || data.call_control_id || data.call_id || '';
  const summary = data.summary || data.ai_summary || '';
  const transcript = data.transcript || '';
  const duration = data.duration_seconds || data.duration || null;
  if (!callSid) {
    return new Response('OK', { status: 200 });
  }

  try {
    const conciergeCall = await db
      .prepare(
        'SELECT id, session_id, call_group_id FROM concierge_calls WHERE telnyx_call_id = ?'
      )
      .bind(callSid)
      .first();

    if (conciergeCall) {
      const bookingOutcome = parseConciergeOutcome(summary, transcript);
      let priceQuoted = extractPrice(summary, transcript);
      const env = runtime?.env;

      if (priceQuoted) {
        try {
          const callRow = await db
            .prepare('SELECT request_details FROM concierge_calls WHERE id = ?')
            .bind(conciergeCall.id)
            .first();
          if (callRow) {
            const details = JSON.parse(callRow.request_details || '{}');
            const currencyCode = getCurrencyForCountry(details.hotel_country);
            if (currencyCode !== 'USD') {
              const rates = await getExchangeRates(db);
              priceQuoted = formatPriceWithUSD(priceQuoted, currencyCode, rates);
            }
          }
        } catch (e) {
          console.error('Price USD conversion failed (non-critical):', e);
        }
      }

      await db
        .prepare(
          `UPDATE concierge_calls
           SET ai_summary = ?, status = 'completed', outcome = ?, price_quoted = ?,
               availability_info = ?, duration_seconds = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
        .bind(summary, bookingOutcome, priceQuoted, transcript, duration, conciergeCall.id)
        .run();

      if (conciergeCall.call_group_id) {
        const isSuccess = bookingOutcome === 'booked' || bookingOutcome === 'available';
        const isFailed =
          bookingOutcome === 'unavailable' ||
          bookingOutcome === 'no_answer' ||
          bookingOutcome === 'voicemail' ||
          bookingOutcome === 'callback';
        const isOverBudget = bookingOutcome === 'over_budget';

        if (isSuccess) {
          await db
            .prepare(
              "UPDATE concierge_call_groups SET status = 'success', updated_at = datetime('now') WHERE id = ?"
            )
            .bind(conciergeCall.call_group_id)
            .run();
          try {
            await sendBookingConfirmations(env, db, conciergeCall.id);
          } catch (e) {
            console.error('Failed to send booking confirmations:', e);
          }
        } else if (isOverBudget) {
          await db
            .prepare(
              "UPDATE concierge_call_groups SET status = 'over_budget_pending', updated_at = datetime('now') WHERE id = ?"
            )
            .bind(conciergeCall.call_group_id)
            .run();
        } else if (isFailed) {
          try {
            const nextResult = await initiateNextGroupCall(env, db, conciergeCall.call_group_id);
            if (nextResult.status === 'all_failed') {
              try {
                await processGroupRefund(env, db, conciergeCall.call_group_id);
              } catch (e) {
                console.error('Failed to process group refund:', e);
              }
            }
          } catch (e) {
            console.error('Failed to advance group call:', e);
          }
        }
        return new Response('OK', { status: 200 });
      }

      if (bookingOutcome === 'booked') {
        try {
          await sendBookingConfirmations(env, db, conciergeCall.id);
        } catch (e) {
          console.error('Failed to send booking confirmations:', e);
        }
      } else if (
        bookingOutcome === 'unavailable' ||
        bookingOutcome === 'no_answer' ||
        bookingOutcome === 'voicemail'
      ) {
        try {
          await processRefund(env, db, conciergeCall.id);
        } catch (e) {
          console.error('Failed to process refund:', e);
        }
      }
      return new Response('OK', { status: 200 });
    }

    // Outreach call handling
    const call = await db
      .prepare('SELECT id, target_id FROM outreach_calls WHERE telnyx_call_id = ?')
      .bind(callSid)
      .first();
    if (!call) {
      return new Response('OK', { status: 200 });
    }
    const outcome = parseOutcome(summary, transcript);
    await db
      .prepare(
        `UPDATE outreach_calls
         SET ai_summary = ?, transcript = ?, outcome = ?, duration_seconds = ?,
             status = 'completed', ended_at = datetime('now')
         WHERE id = ?`
      )
      .bind(summary, transcript, outcome, duration, call.id)
      .run();

    const targetStatus = outcomeToTargetStatus(outcome);
    const updateFields = [`status = ?`, `updated_at = datetime('now')`];
    const updateValues: any[] = [targetStatus];
    if (outcome === 'appointment_set') {
      const zoomDate = extractZoomDate(summary, transcript);
      if (zoomDate) {
        updateFields.push('zoom_scheduled_at = ?');
        updateValues.push(zoomDate);
      }
    }
    if (outcome === 'callback_requested') {
      const callbackTime = extractCallbackTime(summary, transcript);
      updateFields.push('callback_at = ?');
      updateValues.push(callbackTime);
    }
    updateValues.push(call.target_id);
    await db
      .prepare(`UPDATE outreach_targets SET ${updateFields.join(', ')} WHERE id = ?`)
      .bind(...updateValues)
      .run();
  } catch (error) {
    console.error('Failed to process AI insights webhook:', error);
  }
  return new Response('OK', { status: 200 });
};
