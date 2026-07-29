// Japanese display names for countries and major cities.
// Lookup is case-insensitive and falls back to the original string, so
// unmapped or messy DB values simply render as-is.

const GEO_JA: Record<string, string> = {
  // Countries
  'japan': '日本', 'thailand': 'タイ', 'malaysia': 'マレーシア', 'indonesia': 'インドネシア',
  'vietnam': 'ベトナム', 'philippines': 'フィリピン', 'laos': 'ラオス', 'cambodia': 'カンボジア',
  'singapore': 'シンガポール', 'brunei': 'ブルネイ', 'sri lanka': 'スリランカ', 'india': 'インド',
  'pakistan': 'パキスタン', 'bhutan': 'ブータン', 'mongolia': 'モンゴル', 'hong kong': '香港',
  'uae': 'アラブ首長国連邦', 'united arab emirates': 'アラブ首長国連邦', 'qatar': 'カタール',
  'bahrain': 'バーレーン', 'kingdom of bahrain': 'バーレーン', 'oman': 'オマーン', 'israel': 'イスラエル',
  'egypt': 'エジプト', 'kenya': 'ケニア', 'nigeria': 'ナイジェリア', 'tanzania': 'タンザニア',
  'rwanda': 'ルワンダ', 'zambia': 'ザンビア', 'south africa': '南アフリカ', 'cameroon': 'カメルーン',
  'south sudan': '南スーダン', 'são tomé and príncipe': 'サントメ・プリンシペ',
  'georgia': 'ジョージア', 'armenia': 'アルメニア', 'kazakhstan': 'カザフスタン',
  'uzbekistan': 'ウズベキスタン', 'russia': 'ロシア', 'turkey': 'トルコ',
  'uk': 'イギリス', 'ireland': 'アイルランド', 'france': 'フランス', 'germany': 'ドイツ',
  'netherlands': 'オランダ', 'spain': 'スペイン', 'portugal': 'ポルトガル', 'italy': 'イタリア',
  'greece': 'ギリシャ', 'hungary': 'ハンガリー', 'magyarország': 'ハンガリー',
  'czech republic': 'チェコ', 'serbia': 'セルビア', 'bulgaria': 'ブルガリア',
  'lithuania': 'リトアニア', 'finland': 'フィンランド', 'iceland': 'アイスランド',
  'usa': 'アメリカ', 'canada': 'カナダ', 'mexico': 'メキシコ', 'colombia': 'コロンビア',
  'peru': 'ペルー', 'ecuador': 'エクアドル', 'australia': 'オーストラリア', 'new zealand': 'ニュージーランド',

  // Cities
  'tokyo': '東京', 'kyoto': '京都', 'naha': '那覇', 'shibuya': '渋谷', 'shibuya-ku': '渋谷区',
  'bangkok': 'バンコク', 'phuket': 'プーケット', 'koh samui': 'サムイ島', 'nonthaburi': 'ノンタブリー',
  'sukhumvit': 'スクンビット', 'sathon': 'サトーン', 'bang rak': 'バーンラック', 'lat krabang': 'ラートクラバン',
  'kuala lumpur': 'クアラルンプール', 'petaling jaya': 'ペタリンジャヤ', 'kajang': 'カジャン',
  'kota kinabulu': 'コタキナバル', 'bayan lepas': 'バヤンレパス',
  'bali': 'バリ', 'denpasar': 'デンパサール', 'ubud': 'ウブド', 'seminyak': 'スミニャック',
  'jakarta': 'ジャカルタ', 'lombok': 'ロンボク', 'batam': 'バタム', 'manado': 'マナド',
  'padang': 'パダン', 'lovina': 'ロビナ', 'candidasa': 'チャンディダサ',
  'ho chi minh city': 'ホーチミン', 'hanoi': 'ハノイ', 'da nang': 'ダナン',
  'manila': 'マニラ', 'makati': 'マカティ', 'cebu': 'セブ', 'cebu city': 'セブシティ',
  'lapulapu': 'ラプラプ', 'liloan': 'リロアン', 'danao city': 'ダナオシティ',
  'vientiane': 'ビエンチャン', 'luang prabang': 'ルアンパバーン', 'luang': 'ルアン',
  'siem reap': 'シェムリアップ', 'colombo': 'コロンボ', 'bandar seri begawan': 'バンダルスリブガワン',
  'new delhi': 'ニューデリー', 'agra': 'アグラ', 'thiruvananthapuram': 'ティルヴァナンタプラム',
  'islamabad': 'イスラマバード', 'lahore': 'ラホール', 'thimphu': 'ティンプー',
  'ulaanbaatar': 'ウランバートル', 'hong kong island': '香港島', 'yau tsim mong district': '油尖旺区',
  'dubai': 'ドバイ', 'sharjah': 'シャルジャ', 'ras al khaimah': 'ラスアルハイマ',
  'doha': 'ドーハ', 'mesaieed': 'メサイード', 'manama': 'マナーマ', 'muharraq': 'ムハッラク',
  'salalah': 'サラーラ', 'tel aviv': 'テルアビブ',
  'cairo': 'カイロ', 'giza': 'ギザ', 'nairobi': 'ナイロビ', 'kiambu': 'キアンブ',
  'abuja': 'アブジャ', 'kano': 'カノ', 'dodoma': 'ドドマ', 'kigali': 'キガリ',
  'lusaka': 'ルサカ', 'cape town': 'ケープタウン', 'douala': 'ドゥアラ', 'juba': 'ジュバ',
  'são tomé': 'サントメ',
  'tbilisi': 'トビリシ', 'batumi': 'バツミ', 'yerevan': 'エレバン', 'goris': 'ゴリス',
  'almaty': 'アルマトイ', 'tashkent': 'タシケント', 'samarkand': 'サマルカンド',
  'saint petersburg': 'サンクトペテルブルク',
  'london': 'ロンドン', 'birmingham': 'バーミンガム', 'essex': 'エセックス', 'dublin': 'ダブリン',
  'paris': 'パリ', 'toulouse': 'トゥールーズ', 'cologne': 'ケルン', 'erfurt': 'エアフルト',
  'amsterdam': 'アムステルダム', 'rijswijk': 'ライスウェイク', 'voorburg': 'フォールブルフ',
  'valencia': 'バレンシア', 'alicante': 'アリカンテ', 'lisbon': 'リスボン', 'porto': 'ポルト',
  'faro': 'ファロ', 'milan': 'ミラノ', 'venice': 'ヴェネツィア', 'athens': 'アテネ',
  'budapest': 'ブダペスト', 'prague': 'プラハ', 'belgrade': 'ベオグラード', 'sofia': 'ソフィア',
  'vilnius': 'ヴィリニュス', 'oulu': 'オウル', 'reykjavík': 'レイキャビク',
  'california city': 'カリフォルニアシティ', 'seal beach': 'シールビーチ',
  'toronto': 'トロント', 'calgary': 'カルガリー', 'ontario': 'オンタリオ',
  'tijuana': 'ティフアナ', 'oaxaca city': 'オアハカ', 'bogotá': 'ボゴタ', 'arequipa': 'アレキパ',
  'quito': 'キト', 'pichincha': 'ピチンチャ',
  'sydney': 'シドニー', 'perth': 'パース', 'broome': 'ブルーム', 'loganholme': 'ローガンホルム',
  'tweed heads': 'ツイードヘッズ', 'auckland': 'オークランド', 'auckland central': 'オークランド中心部',
  'christchurch': 'クライストチャーチ',
};

export function geoNameJa(name: unknown): string {
  const s = String(name ?? '').trim();
  if (!s) return s;
  return GEO_JA[s.toLowerCase()] || s;
}

// Reverse index: Japanese / katakana place name → canonical English name.
// Lets ja-page users type "バンコク" / "東京" and still hit the English city
// values stored in the DB. Unknown inputs fall back to the original string.
const GEO_EN: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [en, ja] of Object.entries(GEO_JA)) {
    // First English spelling wins (keeps canonical casing, e.g. 'Bangkok').
    if (!(ja in m)) m[ja] = en.charAt(0).toUpperCase() + en.slice(1);
  }
  return m;
})();

export function geoNameEn(name: unknown): string {
  const s = String(name ?? '').trim();
  if (!s) return s;
  return GEO_EN[s] || s;
}
