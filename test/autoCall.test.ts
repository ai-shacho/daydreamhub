/**
 * The booking dialler's guard.
 *
 * The point of these is not that callTargetFor returns the right verdict — that
 * is its own concern — but that triggerAutoCall and initiateCall actually ask.
 * Before this, callTargetFor existed and nothing imported it, so a salon or
 * somebody's flat would have been dialled with a message written for a front
 * desk. A test that only checked callTargetFor would have passed the whole time.
 */

import { triggerAutoCall, initiateCall } from '../src/lib/autoCall';

/** Just enough D1 to record what was written. */
function fakeDb() {
  const writes: Array<{ sql: string; binds: any[] }> = [];
  return {
    writes,
    prepare(sql: string) {
      return {
        bind(...binds: any[]) {
          return {
            run: async () => {
              writes.push({ sql, binds });
              return { meta: { last_row_id: writes.length } };
            },
            first: async () => null,
          };
        },
      };
    },
  };
}

function env(db: any) {
  return {
    DB: db,
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_AUTH_TOKEN: 'token',
    TWILIO_FROM_NUMBER: '+15005550006',
  };
}

const booking = (over: Record<string, any> = {}) => ({
  booking_id: 1,
  hotel_id: 999999, // outside the checked classification set on purpose
  hotel_name: 'Somewhere',
  hotel_phone: '+66812345678',
  hotel_country: 'Thailand',
  hotel_call_kind: 'hotel',
  guest_name: 'Guest',
  check_in_date: '2026-09-01',
  check_in_time: '13:00',
  check_out_time: '18:00',
  guests: 2,
  plan_name: 'Day use',
  ...over,
});

const dialled = () => (globalThis.fetch as jest.Mock).mock.calls.filter(
  (c) => String(c[0]).includes('twilio')
);

/** The query the voice webhook will be reached on, i.e. which script is read. */
function dialledPhase(): string | null {
  const call = dialled()[0];
  if (!call) return null;
  const url = new URLSearchParams(String(call[1]?.body || '')).get('Url') || '';
  return new URL(url).searchParams.get('phase');
}

/** The 'To' Twilio was asked to ring, or null if it was never asked. */
function dialledNumber(): string | null {
  const call = dialled()[0];
  if (!call) return null;
  return new URLSearchParams(String(call[1]?.body || '')).get('To');
}

const skippedWrites = (db: any) =>
  db.writes.filter((w: any) => w.sql.includes("'skipped'"));

beforeEach(() => {
  globalThis.fetch = jest.fn(async () =>
    new Response(JSON.stringify({ sid: 'CA_test' }), { status: 201 })
  ) as any;
  // Quiet hours would defer the call and hide whether it was refused.
  jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('9/1/2026, 2:00:00 PM');
});

afterEach(() => jest.restoreAllMocks());

describe('triggerAutoCall', () => {
  it('rings a hotel on its main line', async () => {
    const db = fakeDb();
    await triggerAutoCall(env(db), booking());
    expect(dialledNumber()).toBe('+66812345678');
    expect(skippedWrites(db)).toHaveLength(0);
  });

  it('never rings a salon, and says so in the log', async () => {
    const db = fakeDb();
    await triggerAutoCall(env(db), booking({ hotel_call_kind: 'spa_salon' }));
    expect(dialled()).toHaveLength(0);
    const [row] = skippedWrites(db);
    expect(row.binds.join(' ')).toContain('spa salon is never called');
  });

  it('never rings a private host', async () => {
    const db = fakeDb();
    await triggerAutoCall(env(db), booking({ hotel_call_kind: 'private_host' }));
    expect(dialled()).toHaveLength(0);
    expect(skippedWrites(db)).toHaveLength(1);
  });

  it('does not fall back to the contact number when there is no main line', async () => {
    const db = fakeDb();
    await triggerAutoCall(
      env(db),
      booking({ hotel_phone: '', notify_phone: '+66899999999' })
    );
    expect(dialled()).toHaveLength(0);
    expect(skippedWrites(db)[0].binds.join(' ')).toContain('no main line');
  });

  it('refuses a number that kept the national trunk zero', async () => {
    const db = fakeDb();
    // +60 0127216391 passes every shape check and connects to nothing.
    await triggerAutoCall(
      env(db),
      booking({ hotel_phone: '+600127216391', hotel_country: 'Malaysia' })
    );
    expect(dialled()).toHaveLength(0);
    expect(skippedWrites(db)[0].binds.join(' ')).toContain('trunk');
  });

  it('still rings a listing nobody has classified', async () => {
    // A booking that never reaches its hotel is worse than a call to the wrong
    // sort of business, and the automated call is the only notice a non-partner
    // hotel gets. Blocking here would strand every unclassified listing.
    const db = fakeDb();
    await triggerAutoCall(env(db), booking({ hotel_call_kind: '' }));
    expect(dialledNumber()).toBe('+66812345678');
    expect(skippedWrites(db)).toHaveLength(0);
  });
});

describe('which script the call reads', () => {
  // A hotel with an email has a portal and already has the booking in its inbox,
  // so it is told the booking landed. One without has neither, so the call is
  // the whole conversation. Getting this backwards would read a stranger a
  // message about "your owner portal", or ask a partner whether it does day use.
  it('reads the notification script to a hotel with an email', async () => {
    const db = fakeDb();
    await triggerAutoCall(env(db), booking({ hotel_email: 'front@hotel.example' }));
    expect(dialledPhase()).toBe('notify');
  });

  it('reads the booking script to a hotel without one', async () => {
    const db = fakeDb();
    await triggerAutoCall(env(db), booking({ hotel_email: '' }));
    expect(dialledPhase()).toBe('booking');
  });

  it('does not count whitespace as an email', async () => {
    const db = fakeDb();
    await triggerAutoCall(env(db), booking({ hotel_email: '   ' }));
    expect(dialledPhase()).toBe('booking');
  });

  it('rings a hotel with an email at all — it used to be skipped outright', async () => {
    const db = fakeDb();
    await triggerAutoCall(env(db), booking({ hotel_email: 'front@hotel.example' }));
    expect(dialledNumber()).toBe('+66812345678');
  });

  it('still refuses a salon that happens to have an email', async () => {
    const db = fakeDb();
    await triggerAutoCall(env(db), booking({ hotel_email: 'spa@example.com', hotel_call_kind: 'spa_salon' }));
    expect(dialled()).toHaveLength(0);
    expect(skippedWrites(db)).toHaveLength(1);
  });
});

describe('initiateCall', () => {
  // The overnight-queue cron calls this one directly, bypassing triggerAutoCall.
  it('refuses a salon reclassified after the call was queued', async () => {
    const db = fakeDb();
    await initiateCall(env(db), 42, booking({ hotel_call_kind: 'spa_salon' }));
    expect(dialled()).toHaveLength(0);
    const [row] = skippedWrites(db);
    expect(row.sql).toContain('UPDATE call_logs');
    expect(row.binds).toContain(42);
  });

  it('rings a hotel that is still a hotel', async () => {
    const db = fakeDb();
    await initiateCall(env(db), 42, booking());
    expect(dialledNumber()).toBe('+66812345678');
  });
});
