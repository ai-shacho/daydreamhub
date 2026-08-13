// What checking each number against the web found.
//
// This never removes anything. The number a hotel typed on the signup form
// stays in hotelPhoneRows.ts untouched, and stays on screen next to whatever
// the web says, because a number that is published nowhere is not therefore
// wrong — a sales team's direct line would look exactly like this. The verdict
// is a note for whoever decides, not a decision.
//
// Keyed by live hotel id: one submission can match several listings, and the
// answer differs per listing.

export type PhoneVerdict =
  /** The submitted number is published for this business. */
  | 'confirmed'
  /** The business publishes a different number. Both are kept; `webPhone` holds theirs. */
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
    note: 'Published on the hotel group\'s own site and the Valencia tourism registry, with the same salerboutique@ address used at signup. The submitted contact mobile +34 679 835 528 is published nowhere, which is normal for a personal line — kept as-is.',
    source: 'https://youandcohotels.com/saler-boutique',
    matchedOn: 'name, street address and signup email all match',
    checked: '2026-08-12',
  },
  152: {
    verdict: 'differs',
    webPhone: '+34963154012',
    webPhoneAlt: '+34601446327',
    note: 'The submission carried the sister property\'s (Saler) contact block while naming Quart. Quart publishes +34 963 154 012 — shared with the group\'s Botánico property next door.',
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
    note: 'Published on the business\'s own contact page. It is a day spa on the 8th floor of the Pathumwan Princess Hotel rather than a hotel; the hotel itself has a separate line.',
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
