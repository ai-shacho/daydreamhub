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

// "EGP 2,500 (≈ $52)" for non-USD hotels; plain "$52" for USD hotels.
export function formatDualPrice(localAmount: number, currency: string, rates: Record<string, number>): string {
  if (!currency || currency === 'USD') return formatMoney(localAmount, 'USD');
  const usd = convertLocalToUsd(localAmount, currency, rates);
  const local = formatMoney(localAmount, currency);
  return usd == null ? local : `${local} (≈ ${formatMoney(usd, 'USD')})`;
}

// Curated choices for hotel pricing-currency selectors (owner/admin UIs).
export const CURRENCY_CHOICES = [
  'USD', 'EUR', 'GBP', 'JPY', 'GEL', 'EGP', 'AED', 'TRY', 'MAD', 'KES',
  'NGN', 'ZAR', 'THB', 'PHP', 'IDR', 'INR', 'VND', 'MXN', 'CAD', 'AUD',
  'SGD', 'HKD', 'KRW', 'CNY', 'AMD', 'AZN', 'RSD', 'UZS',
];

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
export async function resolveBookingCharge(db: any, planId: number | string): Promise<null | {
  plan: any;
  currency: string;
  baseUsd: number;
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

  // Fee formula shared by create/capture/booking pages — keep in sync everywhere.
  const processingFee = Math.round(baseUsd * 0.06 * 100) / 100;
  const serviceFeeBase = Math.round(baseUsd * 0.10 * 100) / 100;
  const serviceFee = serviceFeeBase < 10 ? Math.round((10 - serviceFeeBase) * 100) / 100 : 0;
  const totalAmount = Math.round((baseUsd + processingFee + serviceFee) * 100) / 100;
  const localTotal = currency === 'USD' ? totalAmount : roundForCurrency(totalAmount * fxRate, currency);

  return { plan, currency, baseUsd, processingFee, serviceFee, totalAmount, fxRate, localTotal };
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
