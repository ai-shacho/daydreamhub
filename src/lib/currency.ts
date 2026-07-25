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
