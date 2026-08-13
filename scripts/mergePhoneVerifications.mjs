// Fold the web-checking results into src/lib/data/hotelPhoneVerified.ts.
//
// The checks were done in batches, each writing a result_NN.json of
// {id, verdict, webPhone, webPhoneAlt, note, source, matchedOn}. This turns
// them into the one file the admin page reads.
//
// It never drops a number. The verdict is a note for whoever reviews the row;
// the number a hotel typed stays in hotelPhoneRows.ts either way.
//
//   node scripts/mergePhoneVerifications.mjs [checkedDate]

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESULTS_DIR = '/root/form-test-results';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'data', 'hotelPhoneVerified.ts');
const CHECKED = process.argv[2] || '2026-08-13';

const VERDICTS = new Set(['confirmed', 'differs', 'not_published', 'wrong_business', 'not_a_property']);

// Entries written by hand before the batch run, kept because their evidence is
// the number itself rather than a page — the batches identify by name and
// address and so would never have found them.
const MANUAL = {
  60: {
    verdict: 'wrong_business',
    webPhone: '+2302024000',
    note: 'The submitted number is the Labourdonnais Waterfront Hotel in Port Louis, Mauritius. It reached this Dubai listing because both carry sales@ninetysixhotels.com. Nothing found ties it to Opera Tower — but the submitted value is kept in case it is a group line.',
    source: 'https://ninetysixhotels.com/labourdonnais-waterfront-hotel-port-louis-mauritius.html',
    matchedOn: 'the number itself, traced to a published hotel line',
    checked: '2026-08-12',
  },
  61: {
    verdict: 'wrong_business',
    webPhone: '+2302024000',
    note: 'Same Mauritian number and same shared email as listing #60. Nothing links it to Marina Vista.',
    source: 'https://ninetysixhotels.com/labourdonnais-waterfront-hotel-port-louis-mauritius.html',
    matchedOn: 'the number itself, traced to a published hotel line',
    checked: '2026-08-12',
  },
  80: {
    verdict: 'not_a_property',
    note: 'No hotel of this name in Bangkok. The number is 10 digits, which cannot be a Thai mobile, and reads as a Nigerian mobile (0803…). The same digits appear on listing #792 in Armenia.',
    matchedOn: 'name search returned nothing',
    checked: '2026-08-12',
  },
  131: {
    verdict: 'confirmed',
    webPhone: '+34961830073',
    webPhoneAlt: '+34690996885',
    note: "Published on the hotel group's own site and the Valencia tourism registry, with the same salerboutique@ address used at signup. The submitted contact mobile +34 679 835 528 is published nowhere, which is normal for a personal line — kept as-is.",
    source: 'https://youandcohotels.com/saler-boutique',
    matchedOn: 'name, street address and signup email all match',
    checked: '2026-08-12',
  },
  152: {
    verdict: 'differs',
    webPhone: '+34963154012',
    webPhoneAlt: '+34601446327',
    note: "The submission carried the sister property's (Saler) contact block while naming Quart. Quart publishes +34 963 154 012 — shared with the group's Botánico property next door.",
    source: 'https://youandcohotels.com/en/contact-hotel-quart-boutique',
    matchedOn: 'name and street address; corroborated by the Valencia tourism registry',
    checked: '2026-08-12',
  },
  154: {
    verdict: 'confirmed',
    webPhone: '+14107800030',
    note: 'Front desk confirmed by the Maryland tourism board at the same street address. The contact field held 417800030 — the same number with a digit dropped, so it cannot be dialled as written.',
    source: 'https://www.visitmaryland.org/listing/hotels-motels/super-8-wyndham-baltimoreessex',
    matchedOn: 'name and street address',
    checked: '2026-08-12',
  },
  // Two batches reached this property from different listings and disagreed.
  // The one that called it unpublished had only tried zaalhotel.uz, which
  // answers 403 and serves someone else's certificate; the other found the
  // submitted number published on a Samarkand travel agency's page. Published
  // beats not-found, so both listings say confirmed.
  167: {
    verdict: 'confirmed',
    webPhone: '+998916160070',
    note: 'The submitted number is published for ZAAL Hotel, Farhod 24, Samarkand. The hotel\'s own site zaalhotel.uz cannot be read — it answers 403 and serves a certificate for another domain — so this rests on an agency listing, which is also where the same property was confirmed via listing #149.',
    source: 'https://mdktravel.com/hotels/zaal-hotel',
    matchedOn: 'name, street address and city',
    checked: '2026-08-13',
  },
  236: {
    verdict: 'differs',
    webPhone: '+66615155947',
    webPhoneAlt: '+66969946243',
    note: 'The submitted main line matches nothing the operator publishes; the closest published number shares only its prefix. Their site gives +66 61 515 5947 (also WhatsApp), which is what the submission already held as the contact number.',
    source: 'https://www.phuketking.com/contact/',
    matchedOn: 'name and signup email domain',
    checked: '2026-08-12',
  },
  245: {
    verdict: 'confirmed',
    webPhone: '+6621844899',
    note: 'Matches the published line. The property now trades as "imm hotel Ladprao Bangkapi" and thepantiphotels.com redirects away, so the signup email addresses may be dead even though the number is right.',
    source: 'https://www.hotelscombined.com/Hotel/The_Pantip_Hotel_Ladprao_Bangkok.htm',
    matchedOn: 'name and street address',
    checked: '2026-08-12',
  },
  247: {
    verdict: 'confirmed',
    webPhone: '+15624937501',
    webPhoneAlt: '+18664660300',
    note: 'Published on the hotel\'s own contact page at the same address. Listed publicly as "The Pacific Inn".',
    source: 'https://www.thepacificinn.com/contact.asp',
    matchedOn: 'name, street address and signup email domain',
    checked: '2026-08-12',
  },
  338: {
    verdict: 'confirmed',
    webPhone: '+66989935113',
    webPhoneAlt: '+6622163700',
    note: "Published on the business's own contact page. It is a day spa on the 8th floor of the Pathumwan Princess Hotel rather than a hotel; the hotel itself has a separate line.",
    source: 'https://www.bangkokspa.co.th/en/contact',
    matchedOn: 'name and street address',
    checked: '2026-08-12',
  },
  792: {
    verdict: 'not_a_property',
    note: 'No such property in Yerevan. The number is 10 digits after +374 where Armenian numbers are 8, so it cannot be dialled, and the same raw digits appear on the Bangkok listing #80.',
    matchedOn: 'name search returned nothing',
    checked: '2026-08-12',
  },
};

