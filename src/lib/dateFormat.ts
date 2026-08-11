const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * "12" → "12th". The month is already spelled out, but the ordinal makes it
 * unmistakable which number is the day for readers used to D/M or M/D order.
 */
export function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th';
}

/**
 * 任意の日時文字列を "2026-Jan-26th"（日本語ロケールでは "2026年1月26日"）に変換する。
 * 無効値は "-" を返す。
 *
 * ロケール未指定なら英語表記。管理画面・オーナー画面は英語のままにしたいので、
 * 既定値を変えずに、ゲスト向けの二言語画面だけが locale を渡す。
 */
export function formatDisplayDate(dateStr: string | null | undefined, locale?: string): string {
  if (!dateStr) return '-';
  // D1 の datetime('now') は "2026-01-26 09:00:00" 形式（Tなし・タイムゾーンなし）
  // ISO文字列 "2026-01-26T09:00:00Z" にも対応
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return '-';
  const year = d.getUTCFullYear();
  if (locale === 'ja') return `${year}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  const month = MONTHS[d.getUTCMonth()];
  const dayNum = d.getUTCDate();
  const day = String(dayNum).padStart(2, '0');
  return `${year}-${month}-${day}${ordinalSuffix(dayNum)}`;
}

/** <script> 内で使うインライン版（ブラウザ実行環境用）*/
export const formatDisplayDateJS = `
function formatDisplayDate(dateStr, locale) {
  if (!dateStr) return '-';
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  var d = new Date(normalized);
  if (isNaN(d.getTime())) return '-';
  if (locale === 'ja') return d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日';
  var dayNum = d.getUTCDate();
  var suffix = (dayNum % 100 >= 11 && dayNum % 100 <= 13) ? 'th' : ({1:'st',2:'nd',3:'rd'}[dayNum % 10] || 'th');
  return d.getUTCFullYear() + '-' + MONTHS[d.getUTCMonth()] + '-' + String(dayNum).padStart(2, '0') + suffix;
}
`;
