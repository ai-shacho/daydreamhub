// Fold the "what kind of business is this" classification into
// src/lib/data/hotelCallKind.ts.
//
// The automated call reads a fixed message to whoever picks up. That is fine
// for a hotel front desk and wrong for a massage shop or somebody's flat, so
// each listing carries what it actually is and whether calling it makes sense.
// Nothing here decides on its own: "unclear" is a real answer and those rows
// are meant to be filtered out and read by a person.
//
//   node scripts/mergeCallKinds.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESULTS_DIR = '/root/form-test-results';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'data', 'hotelCallKind.ts');

const KINDS = new Set(['hotel', 'apartment', 'spa_salon', 'private_host', 'not_real', 'unclear']);
const CALLABLE = new Set(['yes', 'no', 'unclear']);

// The listings that were checked by hand, before the batch run, and so appear
// in no batch file. Left out, they would carry no classification at all and
// fall through as unknown — which for a dialler is the wrong default.
const MANUAL = {
  60: { kind: 'private_host', callable: 'no', why: 'Not a hotel at all: Opera Tower is the residential half of Address Residences Dubai Opera, let unit by unit. The "Ninety Six Hotels" attribution is a data error — that group is in Port Louis, Mauritius and has no Dubai property; the shared sales@ mailbox collided onto this row, which is also why its phone checked out as a Mauritian hotel line. The tower has a residents\' concierge, not a front desk that answers this listing.' },
  61: { kind: 'private_host', callable: 'no', why: 'Not a hotel at all: Marina Vista is an Emaar residential twin-tower at Emaar Beachfront, explicitly not a hotel or serviced-apartment operation. Same mistaken Ninety Six Hotels attribution and same shared mailbox as #60.' },
  80: { kind: 'not_real', callable: 'no', why: 'No hotel of this name exists in Bangkok and the number cannot be dialled anywhere.' },
  131: { kind: 'hotel', callable: 'yes', why: 'A boutique hotel in the You & Co group, listed on the Valencia tourism registry with a front-desk line.' },
  152: { kind: 'hotel', callable: 'yes', why: 'A boutique hotel in the same You & Co group, on the Valencia tourism registry with its own reception line.' },
  154: { kind: 'hotel', callable: 'yes', why: 'A Super 8 by Wyndham motel; the Maryland tourism board publishes its front desk.' },
  236: { kind: 'private_host', callable: 'no', why: 'phuketking.com is Phuket King Muay Thai in Kathu — a training camp with about three guest rooms, listed as a guest house. No source states a staffed reception; the published number is a WhatsApp mobile. No 24-hour front desk, so not called.' },
  245: { kind: 'hotel', callable: 'yes', why: 'A Bangkok hotel with a published switchboard, now trading as imm hotel Ladprao Bangkapi.' },
  247: { kind: 'hotel', callable: 'yes', why: 'An inn whose own contact page publishes a front desk and a toll-free reservations line.' },
  338: { kind: 'spa_salon', callable: 'no', why: 'A day spa on the eighth floor of the Pathumwan Princess Hotel — the hotel itself is a separate business with its own line.' },
  792: { kind: 'not_real', callable: 'no', why: 'No such property in Yerevan, and the number has more digits than an Armenian number can have.' },
  // Checked one question at a time in August 2026: is there a front desk
  // staffed 24 hours? That is what decides whether an automated call reaches
  // somebody whose job it is to answer. Anything less — daytime reception,
  // self check-in, a host's own mobile — is not called, and neither is a
  // property where nothing states it either way. An unproven front desk is
  // not a front desk.
  70: { kind: 'hotel', callable: 'yes', why: 'A small staffed B&B on Kiambu Road; the listing states a 24-hour front desk. Checked 2026-08-15.' },
  205: { kind: 'hotel', callable: 'yes', why: 'A 22-room B&B near Heathrow; the facilities list states a 24-hour front desk. Note the address on file is wrong — it trades at 293-295 Bath Road, Hounslow TW3 3DB, not London N15. Checked 2026-08-15.' },
  185: { kind: 'private_host', callable: 'no', why: 'Booking sites list a "24 Hour Reception", but that belongs to the Platinum KLCC building lobby, not to this operator: its own site (now FLIEXSE SUITES) advertises only WhatsApp support on one mobile and describes no reception, and it lets units across three unrelated condo towers. Dialling it would ring a personal phone. Checked 2026-08-15.' },
  202: { kind: 'private_host', callable: 'no', why: 'An exclusive beachfront house let whole, with no OTA listing anywhere and nothing stating a reception. Checked 2026-08-15.' },
  244: { kind: 'private_host', callable: 'no', why: 'No front desk appears anywhere in its 70-plus published facilities, and check-in is a one-hour window of 14:00-15:00 — incompatible with a 24-hour desk. Its own site offers a WhatsApp concierge. A retreat rather than a private host, but not somewhere to ring automatically. Checked 2026-08-15.' },
  346: { kind: 'not_real', callable: 'no', why: 'Searched again by name, street and email across Booking, Agoda, Airbnb, Expedia, Hotels.com, TripAdvisor, Instagram and Facebook: no listing exists anywhere. The only page describing it is DayDreamHub\'s own blog. Checked 2026-08-15.' },
  358: { kind: 'private_host', callable: 'no', why: 'A container-cabin homestay sold largely as a whole house; published facilities mention day security and luggage storage, no front desk. The number on file also belongs to a third-party agency. Checked 2026-08-15.' },
  // NYNA House lets around a hundred flats across unrelated buildings, and its
  // own siblings disagree — one advertises a 24-hour front desk, another says
  // reception is 11:00-16:00 with a lockbox, a third has none. Reception is a
  // property of the building, so it cannot be carried across units, and none of
  // these three could be found on any booking site.
  207: { kind: 'private_host', callable: 'no', why: 'One flat in the NYNA House chain; no listing found for this unit and no front desk established. Sibling units contradict each other, so a 24-hour desk elsewhere in the chain proves nothing here. Checked 2026-08-15.' },
  208: { kind: 'private_host', callable: 'no', why: 'A studio in an old collective-housing block; same chain and same reasoning as #207. Its name says "HK Lake" but the address is about 3km from it. Checked 2026-08-15.' },
  227: { kind: 'private_host', callable: 'no', why: 'Another NYNA House studio; same chain and same reasoning as #207. Named "Near Walking Street" but the plausible match sits in Dong Da / Ba Dinh. Checked 2026-08-15.' },
  // All three May Homestay rows are one Booking.com property. Check-in closes at
  // 23:00 and guests must give their arrival time in advance — Booking's
  // standard wording for a property with no 24-hour reception — and reviews
  // describe collecting keys by instruction.
  348: { kind: 'private_host', callable: 'no', why: 'Entire self-catering apartments; check-in closes at 23:00, arrival must be notified ahead, and no 24-hour reception is listed. Checked 2026-08-15.' },
  354: { kind: 'private_host', callable: 'no', why: 'An apartment on the same street under the same host as #348, with no listing of its own — classified with its siblings. Checked 2026-08-15.' },
  355: { kind: 'private_host', callable: 'no', why: 'A second apartment at the same address as #348, same host and same booking record. Checked 2026-08-15.' },
};

