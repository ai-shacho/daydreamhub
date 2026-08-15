// Multi-currency helpers.
// Policy: hotels price in their local currency (plans.price_local + hotels.currency),
// guests see local + USD side by side, PayPal always settles in USD.
// `rates` is the USD-based map returned by getExchangeRates() in tools.ts.

// PayPal (and general) zero-decimal currencies: amounts must be integers.
export const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'HUF', 'TWD', 'KRW', 'VND', 'CLP', 'ISK']);

export function roundForCurrency(amount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) return Math.round(amount);
  return Math.round(amount * 100) / 100;
}

export function formatMoney(amount: number, currency: string): string {
  const digits = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    // Unknown currency code: fall back to plain formatting.
    return `${currency} ${amount.toFixed(digits)}`;
  }
}

export function convertLocalToUsd(amount: number, currency: string, rates: Record<string, number>): number | null {
  if (currency === 'USD') return roundForCurrency(amount, 'USD');
  const rate = Number(rates?.[currency]);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((amount / rate) * 100) / 100;
}

export function convertUsdToLocal(amount: number, currency: string, rates: Record<string, number>): number | null {
  if (currency === 'USD') return roundForCurrency(amount, 'USD');
  const rate = Number(rates?.[currency]);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return roundForCurrency(amount * rate, currency);
}

// Unified guest-facing price string:
//   USD hotel      → "$61.04"
//   non-USD hotel  → "¥10,000 (≈ $61.04 USD)"
// USD is always shown with 2 decimals for consistency across the site.
export function formatLocalWithUsd(localAmount: number, currency: string, usdAmount: number): string {
  const usd = `$${Number(usdAmount || 0).toFixed(2)}`;
  if (!currency || String(currency).toUpperCase() === 'USD') return usd;
  return `${formatMoney(Number(localAmount || 0), currency)} (≈ ${usd} USD)`;
}

// "EGP 2,500 (≈ $52)" for non-USD hotels; plain "$52" for USD hotels.
export function formatDualPrice(localAmount: number, currency: string, rates: Record<string, number>): string {
  if (!currency || currency === 'USD') return formatMoney(localAmount, 'USD');
  const usd = convertLocalToUsd(localAmount, currency, rates);
  const local = formatMoney(localAmount, currency);
  return usd == null ? local : `${local} (≈ ${formatMoney(usd, 'USD')})`;
}

// Fallback list if the exchange-rate API is unavailable (owner/admin selectors
// prefer the full live list via supportedCurrencyCodes()).
export const CURRENCY_CHOICES = [
  'USD', 'EUR', 'GBP', 'JPY', 'GEL', 'EGP', 'AED', 'TRY', 'MAD', 'KES',
  'NGN', 'ZAR', 'THB', 'PHP', 'IDR', 'INR', 'VND', 'MXN', 'CAD', 'AUD',
  'SGD', 'HKD', 'KRW', 'CNY', 'AMD', 'AZN', 'RSD', 'UZS',
];

// Every currency the free exchange-rate API supports (~160), USD first then
// alphabetical. Used to populate the hotel pricing-currency selectors so any
// hotel can price in its own currency. Falls back to CURRENCY_CHOICES.
export async function supportedCurrencyCodes(db: any): Promise<string[]> {
  try {
    const { getExchangeRates } = await import('./tools');
    const rates = await getExchangeRates(db);
    const codes = Object.keys(rates || {}).filter((c) => /^[A-Z]{3}$/.test(c));
    if (codes.length > 5) {
      const rest = codes.filter((c) => c !== 'USD').sort();
      return ['USD', ...rest];
    }
  } catch { /* fall through */ }
  return CURRENCY_CHOICES;
}

export function isValidCurrencyCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

// When a hotel switches currency, keep each plan's value (anchored on the USD
// cache) and re-derive price_local in the new currency. Owners then fine-tune.
export async function repriceHotelPlansForCurrency(db: any, hotelId: number | string, currency: string): Promise<void> {
  if (currency === 'USD') {
    await db.prepare('UPDATE plans SET price_local = price_usd WHERE hotel_id = ?').bind(Number(hotelId)).run();
    return;
  }
  const { getExchangeRates } = await import('./tools');
  const rates = await getExchangeRates(db);
  const rate = Number(rates?.[currency]);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`No exchange rate available for ${currency}`);
  const plans: any = await db.prepare('SELECT id, price_usd FROM plans WHERE hotel_id = ?').bind(Number(hotelId)).all();
  for (const p of plans?.results || []) {
    const local = roundForCurrency(Number(p.price_usd || 0) * rate, currency);
    await db.prepare('UPDATE plans SET price_local = ? WHERE id = ?').bind(local, p.id).run();
  }
}