const files = readdirSync(RESULTS_DIR).filter((f) => /^result_.*\.json$/.test(f)).sort();
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
    if (!VERDICTS.has(r?.verdict)) { problems.push(`${file} #${id}: unknown verdict "${r?.verdict}"`); continue; }
    if (byId.has(id)) problems.push(`#${id}: checked twice — ${byId.get(id)._file} and ${file}; keeping the later`);
    byId.set(id, { ...r, _file: file, checked: r.checked || CHECKED });
  }
}

// Hand-written entries win: they were reasoned about individually.
for (const [id, v] of Object.entries(MANUAL)) byId.set(Number(id), { ...v, id: Number(id), _file: 'by hand' });

const q = (s) => `'${String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const entries = [...byId.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([id, v]) => {
    const lines = [`    verdict: ${q(v.verdict)},`];
    if (v.webPhone) lines.push(`    webPhone: ${q(v.webPhone)},`);
    if (v.webPhoneAlt) lines.push(`    webPhoneAlt: ${q(v.webPhoneAlt)},`);
    lines.push(`    note: ${q(v.note)},`);
    if (v.source) lines.push(`    source: ${q(v.source)},`);
    if (v.matchedOn) lines.push(`    matchedOn: ${q(v.matchedOn)},`);
    lines.push(`    checked: ${q(v.checked)},`);
    return `  ${id}: {\n${lines.join('\n')}\n  },`;
  })
  .join('\n');

const tally = {};
for (const v of byId.values()) tally[v.verdict] = (tally[v.verdict] || 0) + 1;

const header = `// What checking each number against the web found.
//
// This never removes anything. The number a hotel typed on the signup form
// stays in hotelPhoneRows.ts untouched, and stays on screen next to whatever
// the web says, because a number that is published nowhere is not therefore
// wrong — a sales team's direct line would look exactly like this. The verdict
// is a note for whoever decides, not a decision.
//
// Keyed by live hotel id: one submission can match several listings, and the
// answer differs per listing.
//
// Generated by scripts/mergePhoneVerifications.mjs from the batch checks in
// /root/form-test-results. ${byId.size} listings checked:
${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `//   ${k}: ${n}`).join('\n')}

export type PhoneVerdict =
  /** The submitted number is published for this business. */
  | 'confirmed'
  /** The business publishes a different number. Both are kept; \`webPhone\` holds theirs. */
  | 'differs'
  /** The business is real but publishes no number we could reach. */
  | 'not_published'
  /** The submitted number demonstrably belongs to a different business. */
  | 'wrong_business'
  /** No such property — test or placeholder data. */
  | 'not_a_property';

export interface PhoneVerification {
  verdict: PhoneVerdict;
  /** The number the business publishes today, when one was found. */
  webPhone?: string;
  /** A second published number, e.g. a mobile or WhatsApp line. */
  webPhoneAlt?: string;
  /** What was found, in a sentence, for whoever reviews the row. */
  note: string;
  /** Where it was found. */
  source?: string;
  /** How the business was identified, so a wrong match is visible. */
  matchedOn?: string;
  /** When this check was done. */
  checked?: string;
}

export const PHONE_VERIFICATIONS: Record<number, PhoneVerification> = {
`;

writeFileSync(OUT, header + entries + '\n};\n');

console.log(`${files.length} result files → ${byId.size} listings`);
console.log(Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`).join('\n'));
if (problems.length) {
  console.log(`\n${problems.length} thing(s) to look at:`);
  for (const p of problems) console.log(`  ${p}`);
}