const files = readdirSync(RESULTS_DIR).filter((f) => /^kind_.*\.json$/.test(f)).sort();
const byId = new Map();
const problems = [];

for (const file of files) {
  let rows;
  try {
    rows = JSON.parse(readFileSync(join(RESULTS_DIR, file), 'utf8'));
  } catch (e) {
    problems.push(`${file}: not valid JSON — ${e.message}`);
    continue;
  }
  if (!Array.isArray(rows)) { problems.push(`${file}: expected an array`); continue; }

  for (const r of rows) {
    const id = Number(r?.id);
    if (!Number.isFinite(id)) { problems.push(`${file}: a row has no usable id`); continue; }
    if (!KINDS.has(r?.kind)) { problems.push(`${file} #${id}: unknown kind "${r?.kind}"`); continue; }
    if (!CALLABLE.has(r?.callable)) { problems.push(`${file} #${id}: unknown callable "${r?.callable}"`); continue; }
    // A spa or a private flat is never callable whatever the classifier said,
    // and neither is a row that is not a property. Belt and braces: this is the
    // one thing here that must not go wrong.
    const callable =
      r.kind === 'spa_salon' || r.kind === 'private_host' || r.kind === 'not_real' ? 'no' : r.callable;
    if (callable !== r.callable) problems.push(`#${id}: callable forced to "no" — a ${r.kind} is never called`);
    if (byId.has(id)) problems.push(`#${id}: classified twice — ${byId.get(id)._file} and ${file}; keeping the later`);
    byId.set(id, { ...r, callable, _file: file });
  }
}

for (const [id, v] of Object.entries(MANUAL)) {
  if (byId.has(Number(id))) problems.push(`#${id}: a batch classified it too; the hand-written entry wins`);
  byId.set(Number(id), { ...v, id: Number(id), _file: 'by hand' });
}

const q = (s) => `'${String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const entries = [...byId.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([id, v]) => `  ${id}: { kind: ${q(v.kind)}, callable: ${q(v.callable)}, why: ${q(v.why)} },`)
  .join('\n');

const tally = {};
for (const v of byId.values()) tally[v.kind] = (tally[v.kind] || 0) + 1;
const callTally = {};
for (const v of byId.values()) callTally[v.callable] = (callTally[v.callable] || 0) + 1;

const header = `// What kind of business each listing is, and whether an automated call belongs there.
//
// The call reads a fixed message to whoever answers. A hotel front desk is the
// case it was written for. A massage shop, a nail salon or somebody's own flat
// is not — those get the email and nothing else. "unclear" means the evidence
// did not settle it, and a person decides.
//
// Generated by scripts/mergeCallKinds.mjs. ${byId.size} listings:
${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `//   ${k}: ${n}`).join('\n')}
// callable — ${Object.entries(callTally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(', ')}

export type ListingKind = 'hotel' | 'apartment' | 'spa_salon' | 'private_host' | 'not_real' | 'unclear';
export type Callable = 'yes' | 'no' | 'unclear';

export interface CallKind {
  kind: ListingKind;
  /** Whether a fixed-script call belongs here at all. */
  callable: Callable;
  /** What that was based on, so a wrong call is visible rather than buried. */
  why: string;
}

/** Reads as a sentence at the call site: KIND_LABEL[k] */
export const KIND_LABEL: Record<ListingKind, string> = {
  hotel: 'Hotel',
  apartment: 'Serviced apartments',
  spa_salon: 'Spa or salon',
  private_host: 'Private host',
  not_real: 'Not a property',
  unclear: 'Unclear',
};

export const CALL_KINDS: Record<number, CallKind> = {
`;

writeFileSync(OUT, header + entries + '\n};\n');

console.log(`${files.length} kind files → ${byId.size} listings`);
console.log(Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`).join('\n'));
console.log('callable —', Object.entries(callTally).map(([k, n]) => `${k}: ${n}`).join(', '));
if (problems.length) {
  console.log(`\n${problems.length} thing(s) to look at:`);
  for (const p of problems) console.log(`  ${p}`);
}