// Single source of truth for what a listed-hotel booking costs in USD.
// Non-USD hotels: price_local × payment-time rate (daily-cached) → USD base;
// USD hotels: price_usd as-is. Fee formula must stay identical everywhere.
// Returns the fx snapshot (local currency / local total / rate) for storage.
export type OptionSelection = { id: number | string; quantity?: number };

export type PricedOption = {
  option_id: number;
  name: string;
  pricing_type: string;
  unit_price_local: number;
  unit_price_usd: number;
  child_unit_price_local: number | null;
  child_unit_price_usd: number | null;
  infant_unit_price_local: number | null;
  infant_unit_price_usd: number | null;
  quantity: number;
  child_quantity: number;
  infant_quantity: number;
  amount_local: number;
  amount_usd: number;
};

// Price the add-ons a guest picked. Quantities are derived from the party size
// rather than trusted from the client: per_room is a flat charge, per_person
// multiplies by the age bands the hotel says the option counts (a day pass may
// count infants, a wine tasting may count adults only), and per_adult_child
// charges each band at its own rate, so an infant can be free by leaving that
// rate at zero.
async function priceSelectedOptions(
  db: any,
  planId: number | string,
  selection: OptionSelection[],
  adults: number,
  children: number,
  infants: number,
  currency: string,
  fxRate: number,
): Promise<{ options: PricedOption[]; optionsUsd: number; optionsLocal: number }> {
  const wanted = new Map<number, number>();
  for (const s of selection || []) {
    const id = Number(s?.id);
    if (!Number.isFinite(id) || id <= 0) {
      // A selection we cannot read is a guest being under-charged, not a
      // detail: the app once sent {option_id} and every add-on silently
      // vanished from the bill. Say so rather than quietly dropping it.
      if (s && Object.keys(s).length) {
        console.warn('[currency] ignoring unreadable option selection', JSON.stringify(s));
      }
      continue;
    }
    const q = Math.max(1, Math.floor(Number(s?.quantity) || 1));
    wanted.set(id, q);
  }
  if (!wanted.size) return { options: [], optionsUsd: 0, optionsLocal: 0 };

  const ids = [...wanted.keys()];
  const rows: any[] = ((await db
    .prepare(
      `SELECT * FROM plan_options
        WHERE plan_id = ? AND is_active = 1 AND id IN (${ids.map(() => '?').join(',')})`
    )
    .bind(planId, ...ids)
    .all()
    .catch(() => null))?.results) || [];

  const partyAdults = Math.max(0, Math.floor(Number(adults) || 0));
  const partyChildren = Math.max(0, Math.floor(Number(children) || 0));
  const partyInfants = Math.max(0, Math.floor(Number(infants) || 0));
  const options: PricedOption[] = [];
  let optionsUsd = 0;
  let optionsLocal = 0;

  for (const row of rows) {
    const unitUsd = Number(row.price_usd || 0);
    const unitLocal = Number(row.price_local ?? unitUsd);
    const childUsd = row.child_price_usd == null ? null : Number(row.child_price_usd);
    const childLocal = row.child_price_local == null ? null : Number(row.child_price_local);
    const infantUsd = row.infant_price_usd == null ? null : Number(row.infant_price_usd);
    const infantLocal = row.infant_price_local == null ? null : Number(row.infant_price_local);
    const type = String(row.pricing_type || 'per_room');

    let qty = 1;
    let childQty = 0;
    let infantQty = 0;
    if (type === 'per_person') {
      // Legacy rows predate the flags; treat a missing value as the old default.
      const cA = row.counts_adults == null ? 1 : Number(row.counts_adults);
      const cC = row.counts_children == null ? 1 : Number(row.counts_children);
      const cI = row.counts_infants == null ? 0 : Number(row.counts_infants);
      qty = (cA ? partyAdults : 0) + (cC ? partyChildren : 0) + (cI ? partyInfants : 0);
      if (qty <= 0) continue;   // nobody in the party is counted — no charge
    } else if (type === 'per_adult_child') {
      qty = partyAdults;
      childQty = partyChildren;
      infantQty = partyInfants;
    } else {
      qty = wanted.get(Number(row.id)) || 1; // per_room — a flat charge, optionally repeated
    }

    const amountUsd = roundForCurrency(
      unitUsd * qty + (childUsd ?? 0) * childQty + (infantUsd ?? 0) * infantQty, 'USD');
    const amountLocal = roundForCurrency(
      unitLocal * qty + (childLocal ?? 0) * childQty + (infantLocal ?? 0) * infantQty, currency);
    if (amountUsd <= 0) continue;

    options.push({
      option_id: Number(row.id),
      name: String(row.name || ''),
      pricing_type: type,
      unit_price_local: unitLocal,
      unit_price_usd: unitUsd,
      child_unit_price_local: childLocal,
      child_unit_price_usd: childUsd,
      infant_unit_price_local: infantLocal,
      infant_unit_price_usd: infantUsd,
      quantity: qty,
      child_quantity: childQty,
      infant_quantity: infantQty,
      amount_local: amountLocal,
      amount_usd: amountUsd,
    });
    optionsUsd += amountUsd;
    optionsLocal += amountLocal;
  }

  return {
    options,
    optionsUsd: Math.round(optionsUsd * 100) / 100,
    optionsLocal: roundForCurrency(optionsLocal, currency),
  };
}

