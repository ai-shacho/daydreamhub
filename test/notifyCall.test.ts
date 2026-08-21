/**
 * @jest-environment node
 *
 * What a partner hotel actually hears when a booking lands.
 *
 * Partner hotels were not called at all between 427433a and this change, so
 * this script has never been spoken down a phone line. Asserting on the TwiML
 * is the closest thing to listening to it: it is the exact text Twilio reads.
 */

import { POST } from '../src/pages/api/webhooks/twilio-voice';

const BOOKING = {
  id: 7,
  guest_name: 'Aiko Tanaka',
  guest_email: 'guest@example.com',
  guest_phone: '+819012345678',
  check_in_date: '2026-09-04',
  check_in_time: '13:00',
  check_out_time: '18:00',
  guests: 2,
  hotel_name: 'The Pantip Hotel Ladprao',
};

function fakeDb(overrides: { booking?: any } = {}) {
  const writes: string[] = [];
  return {
    writes,
    prepare(sql: string) {
      const api: any = {
        bind: (..._b: any[]) => api,
        all: async () => {
          if (sql.includes('PRAGMA table_info')) {
            return { results: ['id', 'status', 'note', 'phase', 'last_step', 'updated_at'].map((name) => ({ name })) };
          }
          return { results: [] };
        },
        run: async () => { writes.push(sql); return { meta: { last_row_id: 1 } }; },
        first: async () => {
          if (sql.includes('FROM call_logs')) return { id: 1, booking_id: 7, note: '', phase: 'notify' };
          if (sql.includes('FROM bookings')) return overrides.booking === undefined ? BOOKING : overrides.booking;
          return null;
        },
      };
      return api;
    },
  };
}

const hit = (db: any, qs: string, form: Record<string, string> = {}) => {
  const href = `https://daydreamhub.com/api/webhooks/twilio-voice?${qs}`;
  return (POST as any)({
    request: new Request(href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ CallSid: 'CAtest', ...form }).toString(),
    }),
    // Astro hands the route a parsed URL alongside the request.
    url: new URL(href),
    locals: { runtime: { env: { DB: db } } },
  });
};

/** The words Twilio will read aloud, with the markup taken back out. */
const spoken = (xml: string) =>
  (xml.match(/<Say[^>]*>([\s\S]*?)<\/Say>/g) || [])
    .map((s) => s.replace(/<[^>]+>/g, ''))
    .join(' ')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

describe('the notification call', () => {
  it('says who is calling, what arrived, and where to answer it', async () => {
    const res = await hit(fakeDb(), 'lid=1&phase=notify');
    const xml = await res.text();
    const said = spoken(xml);

    expect(said).toContain('This is DayDreamHub');
    expect(said).toContain('The Pantip Hotel Ladprao');   // 施設名
    expect(said).toContain('new day-use booking');
    expect(said).toContain('2026-09-04');
    expect(said).toContain('1:00 PM to 6:00 PM');
    expect(said).toContain('2 people');
    expect(said).toContain('sent to your email');          // メールを見る
    expect(said).toContain('owner portal');                // ポータルで対応
    expect(said).toContain('Press 1');
  });

  it('does not ask a partner hotel whether it does day use', async () => {
    // That is the other script. Reading it to a hotel already listed with us is
    // the failure this whole split exists to prevent.
    const said = spoken(await (await hit(fakeDb(), 'lid=1&phase=notify')).text());
    expect(said).not.toContain('Do you offer day-use');
    expect(said).not.toContain('invite your property');
  });

  it('still asks a hotel that is not listed with us', async () => {
    const said = spoken(await (await hit(fakeDb(), 'lid=1&phase=booking')).text());
    expect(said).toContain('Do you offer day-use plans');
    expect(said).not.toContain('owner portal');
  });

  it('repeats the same words when asked to, not a paraphrase', async () => {
    const first = spoken(await (await hit(fakeDb(), 'lid=1&phase=notify')).text());
    const again = spoken(await (await hit(fakeDb(), 'lid=1&phase=notify&step=notify_ack&turn=0', { Digits: '2' })).text());
    expect(again).toBe(first);
  });

  it('closes on 1 without claiming the hotel accepted anything', async () => {
    const db = fakeDb();
    const xml = await (await hit(db, 'lid=1&phase=notify&step=notify_ack&turn=0', { Digits: '1' })).text();
    expect(xml).toContain('<Hangup/>');
    expect(spoken(xml)).toContain('owner portal');
    // 'confirmed' would mean the hotel took the booking. It has only heard about it.
    expect(db.writes.join(' ')).toContain('UPDATE call_logs');
  });

  it('leaves out the times when the plan has none', async () => {
    const db = fakeDb({ booking: { ...BOOKING, check_in_time: null, check_out_time: null } });
    const said = spoken(await (await hit(db, 'lid=1&phase=notify')).text());
    expect(said).toContain('new day-use booking');
    expect(said).not.toContain('undefined');
    expect(said).not.toContain('null');
  });
});
