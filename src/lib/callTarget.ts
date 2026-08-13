// Which number the automated booking-request call dials — and which it never does.
//
// A listing carries two numbers. `phone` is the property's main line: the front
// desk, the switchboard, the number the business publishes. `notify_phone` is
// whoever signed the listing up — often a named person's mobile, sometimes a
// sales manager's direct line.
//
// Only the main line is ever called. The column name `notify_phone` reads like
// "the number to notify", which is exactly the trap: a later change could dial
// it without anyone noticing the decision had been reversed. So the choice
// lives here, in one function, and the dialler is expected to call this rather
// than reach into the row itself.
//
// The contact number is still worth keeping. A person chasing a booking by hand
// will want it. A machine will not use it.

import { CALL_KINDS } from './data/hotelCallKind';
import { toInternational } from './phoneFormat';

/** A number we would actually dial: a plus, then 7-15 digits. */
const DIALLABLE = /^\+\d{7,15}$/;

/** The kinds of business an automated call must never reach. */
const NEVER_CALL = new Set(['spa_salon', 'private_host', 'not_real']);

export type CallDecision =
  | { call: true; to: string }
  | { call: false; why: string };

/**
 * Whether to place the automated call for this listing, and on what number.
 *
 * Says no rather than guessing. A listing nobody has classified is not called:
 * the message is written for a hotel front desk, and reading it to a massage
 * shop or somebody's flat is worse than staying quiet.
 */
export function callTargetFor(hotel: {
  id: number;
  phone?: string | null;
  /** Present so it is visibly considered and visibly rejected. */
  notify_phone?: string | null;
  /** Set by hand in the admin screen; beats the checked classification. */
  call_kind?: string | null;
  /** Used to catch a number that cannot be dialled as stored. */
  country?: string | null;
}): CallDecision {
  const kind = String(hotel.call_kind || '').trim() || CALL_KINDS[hotel.id]?.kind;

  if (!kind) return { call: false, why: 'nobody has said what kind of business this is' };
  if (NEVER_CALL.has(kind)) return { call: false, why: `a ${kind.replace(/_/g, ' ')} is never called` };
  if (kind === 'unclear') return { call: false, why: 'what kind of business this is was never settled' };

  const main = String(hotel.phone || '').trim();
  if (!main) {
    // Deliberately not falling back to notify_phone. No main line means no call.
    return { call: false, why: 'no main line on file — the contact number is not a substitute' };
  }
  if (!DIALLABLE.test(main)) {
    return { call: false, why: `the main line "${main}" is not in international form` };
  }

  // Well-formed is not the same as diallable. Several numbers in the imported
  // data keep the national trunk "0" after the country code — "+60 0127216391"
  // passes every shape check and connects to nothing. Only the listing's own
  // country can tell, so this is skipped when the country is unknown.
  if (hotel.country) {
    const reading = toInternational(main, hotel.country);
    if (!reading.confident && reading.note) {
      return { call: false, why: `the main line needs a look first — ${reading.note}` };
    }
  }

  return { call: true, to: main };
}