export async function resolveBookingCharge(
  db: any,
  planId: number | string,
  extras?: { options?: OptionSelection[]; adults?: number; children?: number; infants?: number },
): Promise<null | {
  plan: any;
  currency: string;
  baseUsd: number;
  optionsUsd: number;
  optionsLocal: number;
  options: PricedOption[];
  processingFee: number;
  serviceFee: number;
  totalAmount: number;
  fxRate: number;
  localTotal: number;
}> {
  const plan: any = await db.prepare(
    'SELECT p.id, p.hotel_id, p.name, p.price_usd, p.price_local, h.currency FROM plans p JOIN hotels h ON h.id = p.hotel_id WHERE p.id = ?'
  ).bind(planId).first();
  if (!plan) return null;

  const currency = String(plan.currency || 'USD').toUpperCase();
  let baseUsd = Number(plan.price_usd || 0);
  let fxRate = 1;
  if (currency !== 'USD' && plan.price_local != null) {
    const { getExchangeRates } = await import('./tools');
    const rates = await getExchangeRates(db);
    const fresh = convertLocalToUsd(Number(plan.price_local), currency, rates);
    if (fresh != null) {
      baseUsd = fresh;
      fxRate = Number(rates[currency]);
    }
  }

  // Paid add-ons are charged on top of the room and go through the same fee
  // formula, so the guest pays for them in the one PayPal capture.
  const { options, optionsUsd, optionsLocal } = await priceSelectedOptions(
    db,
    planId,
    extras?.options || [],
    extras?.adults ?? 1,
    extras?.children ?? 0,
    extras?.infants ?? 0,
    currency,
    fxRate,
  );
  const chargeableUsd = Math.round((baseUsd + optionsUsd) * 100) / 100;

  // Fee formula shared by create/capture/booking pages — keep in sync everywhere.
  const processingFee = Math.round(chargeableUsd * 0.06 * 100) / 100;
  const serviceFeeBase = Math.round(chargeableUsd * 0.10 * 100) / 100;
  const serviceFee = serviceFeeBase < 10 ? Math.round((10 - serviceFeeBase) * 100) / 100 : 0;
  const totalAmount = Math.round((chargeableUsd + processingFee + serviceFee) * 100) / 100;
  const localTotal = currency === 'USD' ? totalAmount : roundForCurrency(totalAmount * fxRate, currency);

  return {
    plan, currency, baseUsd, optionsUsd, optionsLocal, options,
    processingFee, serviceFee, totalAmount, fxRate, localTotal,
  };
}

// Resolve the two price columns from a single amount entered in the hotel's
// currency. Hotels use exactly one currency: non-USD hotels enter local prices
// (price_usd becomes a derived cache); USD hotels enter USD (both columns equal).
export async function resolvePlanPriceFields(
  db: any,
  hotelId: number | string,
  inputAmount: unknown,
): Promise<{ currency: string; price_local: number; price_usd: number }> {
  const amount = Number(inputAmount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid price amount');

  const hotel: any = await db.prepare('SELECT currency FROM hotels WHERE id = ?').bind(Number(hotelId)).first();
  const currency = String(hotel?.currency || 'USD').toUpperCase();

  const price_local = roundForCurrency(amount, currency);
  if (currency === 'USD') return { currency, price_local, price_usd: price_local };

  const { getExchangeRates } = await import('./tools');
  const rates = await getExchangeRates(db);
  const price_usd = convertLocalToUsd(price_local, currency, rates);
  if (price_usd == null) throw new Error(`No exchange rate available for ${currency}`);
  return { currency, price_local, price_usd };
}
