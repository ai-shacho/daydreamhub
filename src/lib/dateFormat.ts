const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * 任意の日時文字列を "2026-Jan-26"（日本語ロケールでは "2026年1月26日"）に変換する。
 * 月名を綴ることで、08/12 が8月12日か12月8日かで読み違えられるのを防ぐ。
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
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  return d.getUTCFullYear() + '-' + MONTHS[d.getUTCMonth()] + '-' + String(d.getUTCDate()).padStart(2, '0');
}
`;
