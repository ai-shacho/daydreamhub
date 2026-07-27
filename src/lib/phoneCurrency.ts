// Currency detection from a phone number's international dial code.
// Used by the AI concierge call flow: the guest's max budget and the phone
// conversation happen in the called hotel's local currency.

// Longest-prefix-first lookup table: dial code → [currency, spoken name].
// +1 defaults to USD (Canada shares +1), +7 to RUB, Ecuador (+593) uses USD.
export const DIAL_CURRENCY: Record<string, [string, string]> = {
  '81': ['JPY', 'Japanese yen'],
  '66': ['THB', 'Thai baht'],
  '60': ['MYR', 'Malaysian ringgit'],
  '62': ['IDR', 'Indonesian rupiah'],
  '84': ['VND', 'Vietnamese dong'],
  '63': ['PHP', 'Philippine pesos'],
  '856': ['LAK', 'Lao kip'],
  '855': ['KHR', 'Cambodian riel'],
  '94': ['LKR', 'Sri Lankan rupees'],
  '91': ['INR', 'Indian rupees'],
  '92': ['PKR', 'Pakistani rupees'],
  '975': ['BTN', 'Bhutanese ngultrum'],
  '976': ['MNT', 'Mongolian tugrik'],
  '852': ['HKD', 'Hong Kong dollars'],
  '65': ['SGD', 'Singapore dollars'],
  '673': ['BND', 'Brunei dollars'],
  '971': ['AED', 'UAE dirhams'],
  '974': ['QAR', 'Qatari riyals'],
  '973': ['BHD', 'Bahraini dinars'],
  '968': ['OMR', 'Omani rials'],
  '972': ['ILS', 'Israeli shekels'],
  '90': ['TRY', 'Turkish lira'],
  '20': ['EGP', 'Egyptian pounds'],
  '212': ['MAD', 'Moroccan dirhams'],
  '254': ['KES', 'Kenyan shillings'],
  '234': ['NGN', 'Nigerian naira'],
  '255': ['TZS', 'Tanzanian shillings'],
  '250': ['RWF', 'Rwandan francs'],
  '260': ['ZMW', 'Zambian kwacha'],
  '27': ['ZAR', 'South African rand'],
  '237': ['XAF', 'Central African francs'],
  '211': ['SSP', 'South Sudanese pounds'],
  '239': ['STN', 'Sao Tome dobras'],
  '995': ['GEL', 'Georgian lari'],
  '374': ['AMD', 'Armenian drams'],
  '998': ['UZS', 'Uzbekistani som'],
  '7': ['RUB', 'Russian rubles'],
  '44': ['GBP', 'British pounds'],
  '353': ['EUR', 'euros'],
  '33': ['EUR', 'euros'],
  '49': ['EUR', 'euros'],
  '31': ['EUR', 'euros'],
  '34': ['EUR', 'euros'],
  '351': ['EUR', 'euros'],
  '39': ['EUR', 'euros'],
  '30': ['EUR', 'euros'],
  '36': ['HUF', 'Hungarian forints'],
  '420': ['CZK', 'Czech koruna'],
  '381': ['RSD', 'Serbian dinars'],
  '359': ['BGN', 'Bulgarian lev'],
  '370': ['EUR', 'euros'],
  '358': ['EUR', 'euros'],
  '354': ['ISK', 'Icelandic krona'],
  '1': ['USD', 'US dollars'],
  '52': ['MXN', 'Mexican pesos'],
  '57': ['COP', 'Colombian pesos'],
  '51': ['PEN', 'Peruvian soles'],
  '593': ['USD', 'US dollars'],
  '61': ['AUD', 'Australian dollars'],
  '64': ['NZD', 'New Zealand dollars'],
};

const PREFIXES = Object.keys(DIAL_CURRENCY).sort((a, b) => b.length - a.length);

export function currencyForPhone(phone: unknown): { currency: string; spoken: string } {
  const digits = String(phone ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  for (const p of PREFIXES) {
    if (digits.startsWith(p)) {
      const [currency, spoken] = DIAL_CURRENCY[p];
      return { currency, spoken };
    }
  }
  return { currency: 'USD', spoken: 'US dollars' };
}

export function spokenNameForCurrency(code: unknown): string {
  const c = String(code || 'USD').toUpperCase();
  for (const [cur, spoken] of Object.values(DIAL_CURRENCY)) {
    if (cur === c) return spoken;
  }
  return c === 'USD' ? 'US dollars' : c;
}
