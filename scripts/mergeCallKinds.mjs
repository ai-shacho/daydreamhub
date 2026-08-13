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
  60: { kind: 'unclear', callable: 'unclear', why: 'A Dubai listing under the Ninety Six Hotels group, but nothing found says whether Opera Tower is a hotel, serviced apartments, or a private letting inside the tower.' },
  61: { kind: 'unclear', callable: 'unclear', why: 'Same group and same shared mailbox as #60; nothing found establishes what Marina Vista actually is.' },
  80: { kind: 'not_real', callable: 'no', why: 'No hotel of this name exists in Bangkok and the number cannot be dialled anywhere.' },
  131: { kind: 'hotel', callable: 'yes', why: 'A boutique hotel in the You & Co group, listed on the Valencia tourism registry with a front-desk line.' },
  152: { kind: 'hotel', callable: 'yes', why: 'A boutique hotel in the same You & Co group, on the Valencia tourism registry with its own reception line.' },
  154: { kind: 'hotel', callable: 'yes', why: 'A Super 8 by Wyndham motel; the Maryland tourism board publishes its front desk.' },
  236: { kind: 'unclear', callable: 'unclear', why: 'The operator publishes a mobile that doubles as WhatsApp and nothing found says whether this is a staffed property or one manager\'s handset.' },
  245: { kind: 'hotel', callable: 'yes', why: 'A Bangkok hotel with a published switchboard, now trading as imm hotel Ladprao Bangkapi.' },
  247: { kind: 'hotel', callable: 'yes', why: 'An inn whose own contact page publishes a front desk and a toll-free reservations line.' },
  338: { kind: 'spa_salon', callable: 'no', why: 'A day spa on the eighth floor of the Pathumwan Princess Hotel — the hotel itself is a separate business with its own line.' },
  792: { kind: 'not_real', callable: 'no', why: 'No such property in Yerevan, and the number has more digits than an Armenian number can have.' },
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
