// Turning the phone numbers hotels typed into something a dialler can call.
//
// The numbers came from a signup form with a free-text field, so they arrive as
// "+66642874922", "6626602800", "0951647465", "(230) 202 4000" and worse. A
// dialler needs the international form: a plus, the country code, then the
// national number with no leading zero.
//
// Nothing here guesses silently. When the country code cannot be established
// the result is marked unconfident so a person decides before anything is
// saved or dialled.

// Dialling codes for the countries our hotels are actually in, plus the
// spellings the data uses ("UK", "USA", "Kingdom of Bahrain", lower case).
const DIAL_CODES: Record<string, string> = {
  armenia: '374', australia: '61', bahrain: '973', 'kingdom of bahrain': '973',
  belgium: '32', bhutan: '975', brunei: '673', bulgaria: '359', cambodia: '855',
  cameroon: '237', canada: '1', colombia: '57', 'czech republic': '420',
  ecuador: '593', egypt: '20', finland: '358', france: '33', georgia: '995',
  germany: '49', ghana: '233', greece: '30', 'hong kong': '852',
  hungary: '36', 'magyarország': '36', iceland: '354', india: '91',
  indonesia: '62', iraq: '964', ireland: '353', israel: '972', italy: '39',
  japan: '81', kazakhstan: '7', kenya: '254', laos: '856', lithuania: '370',
  malaysia: '60', mexico: '52', mongolia: '976', morocco: '212',
  netherlands: '31', 'new zealand': '64', nigeria: '234', oman: '968',
  pakistan: '92', peru: '51', philippines: '63', poland: '48', portugal: '351',
  qatar: '974', russia: '7', rwanda: '250', serbia: '381', singapore: '65',
  'south africa': '27', 'south sudan': '211', spain: '34', 'sri lanka': '94',
  'são tomé and príncipe': '239', tanzania: '255', thailand: '66',
  uae: '971', 'united arab emirates': '971', uk: '44', 'united kingdom': '44',
  usa: '1', 'united states': '1', uzbekistan: '998', vietnam: '84', zambia: '260',
  // Countries the old signup data reaches even though no listing sits there today.
  mauritius: '230', turkey: '90', 'saudi arabia': '966', jordan: '962',
  lebanon: '961', kuwait: '965', china: '86', 'south korea': '82', taiwan: '886',
  myanmar: '95', nepal: '977', bangladesh: '880', maldives: '960',
  switzerland: '41', austria: '43', sweden: '46', norway: '47', denmark: '45',
  estonia: '372', latvia: '371', croatia: '385', romania: '40', ukraine: '380',
  brazil: '55', argentina: '54', chile: '56', 'costa rica': '506', panama: '507',
  uganda: '256', ethiopia: '251', senegal: '221', zimbabwe: '263',
  botswana: '267', namibia: '264', mozambique: '258', madagascar: '261',
  seychelles: '248', fiji: '679', albania: '355', cyprus: '357', malta: '356',
  slovakia: '421', slovenia: '386', 'bosnia and herzegovina': '387',
  'north macedonia': '389', montenegro: '382', moldova: '373', belarus: '375',
  azerbaijan: '994', kyrgyzstan: '996', tajikistan: '992', turkmenistan: '993',
};

export type NormalisedPhone = {
  /** International form, e.g. "+66642874922". Empty when nothing usable. */
  value: string;
  /** False when a person should look before this is used. */
  confident: boolean;
  /** Why it needs a look, in words an operator can act on. */
  note: string;
};

export function dialCodeForCountry(country: string | null | undefined): string {
  return DIAL_CODES[String(country || '').trim().toLowerCase()] || '';
}

/**
 * Best-effort international form for a number a hotel typed, using the
 * country the listing is in to supply a missing country code.
 */
export function toInternational(raw: string | null | undefined, country?: string | null): NormalisedPhone {
  const stripped = String(raw || '').replace(/[^\d+]/g, '');
  if (!stripped) return { value: '', confident: false, note: 'no number' };

  // "00" is the international prefix in most of the world.
  let s = stripped.startsWith('00') ? '+' + stripped.slice(2) : stripped;

  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (digits.length < 7 || digits.length > 15) {
      return { value: s, confident: false, note: `${digits.length} digits — outside the 7–15 a real number has` };
    }
    return { value: s, confident: true, note: '' };
  }

  const code = dialCodeForCountry(country);
  if (!code) {
    return { value: s, confident: false, note: `no country code, and the listing's country (${country || 'unknown'}) is not one we know a code for` };
  }

  // A leading zero is the national trunk prefix and is dropped when dialling in.
  if (s.startsWith('0')) {
    return { value: `+${code}${s.replace(/^0+/, '')}`, confident: false, note: `assumed a ${country} national number` };
  }

  // Already carries its country code, just without the plus.
  if (s.startsWith(code)) {
    return { value: `+${s}`, confident: true, note: '' };
  }

  return { value: `+${code}${s}`, confident: false, note: `assumed a ${country} number` };
}
