const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** 任意の日時文字列を "2026-Jan-26" 形式に変換する。無効値は "-" を返す。 */
export function formatDisplayDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  // D1 の datetime('now') は "2026-01-26 09:00:00" 形式（Tなし・タイムゾーンなし）
  // ISO文字列 "2026-01-26T09:00:00Z" にも対応
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return '-';
  const year = d.getUTCFullYear();
  const month = MONTHS[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** <script> 内で使うインライン版（ブラウザ実行環境用）*/
export const formatDisplayDateJS = `
function formatDisplayDate(dateStr) {
  if (!dateStr) return '-';
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  var d = new Date(normalized);
  if (isNaN(d.getTime())) return '-';
  return d.getUTCFullYear() + '-' + MONTHS[d.getUTCMonth()] + '-' + String(d.getUTCDate()).padStart(2, '0');
}
`;
