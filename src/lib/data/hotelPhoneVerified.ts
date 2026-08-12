// What checking the doubtful numbers against the web actually found.
//
// Every listing the importer could not resolve on its own was looked up: the
// hotel's own site first, then the regional tourism registry, then the booking
// sites. The findings live here rather than being folded into the raw data so
// the original submission stays visible next to the correction.
//
// Keyed by the live hotel id, since the same submission can match more than one
// listing and the verdicts differ per listing.

export type PhoneVerdict =
  | 'confirmed'   // the number we had is published for that hotel
  | 'corrected'   // it was wrong; `phone` holds the published one
  | 'unverified'  // nothing reliable found either way
  | 'test';       // not a real property

export interface PhoneVerification {
  verdict: PhoneVerdict;
  /** The number to use, when checking produced one. Empty means: do not import. */
  phone?: string;
  notify_phone?: string;
  /** What was found, in a sentence, for whoever reviews the row. */
  note: string;
  /** Where it was found. */
  source?: string;
}

export const PHONE_VERIFICATIONS: Record<number, PhoneVerification> = {
  60: {
    verdict: 'corrected',
    phone: '',
    note: 'The number is +230 202 4000 — the Labourdonnais Waterfront Hotel in Port Louis, Mauritius. It reached this Dubai listing because both carry sales@ninetysixhotels.com. Nothing links it to Opera Tower.',
    source: 'https://ninetysixhotels.com/labourdonnais-waterfront-hotel-port-louis-mauritius.html',
  },
  61: {
    verdict: 'corrected',
    phone: '',
    note: 'Same Mauritian number as listing #60, same shared email. Not a Marina Vista line.',
    source: 'https://ninetysixhotels.com/labourdonnais-waterfront-hotel-port-louis-mauritius.html',
  },
  79: {
    verdict: 'unverified',
    phone: '',
    note: 'Every published number differs from ours (+234 813 543 4505 on the Abuja city guide). 0707 is a valid Nigerian mobile prefix, so ours is well-formed but appears nowhere. The hotel\'s own site would not load.',
    source: 'https://wakaabuja.com/summerset-continental-hotel/',
  },
  80: {
    verdict: 'test',
    note: 'No hotel of this name in Bangkok. The number is 10 digits, which cannot be a Thai mobile, and reads as a Nigerian mobile (0803…). The same digits appear on listing #792 in Armenia.',
  },
  131: {
    verdict: 'confirmed',
    phone: '+34961830073',
    note: 'Published on the hotel group\'s own site and the Valencia tourism registry, alongside the same salerboutique@ address used at signup. The contact mobile +34 679 835 528 is not published anywhere — plausible for a personal line, but unverified.',
    source: 'https://youandcohotels.com/saler-boutique',
  },
  152: {
    verdict: 'corrected',
    phone: '+34963154012',
    notify_phone: '',
    note: 'The submission carried the Saler property\'s contact block while naming Quart. Quart\'s own line is +34 963 154 012 — shared with the group\'s Botánico property next door, so it reaches the right operator rather than a Quart-only desk.',
    source: 'https://youandcohotels.com/en/contact-hotel-quart-boutique',
  },
  154: {
    verdict: 'confirmed',
    phone: '+14107800030',
    notify_phone: '',
    note: 'Front desk confirmed by the Maryland tourism board. The contact field held 417800030 — the same number with a digit dropped — so it is discarded rather than dialled.',
    source: 'https://www.visitmaryland.org/listing/hotels-motels/super-8-wyndham-baltimoreessex',
  },
  236: {
    verdict: 'corrected',
    phone: '+66615155947',
    notify_phone: '+66615155947',
    note: 'The main line we had matches nothing the operator publishes. Their site gives +66 61 515 5947 (also their WhatsApp) and +66 96 994 6243; the contact number on file was already the first of those.',
    source: 'https://www.phuketking.com/contact/',
  },
  245: {
    verdict: 'confirmed',
    phone: '+6621844899',
    note: 'Matches the published line. Note the property now trades as "imm hotel Ladprao Bangkapi" and thepantiphotels.com redirects away, so the signup email addresses may be dead.',
    source: 'https://www.hotelscombined.com/Hotel/The_Pantip_Hotel_Ladprao_Bangkok.htm',
  },
  304: {
    verdict: 'unverified',
    phone: '',
    note: 'The inn publishes a Cebu landline (+63 32 254 6372); the mobile we hold appears on no reachable source. Their own domain is parked. It may be a staff mobile — unconfirmed either way.',
    source: 'https://www.momondo.com/hotels/cebu-city/Dynasty-Tourist-Inn.mhd2017790.ksp',
  },
  338: {
    verdict: 'confirmed',
    phone: '+66989935113',
    note: 'Published on the business\'s own contact page. Worth knowing: it is a day spa on the 8th floor of the Pathumwan Princess Hotel, not a hotel — the hotel has its own separate line.',
    source: 'https://www.bangkokspa.co.th/en/contact',
  },
  341: {
    verdict: 'unverified',
    phone: '',
    note: 'No published number anywhere; the only web presence is our own listing. The address is a residential condominium in Lapu-Lapu let out by individual owners, and the name reads as a person — almost certainly a private host rather than a property with a business line.',
  },
  349: {
    verdict: 'unverified',
    phone: '',
    note: 'The listing is a herbal spa and wellness clinic on Phetchaburi Road, not accommodation. Its own site has expired and every directory refused to load, so nothing could be confirmed; the number we hold matches no source found.',
  },
  792: {
    verdict: 'test',
    note: 'No such property in Yerevan. The number is 10 digits after +374 where Armenian numbers are 8, so it cannot be dialled, and the same raw digits appear on the Bangkok listing #80.',
  },
  247: {
    verdict: 'confirmed',
    phone: '+15624937501',
    note: 'Published on the hotel\'s own contact page. Listed publicly as "The Pacific Inn".',
    source: 'https://www.thepacificinn.com/contact.asp',
  },
};
