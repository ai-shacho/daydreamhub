// Languages the concierge can be spoken to in.
//
// The app's chrome stays English/Japanese, but a guest at Suvarnabhumi or
// Incheon should be able to just talk. Each entry carries the BCP-47 tag used
// for speech recognition and synthesis, plus the handful of conversational
// replies — kept as templates rather than machine-translated at runtime so
// answers come back instantly.
//
// {label} place name · {n} result count · {cheap} cheapest-price clause
// {p} price · {b} budget

export interface VoiceLang {
  code: string;
  label: string;      // shown in the picker, in its own script
  speech: string;     // SpeechRecognition / speechSynthesis language tag
  currency?: string;  // ISO code implied by that language's money words
  t: {
    greeting: string;
    found: string;
    cheap: string;
    sorted: string;
    openOnly: string;
    budget: string;
    noHit: string;
    listening: string;
    speaking: string;
    chipMap: string;
    chipCheaper: string;
    chipOpen: string;
  };
}

export const VOICE_LANGS: VoiceLang[] = [
  {
    code: 'ja', label: '日本語', speech: 'ja-JP', currency: 'JPY',
    t: {
      greeting: 'こんにちは！どこで休憩したいですか？',
      found: '{label}の近くで{n}件見つかりました。{cheap}',
      cheap: '最安は${p}〜です。',
      sorted: '料金の安い順に並べ替えました。',
      openOnly: 'いま利用時間内の施設だけに絞りました。',
      budget: '予算${b}以下で絞り込みました（{n}件）。',
      noHit: 'ごめんなさい、見つけられませんでした。都市名や空港名で試してください。',
      listening: '聞き取り中…', speaking: '応答中…',
      chipMap: '🗺 地図で見る', chipCheaper: '💰 安い順', chipOpen: '🟢 利用時間内',
    },
  },
  {
    code: 'en', label: 'English', speech: 'en-US', currency: 'USD',
    t: {
      greeting: 'Hi! Where would you like to rest?',
      found: 'Found {n} places near {label}. {cheap}',
      cheap: 'Cheapest from ${p}. ',
      sorted: 'Sorted by price, cheapest first.',
      openOnly: 'Showing only places usable right now.',
      budget: 'Filtered to under ${b} ({n} places).',
      noHit: "Sorry, I couldn't find that. Try a city or airport name.",
      listening: 'Listening…', speaking: 'Speaking…',
      chipMap: '🗺 Map', chipCheaper: '💰 Cheapest', chipOpen: '🟢 Usable now',
    },
  },
  {
    code: 'zh-CN', label: '简体中文', speech: 'zh-CN', currency: 'CNY',
    t: {
      greeting: '您好！想在哪里休息呢？',
      found: '在{label}附近找到{n}家。{cheap}',
      cheap: '最低${p}起。',
      sorted: '已按价格从低到高排序。',
      openOnly: '只显示现在可入住的酒店。',
      budget: '已筛选${b}以内（{n}家）。',
      noHit: '抱歉，没有找到。请说出城市或机场名称。',
      listening: '聆听中…', speaking: '回答中…',
      chipMap: '🗺 地图', chipCheaper: '💰 最便宜', chipOpen: '🟢 现在可用',
    },
  },
  {
    code: 'zh-TW', label: '繁體中文', speech: 'zh-TW', currency: 'TWD',
    t: {
      greeting: '您好！想在哪裡休息呢？',
      found: '在{label}附近找到{n}家。{cheap}',
      cheap: '最低${p}起。',
      sorted: '已依價格由低到高排序。',
      openOnly: '只顯示現在可入住的飯店。',
      budget: '已篩選${b}以內（{n}家）。',
      noHit: '抱歉，找不到。請說出城市或機場名稱。',
      listening: '聆聽中…', speaking: '回答中…',
      chipMap: '🗺 地圖', chipCheaper: '💰 最便宜', chipOpen: '🟢 現在可用',
    },
  },
  {
    code: 'ko', label: '한국어', speech: 'ko-KR', currency: 'KRW',
    t: {
      greeting: '안녕하세요! 어디에서 쉬고 싶으세요?',
      found: '{label} 근처에서 {n}곳을 찾았습니다. {cheap}',
      cheap: '최저 ${p}부터입니다. ',
      sorted: '가격이 낮은 순으로 정렬했습니다.',
      openOnly: '지금 이용 가능한 곳만 표시합니다.',
      budget: '${b} 이하로 필터링했습니다 ({n}곳).',
      noHit: '죄송합니다, 찾지 못했습니다. 도시나 공항 이름을 말씀해 주세요.',
      listening: '듣고 있어요…', speaking: '답변 중…',
      chipMap: '🗺 지도', chipCheaper: '💰 저렴한 순', chipOpen: '🟢 지금 이용 가능',
    },
  },
  {
    code: 'th', label: 'ไทย', speech: 'th-TH', currency: 'THB',
    t: {
      greeting: 'สวัสดีค่ะ! อยากพักผ่อนที่ไหนดีคะ?',
      found: 'พบ {n} แห่งใกล้ {label} {cheap}',
      cheap: 'เริ่มต้น ${p} ',
      sorted: 'เรียงตามราคาจากถูกไปแพง',
      openOnly: 'แสดงเฉพาะที่ใช้ได้ตอนนี้',
      budget: 'กรองไม่เกิน ${b} ({n} แห่ง)',
      noHit: 'ขออภัย ไม่พบผลลัพธ์ ลองบอกชื่อเมืองหรือสนามบินค่ะ',
      listening: 'กำลังฟัง…', speaking: 'กำลังตอบ…',
      chipMap: '🗺 แผนที่', chipCheaper: '💰 ถูกสุด', chipOpen: '🟢 ใช้ได้ตอนนี้',
    },
  },
  {
    code: 'id', label: 'Bahasa Indonesia', speech: 'id-ID', currency: 'IDR',
    t: {
      greeting: 'Halo! Di mana Anda ingin beristirahat?',
      found: 'Ditemukan {n} tempat dekat {label}. {cheap}',
      cheap: 'Mulai ${p}. ',
      sorted: 'Diurutkan dari harga termurah.',
      openOnly: 'Hanya menampilkan yang bisa dipakai sekarang.',
      budget: 'Difilter di bawah ${b} ({n} tempat).',
      noHit: 'Maaf, tidak ditemukan. Sebutkan nama kota atau bandara.',
      listening: 'Mendengarkan…', speaking: 'Menjawab…',
      chipMap: '🗺 Peta', chipCheaper: '💰 Termurah', chipOpen: '🟢 Bisa sekarang',
    },
  },
  {
    code: 'vi', label: 'Tiếng Việt', speech: 'vi-VN', currency: 'VND',
    t: {
      greeting: 'Xin chào! Bạn muốn nghỉ ở đâu?',
      found: 'Đã tìm thấy {n} chỗ gần {label}. {cheap}',
      cheap: 'Giá từ ${p}. ',
      sorted: 'Đã sắp xếp theo giá từ thấp đến cao.',
      openOnly: 'Chỉ hiện những nơi dùng được ngay bây giờ.',
      budget: 'Đã lọc dưới ${b} ({n} chỗ).',
      noHit: 'Xin lỗi, không tìm thấy. Hãy nói tên thành phố hoặc sân bay.',
      listening: 'Đang nghe…', speaking: 'Đang trả lời…',
      chipMap: '🗺 Bản đồ', chipCheaper: '💰 Rẻ nhất', chipOpen: '🟢 Dùng được ngay',
    },
  },
];

export function voiceLangFor(tag: string | null | undefined): VoiceLang {
  const s = String(tag || '').toLowerCase();
  return (
    VOICE_LANGS.find((l) => l.code.toLowerCase() === s) ||
    VOICE_LANGS.find((l) => s.startsWith(l.code.split('-')[0].toLowerCase())) ||
    VOICE_LANGS[1]
  );
}
