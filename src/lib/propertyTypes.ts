/**
 * 施設タイプの単一ソース定義 (Task #48)
 * DB保存値は全て小文字スネークケースで統一。
 * 旧値（ハイフン形式等）はラベルマップにエイリアスとして残す。
 */

export const PROPERTY_TYPES = [
  'hotel',
  'villa',
  'resort',
  'apartment',
  'hostel',
  'guest_house',
  'capsule_hotel',
  'boutique_hotel',
  'ryokan',
  'bnb',
  'cottage',
  'clinic',
  'spa',
  'nail_salon',
  'wellness',
  'sauna',
  'coworking',
  'coworking_space',
  'cafe',
  'day_pass',
  'entire_home',
  'private_room',
  'shared_room',
] as const;

export type PropertyType = typeof PROPERTY_TYPES[number];

/** DB値が許可リストに含まれるか検証。大文字小文字・ハイフン→アンダースコア変換も許容。 */
export function isValidPropertyType(value: string): boolean {
  const normalized = value.toLowerCase().replace(/-/g, '_');
  return (PROPERTY_TYPES as readonly string[]).includes(normalized);
}

/** DB値の正規化（ハイフン→アンダースコア、小文字化） */
export function normalizePropertyType(value: string): string {
  return value.toLowerCase().replace(/-/g, '_').trim();
}

/** 英日表示ラベルマップ。旧DB値のエイリアスも含む。 */
export const PROPERTY_TYPE_LABELS: Record<string, { en: string; ja: string }> = {
  hotel:           { en: 'Hotel',           ja: 'ホテル' },
  villa:           { en: 'Villa',           ja: 'ヴィラ' },
  resort:          { en: 'Resort',          ja: 'リゾート' },
  apartment:       { en: 'Apartment',       ja: 'アパートメント' },
  hostel:          { en: 'Hostel',          ja: 'ホステル' },
  guest_house:     { en: 'Guest House',     ja: 'ゲストハウス' },
  capsule_hotel:   { en: 'Capsule Hotel',   ja: 'カプセルホテル' },
  boutique_hotel:  { en: 'Boutique Hotel',  ja: 'ブティックホテル' },
  ryokan:          { en: 'Ryokan',          ja: '旅館' },
  bnb:             { en: 'B&B',             ja: 'B&B' },
  cottage:         { en: 'Cottage',         ja: 'コテージ' },
  clinic:          { en: 'Clinic',          ja: 'クリニック' },
  spa:             { en: 'Spa',             ja: 'スパ' },
  nail_salon:      { en: 'Nail Salon',      ja: 'ネイルサロン' },
  wellness:        { en: 'Wellness',        ja: 'ウェルネス' },
  sauna:           { en: 'Sauna',           ja: 'サウナ' },
  coworking:       { en: 'Coworking',       ja: 'コワーキング' },
  coworking_space: { en: 'Coworking Space', ja: 'コワーキングスペース' },
  cafe:            { en: 'Cafe & Lounge',   ja: 'カフェ & ラウンジ' },
  day_pass:        { en: 'Day Pass',        ja: 'デイパス' },
  entire_home:     { en: 'Entire Home',     ja: '一軒家' },
  private_room:    { en: 'Private Room',    ja: 'プライベートルーム' },
  shared_room:     { en: 'Shared Room',     ja: 'シェアルーム' },
  // ── 旧DB値のエイリアス（ハイフン形式）────────────────────────
  'guest-house':   { en: 'Guest House',     ja: 'ゲストハウス' },
  'capsule-hotel': { en: 'Capsule Hotel',   ja: 'カプセルホテル' },
};

/** ロケール対応の表示ラベルを返す。未知の値はそのまま返す。 */
export function getPropertyTypeLabel(value: string, locale: 'en' | 'ja' = 'en'): string {
  const normalized = normalizePropertyType(value);
  return PROPERTY_TYPE_LABELS[normalized]?.[locale]
    ?? PROPERTY_TYPE_LABELS[value]?.[locale]
    ?? value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
