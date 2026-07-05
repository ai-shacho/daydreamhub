import type { APIRoute } from 'astro';
import { initiateCall, createCallGroup, initiateNextGroupCall, searchHotelsInternal, searchHotelsExternal, searchHotelsBrave } from '../../../lib/tools';
import { CONCIERGE_SYSTEM_PROMPT_EN, CONCIERGE_SYSTEM_PROMPT_JA } from '../../../lib/claude';
import { filterExternalHotels } from '../../../lib/filterExternalHotels';
import { sendConciergeCallStartedEmail } from '../../../lib/email';

// Shared text sanitizer — strips raw HTML from AI output, converts <a> to Markdown
function stripInternalModelBlocks(text: string): string {
  if (!text) return text;

  // Remove XML-like internal blocks emitted by some model/tooling routes
  text = text.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '');
  text = text.replace(/<function_call>[\s\S]*?<\/function_call>/gi, '');
  text = text.replace(/<tool_use>[\s\S]*?<\/tool_use>/gi, '');
  text = text.replace(/<tool_uses>[\s\S]*?<\/tool_uses>/gi, '');
  text = text.replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, '');
  text = text.replace(/<tool_results>[\s\S]*?<\/tool_results>/gi, '');

  // Also remove common JSON-ish leaked tool invocation payloads
  text = text.replace(/\[?\{[\s\S]*?"tool_name"[\s\S]*?\}\]?/g, '');
  text = text.replace(/\[?\{[\s\S]*?"tool_use_id"[\s\S]*?\}\]?/g, '');

  return text.trim();
}

export function sanitizeAIText(text: string): string {
  if (!text) return text;

  // 0. Catch ALL Markdown links with HTML-like content in the URL part
  text = text.replace(/\[([^\]]+)\]\(([^)]*?(?:<|"|'|\starget=|\sclass=)[^)]*)\)/g, (_, label, dirtyUrl) => {
    const hotelMatch = dirtyUrl.match(/\/hotel\/[\w-]+/);
    if (hotelMatch) return `[${label}](${hotelMatch[0]})`;
    const httpMatch = dirtyUrl.match(/https?:\/\/[^"'<>\s]+/);
    if (httpMatch) return `[${label}](${httpMatch[0]})`;
    const cleanUrl = dirtyUrl.replace(/[<"'].*$/, '').trim();
    return `[${label}](${cleanUrl})`;
  });

  // 0b. Handle [label](<a href="url" ...>) — AI mixing Markdown links with HTML anchors in URL
  text = text.replace(/\[([^\]]+)\]\(<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>\)/gi, (_, label, href) => `[${label}](${href})`);
  text = text.replace(/\[([^\]]+)\]\(<a[^>]*href="([^"]+)"[^>]*>\)/gi, (_, label, href) => `[${label}](${href})`);

  // 0c. Handle bare /hotel/slug" target="_blank" class="...">Label pattern
  // This fires when <a href=" was already stripped but the rest of the attribute string remains
  text = text.replace(/(\/hotel\/[\w-]+)"[^>]*>(.*?)(?=\s*\n|$)/gi, (_, slug, afterText) => {
    const label = afterText.replace(/<[^>]+>/g, '').trim() || 'Book Now';
    return `[${label}](${slug})`;
  });

  // 1. Convert complete <a href="...">label</a> → Markdown [label](href)
  text = text.replace(/<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const cleanLabel = label.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || href;
    return `[${cleanLabel}](${href})`;
  });

  // 1b. Handle unclosed <a href="..."> tags (no </a>)
  text = text.replace(/<a\s[^>]*?href="([^"]*)"[^>]*>/gi, (_, href) => `[リンク](${href})`);

  // 2. Strip orphaned HTML attribute fragments
  text = text.replace(/[^\s"(]*"?\s*target="_blank"[^>]*>(.*?)(?=\n|$)/gi, (_, after) => after.trim());
  text = text.replace(/"?\s*target="_blank"/gi, '');
  text = text.replace(/\s*class="(?:underline|text-amber|hover:|text-teal|font-)[^"]*"/gi, '');
  text = text.replace(/"\s*>/g, ' ');

  // 3. Convert <strong>/<b> → **text**
  text = text.replace(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
  // 4. Convert <em>/<i> → *text*
  text = text.replace(/<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');
  // 5. Convert <br> → newline
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // 6. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // 7. Decode common HTML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  return text.trim();
}

type HotelSearchBundle = {
  city: string;
  hotels: any[];
};
type ActiveCityCache = {
  value: string[];
  expiresAt: number;
};

const ACTIVE_CITY_CACHE_TTL_MS = 10 * 60 * 1000;
let activeCityCache: ActiveCityCache | null = null;

const HOTEL_SEARCH_INTENT_RE = /(hotel|day\s*use|hourly|stay|room|book|booking|availability|vacancy|check[- ]?in|check[- ]?out|price|budget|near|closest|where to stay|おすすめ|ホテル|宿|予約|空き|料金|滞在|デイユース|休憩|チェックイン|チェックアウト)/i;
const CHAT_ONLY_RE = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|lol|haha|good morning|good night|こんにちは|こんばんは|ありがとう|サンキュー|了解|OK|おはよう|おやすみ)[!！。\s]*$/i;

function shouldSkipHeavyHotelSearch(lastUserMsg: string): boolean {
  const normalized = String(lastUserMsg || '').trim();
  if (!normalized) return true;
  if (normalized.length <= 2) return true;
  if (CHAT_ONLY_RE.test(normalized)) return true;
  return !HOTEL_SEARCH_INTENT_RE.test(normalized);
}

async function getActiveCities(db: any): Promise<string[]> {
  const now = Date.now();
  if (activeCityCache && activeCityCache.expiresAt > now) {
    return activeCityCache.value;
  }
  const dbCityRows = await db
    .prepare(`SELECT DISTINCT city FROM hotels WHERE status = 'active' AND city IS NOT NULL AND city != '' ORDER BY city`)
    .all();
  const cities = ((dbCityRows?.results || []) as any[])
    .map((row: any) => String(row.city || '').trim())
    .filter(Boolean);
  activeCityCache = { value: cities, expiresAt: now + ACTIVE_CITY_CACHE_TTL_MS };
  return cities;
}

async function fetchExternalHotelsProgressive(env: any, city: string, locale: string, internalHotels: any[]): Promise<any[]> {
  const primaryQuery = `day use hotel ${city}`;
  const firstBatch = await searchHotelsExternal(env, { query: primaryQuery, location: city, language: locale, maxPages: 1 });
  let externalHotels = filterExternalHotels((firstBatch?.hotels || []) as any[], internalHotels, 3) as any[];

  if (externalHotels.length < 2) {
    const secondBatch = await searchHotelsExternal(env, { query: `hourly hotel ${city}`, location: city, language: locale, maxPages: 1 });
    const merged = [...((firstBatch?.hotels || []) as any[]), ...((secondBatch?.hotels || []) as any[])];
    externalHotels = filterExternalHotels(merged, internalHotels, 3) as any[];
  }

  if (externalHotels.length === 0) {
    externalHotels = filterExternalHotels(await searchHotelsBrave(env, city, locale), internalHotels, 3) as any[];
  }

  return externalHotels;
}

async function buildStructuredHotelResults(
  env: any,
  db: any,
  locale: string,
  lastUserMsg: string
): Promise<HotelSearchBundle> {
  if (!db || !lastUserMsg || lastUserMsg.length < 2) return { city: '', hotels: [] };
  if (shouldSkipHeavyHotelSearch(lastUserMsg)) return { city: '', hotels: [] };

  const MAJOR_CITIES = [
    'tokyo','osaka','kyoto','sapporo','fukuoka','nagoya','hiroshima','kobe','yokohama',
    'bangkok','phuket','chiang mai','pattaya','hua hin','singapore','kuala lumpur','penang',
    'bali','jakarta','manila','cebu','ho chi minh','hanoi','dubai','abu dhabi','doha',
    'london','paris','berlin','madrid','rome','amsterdam','barcelona','vienna','prague',
    'new york','los angeles','san francisco','seattle','toronto','vancouver','seoul','taipei',
    'hong kong','beijing','shanghai','mumbai','delhi','sydney','melbourne','auckland',
    'cairo','casablanca','marrakech','cape town','nairobi','buenos aires','sao paulo',
    'rio de janeiro','santiago','lima','bogota','tbilisi','baku','calgary','giza','nara',
  ];
  const JA_TO_EN_CITIES: Record<string, string> = {
    '東京': 'Tokyo', '大阪': 'Osaka', '京都': 'Kyoto', '札幌': 'Sapporo', '福岡': 'Fukuoka', '名古屋': 'Nagoya',
    'バンコク': 'Bangkok', 'ドバイ': 'Dubai', 'シンガポール': 'Singapore', 'ロンドン': 'London', 'パリ': 'Paris',
    'バリ': 'Bali', 'ジャカルタ': 'Jakarta', 'ソウル': 'Seoul', '台北': 'Taipei', '香港': 'Hong Kong',
    'シドニー': 'Sydney', 'メルボルン': 'Melbourne', 'カイロ': 'Cairo', 'ナイロビ': 'Nairobi',
    'ティビリシ': 'Tbilisi', 'トビリシ': 'Tbilisi', 'バクー': 'Baku', 'カルガリー': 'Calgary', 'ギザ': 'Giza', '奈良': 'Nara',
  };

  const lowerMsg = String(lastUserMsg || '').toLowerCase();
  let city = '';

  for (const [ja, en] of Object.entries(JA_TO_EN_CITIES)) {
    if (lastUserMsg.includes(ja)) {
      city = en;
      break;
    }
  }

  if (!city) {
    try {
      const activeCities = await getActiveCities(db);
      for (const dbCity of activeCities) {
        if (dbCity && lowerMsg.includes(String(dbCity).toLowerCase())) {
          city = dbCity;
          break;
        }
      }
    } catch {}
  }

  if (!city) {
    for (const c of MAJOR_CITIES) {
      if (lowerMsg.includes(c)) {
        city = c;
        break;
      }
    }
  }

  if (!city) {
    const capMatch = lastUserMsg.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\b/);
    if (capMatch) city = capMatch[1];
  }
  if (!city) {
    const jpMatch = lastUserMsg.match(/[\u3040-\u9FFF]{2,8}(?:市|区|町|村|県|都|府|島|港|駅)?/);
    if (jpMatch) city = jpMatch[0];
  }
  if (!city) return { city: '', hotels: [] };

  const wantsClinic = /(clinic|wellness|medical|iv\s*drip|health\s*check|check[- ]?up|クリニック|ウェルネス|医療|健康診断|人間ドック|点滴|検査)/i.test(
    lowerMsg
  );

  let internalHotels: any[] = [];
  let externalHotels: any[] = [];

  try {
    const internal = await searchHotelsInternal(env, { city });
    internalHotels = ((internal?.hotels || []) as any[])
      .filter((h: any) => {
        if (wantsClinic) return true;
        const name = String(h?.name || '').toLowerCase();
        const type = String(h?.property_type || '').toLowerCase();
        return !/(clinic|medical|wellness)/i.test(name) && !/(clinic|medical|wellness)/i.test(type);
      })
      .slice(0, 6);
  } catch {}

  try {
    externalHotels = await fetchExternalHotelsProgressive(env, city, locale, internalHotels);
  } catch {}

  const dedupedInternal = (() => {
    const seen = new Set<string>();
    return internalHotels.filter((h: any) => {
      const key = String(h?.name || '').split('–')[0].split('-')[0].trim().toLowerCase().slice(0, 30);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 3);
  })();

  const structured = [
    ...dedupedInternal.map((h: any) => ({
      id: h.id,
      name: h.name,
      slug: h.slug,
      city: h.city,
      country: h.country,
      source: 'internal',
      min_price: h.plans && h.plans.length > 0
        ? Math.min(...h.plans.map((p: any) => Number(p.price_usd) || 9999))
        : null,
      plans: h.plans || [],
    })),
    ...externalHotels.map((h: any) => ({
      name: h.hotel_name || h.name || '',
      address: h.address || city,
      phone: h.hotel_phone || h.phone || '',
      rating: h.rating || null,
      source: 'external',
    })),
  ];

  return { city, hotels: structured };
}

// Cloudflare Workers AI fallback
async function cfAiChat(env: any, messages: any[], systemPrompt: string): Promise<string> {
  if (!env?.AI) throw new Error('CF AI binding not available');
  const cfMessages = [
    { role: 'system', content: systemPrompt.slice(0, 2000) },
    ...messages.slice(-8).map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 500) })),
  ];
  // リトライ最大3回
  const models = ['@cf/meta/llama-3.1-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.1'];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const model = models[attempt % models.length];
      const response = await env.AI.run(model, { messages: cfMessages, max_tokens: 600 });
      const text = response?.response || response?.result?.response || '';
      if (text.trim()) return text;
    } catch (_e) {
      if (attempt === 2) throw _e;
    }
    // 少し待ってリトライ
    await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
  }
  return 'I apologize, the AI service is temporarily unavailable. Please try again in a moment.';
}

// Primary AI chat provider (Anthropic)
async function anthropicChat(env: any, messages: any[], systemPrompt: string): Promise<string> {
  const apiKey = env?.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: systemPrompt,
      messages: messages.slice(-10),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || 'Sorry, I could not process your request.';
}

// Call Telnyx AI instead of Anthropic
async function telnyxOrchestrate(
  env: any,
  messages: any[],
  locale: string,
  db: any,
  session_id: string
): Promise<{ text: string; messageType: string; metadata?: any }> {
  const apiKey = env?.TELNYX_API_KEY;
  if (!apiKey) throw new Error('TELNYX_API_KEY not set');

  // Task #53-2: locale を堅牢に判定（'ja' / 'ja-JP' は日本語、それ以外は英語フォールバック）
  const isJa = String(locale || '').toLowerCase().startsWith('ja');
  const systemPrompt = isJa ? CONCIERGE_SYSTEM_PROMPT_JA : CONCIERGE_SYSTEM_PROMPT_EN;

  // Try to search hotels if the message seems to need it
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
  // Detect clinic / wellness intent — only then include clinic entries in results
  const recentUserText = messages.filter(m => m.role === 'user').slice(-3).map(m => String(m.content)).join(' ').toLowerCase();
  const wantsClinic = /(clinic|wellness|medical|iv\s*drip|health\s*check|check[- ]?up|クリニック|ウェルネス|医療|健康診断|人間ドック|点滴|検査)/i.test(recentUserText);
  let hotelContext = '';
  // Task #47: structured hotel data — populated below, used to return hotel_results
  let _structInternalHotels: any[] = [];
  let _structExternalHotels: any[] = [];
  if (db && lastUserMsg.length > 3) {
    try {
      // 都市名抽出: DB照合 → 既知リスト → メッセージからの汎用抽出 の順でフォールバック
      const MAJOR_CITIES = [
        'tokyo','osaka','kyoto','sapporo','fukuoka','nagoya','hiroshima','kobe','yokohama',
        'bangkok','phuket','chiang mai','pattaya','hua hin',
        'singapore','kuala lumpur','penang','johor bahru',
        'bali','jakarta','surabaya','yogyakarta',
        'manila','cebu','boracay',
        'ho chi minh','hanoi','da nang','phnom penh','siem reap',
        'dubai','abu dhabi','doha','riyadh','jeddah','kuwait city','manama','muscat',
        'london','paris','berlin','madrid','rome','amsterdam','barcelona','vienna','prague',
        'istanbul','athens','lisbon','stockholm','oslo','copenhagen','zurich','brussels','dublin',
        'milan','munich','frankfurt','hamburg','moscow',
        'new york','los angeles','chicago','houston','phoenix','san francisco','seattle',
        'boston','miami','atlanta','las vegas','denver','dallas','washington dc','nashville',
        'toronto','vancouver','montreal','mexico city','cancun',
        'seoul','busan','taipei','hong kong','macau','beijing','shanghai','shenzhen','guangzhou',
        'mumbai','delhi','bangalore','chennai','kolkata','goa','hyderabad',
        'sydney','melbourne','brisbane','perth','auckland',
        'cairo','casablanca','marrakech','cape town','johannesburg','nairobi',
        'buenos aires','sao paulo','rio de janeiro','santiago','lima','bogota',
        'karachi','lahore','dhaka','kathmandu','colombo',
        'beirut','amman','tel aviv','jerusalem',
      ];
      // 日本語→英語の都市名マッピング
      const JA_TO_EN_CITIES: Record<string, string> = {
        'バリ': 'Bali', 'ジャカルタ': 'Jakarta', 'スラバヤ': 'Surabaya', 'ジョグジャカルタ': 'Yogyakarta',
        'バンコク': 'Bangkok', 'プーケット': 'Phuket', 'チェンマイ': 'Chiang Mai', 'パタヤ': 'Pattaya', 'ホアヒン': 'Hua Hin',
        'シンガポール': 'Singapore', 'クアラルンプール': 'Kuala Lumpur', 'ペナン': 'Penang',
        'マニラ': 'Manila', 'セブ': 'Cebu', 'ボラカイ': 'Boracay',
        'ホーチミン': 'Ho Chi Minh', 'ハノイ': 'Hanoi', 'ダナン': 'Da Nang',
        'プノンペン': 'Phnom Penh', 'シェムリアップ': 'Siem Reap',
        'ドバイ': 'Dubai', 'アブダビ': 'Abu Dhabi', 'ドーハ': 'Doha', 'リヤド': 'Riyadh',
        'ロンドン': 'London', 'パリ': 'Paris', 'ベルリン': 'Berlin', 'マドリード': 'Madrid',
        'ローマ': 'Rome', 'アムステルダム': 'Amsterdam', 'バルセロナ': 'Barcelona',
        'ウィーン': 'Vienna', 'プラハ': 'Prague', 'イスタンブール': 'Istanbul',
        'アテネ': 'Athens', 'リスボン': 'Lisbon', 'ストックホルム': 'Stockholm',
        'コペンハーゲン': 'Copenhagen', 'チューリッヒ': 'Zurich', 'ブリュッセル': 'Brussels',
        'ダブリン': 'Dublin', 'ミラノ': 'Milan', 'ミュンヘン': 'Munich',
        'ニューヨーク': 'New York', 'ロサンゼルス': 'Los Angeles', 'シカゴ': 'Chicago',
        'サンフランシスコ': 'San Francisco', 'シアトル': 'Seattle', 'ボストン': 'Boston',
        'マイアミ': 'Miami', 'ラスベガス': 'Las Vegas', 'ワシントン': 'Washington DC',
        'トロント': 'Toronto', 'バンクーバー': 'Vancouver', 'モントリオール': 'Montreal',
        'メキシコシティ': 'Mexico City', 'カンクン': 'Cancun',
        'ソウル': 'Seoul', 'プサン': 'Busan', '釜山': 'Busan', '台北': 'Taipei',
        '香港': 'Hong Kong', 'マカオ': 'Macau', '北京': 'Beijing', '上海': 'Shanghai',
        'ムンバイ': 'Mumbai', 'デリー': 'Delhi', 'バンガロール': 'Bangalore', 'ゴア': 'Goa',
        'シドニー': 'Sydney', 'メルボルン': 'Melbourne', 'オークランド': 'Auckland',
        'カイロ': 'Cairo', 'カサブランカ': 'Casablanca', 'マラケシュ': 'Marrakech',
        'ケープタウン': 'Cape Town', 'ナイロビ': 'Nairobi',
        '東京': 'Tokyo', '大阪': 'Osaka', '京都': 'Kyoto', '札幌': 'Sapporo',
        '福岡': 'Fukuoka', '名古屋': 'Nagoya', '広島': 'Hiroshima', '神戸': 'Kobe',
        '横浜': 'Yokohama', '奈良': 'Nara', '鎌倉': 'Kamakura', '沖縄': 'Okinawa',
        'ブエノスアイレス': 'Buenos Aires', 'サンパウロ': 'Sao Paulo',
        'リオデジャネイロ': 'Rio de Janeiro', 'サンティアゴ': 'Santiago', 'リマ': 'Lima',
        'ボゴタ': 'Bogota', 'カラチ': 'Karachi', 'ダッカ': 'Dhaka',
        'カトマンズ': 'Kathmandu', 'コロンボ': 'Colombo',
        'ベイルート': 'Beirut', 'テルアビブ': 'Tel Aviv',
        'ティビリシ': 'Tbilisi', 'トビリシ': 'Tbilisi', 'バクー': 'Baku',
        'オウル': 'Oulu', 'ナイアガラ': 'Niagara', 'カルガリー': 'Calgary',
        'ゴリス': 'Goris', 'ギザ': 'Giza', 'エクアドル': 'Ecuador',
      };
      const lowerMsg = lastUserMsg.toLowerCase();
      let city = '';

      // 0. 日本語都市名の変換チェック
      for (const [ja, en] of Object.entries(JA_TO_EN_CITIES)) {
        if (lastUserMsg.includes(ja)) {
          city = en;
          break;
        }
      }

      // 1. DB登録都市と照合（キャッシュ利用）
      if (!city) {
        const activeCities = await getActiveCities(db);
        for (const dbCity of activeCities) {
          if (dbCity && lowerMsg.includes(dbCity.toLowerCase())) {
            city = dbCity; break;
          }
        }
      }

      // 2. メジャー都市リストと照合
      if (!city) {
        for (const c of MAJOR_CITIES) {
          if (lowerMsg.includes(c)) { city = c; break; }
        }
      }

      // 3. 汎用抽出: 大文字始まりの単語/フレーズを都市名候補として使用
      if (!city) {
        // 英語: 大文字始まりの1〜3語を抽出 (例: "Nara" "Salt Lake City" "Santa Fe")
        const capMatch = lastUserMsg.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\b/);
        if (capMatch) city = capMatch[1];
      }
      if (!city) {
        // 日本語: ひらがな/カタカナ/漢字の地名っぽいパターン (例: 奈良、札幌、鎌倉)
        const jpMatch = lastUserMsg.match(/[\u3040-\u9FFF]{2,6}(?:市|区|町|村|県|都|府|島|港|駅)?/);
        if (jpMatch) city = jpMatch[0];
      }
      if (!city) {
        // どうしても取れない場合はメッセージ全体をクエリとして使用
        city = lastUserMsg.slice(0, 50);
      }

      if (city) {
        const cityLower = city.toLowerCase();
        const clinicFilter = wantsClinic
          ? ''
          : ` AND LOWER(h.property_type) NOT LIKE '%clinic%' AND LOWER(h.name) NOT LIKE '%clinic%'`;
        const hotels = await db.prepare(
          `SELECT h.id, h.name, h.slug, h.city, h.country, h.property_type, h.rating,
                  p.id as plan_id, p.name as plan_name,
                  p.price_usd, p.check_in_time, p.check_out_time, p.max_guests
           FROM hotels h LEFT JOIN plans p ON p.hotel_id = h.id AND p.is_active = 1
           WHERE h.status = 'active'
           AND (LOWER(h.city) LIKE ? OR LOWER(h.country) LIKE ?
             OR LOWER(h.city) LIKE ? OR LOWER(h.country) LIKE ?)
           ORDER BY
             CASE WHEN LOWER(h.property_type) LIKE '%clinic%' OR LOWER(h.name) LIKE '%clinic%' THEN 1 ELSE 0 END ASC,
             h.rating DESC, p.price_usd ASC
           LIMIT 50`
        ).bind(`%${cityLower}%`, `%${cityLower}%`, `${cityLower}%`, `${cityLower}%`).all();
        const rawRows = hotels?.results || [];

        // ホテルごとにプランをまとめる
        const hotelMap = new Map<number, any>();
        for (const row of rawRows) {
          if (!hotelMap.has(row.id)) {
            hotelMap.set(row.id, {
              id: row.id, name: row.name, slug: row.slug,
              city: row.city, country: row.country,
              property_type: row.property_type, rating: row.rating,
              plans: []
            });
          }
          if (row.plan_id) {
            hotelMap.get(row.id).plans.push({
              name: row.plan_name,
              price_usd: row.price_usd,
              check_in_time: row.check_in_time,
              check_out_time: row.check_out_time,
              max_guests: row.max_guests
            });
          }
        }

        // 同じ親ホテルから1件のみ表示（最大3件）
        const seenBase = new Set<string>();
        const results = Array.from(hotelMap.values()).filter((h: any) => {
          const base = h.name.split('–')[0].split('-')[0].trim().toLowerCase().slice(0, 30);
          if (seenBase.has(base)) return false;
          seenBase.add(base);
          return true;
        }).slice(0, 3);

        // Task #47: save internal hotels for structured response
        _structInternalHotels = results;

        // 自社ホテルを先に表示
        if (results.length > 0) {
          hotelContext = `\n\n## DDH REGISTERED HOTELS (Free direct booking - no service fee):\n` +
            results.map((h: any) => {
              const minPrice = h.plans.length > 0 ? Math.min(...h.plans.map((p: any) => p.price_usd || 9999)) : null;
              const planLines = h.plans.length > 0
                ? h.plans.map((p: any) =>
                    `  * ${p.name || 'Plan'}: $${p.price_usd ?? '?'} | ${p.check_in_time ?? '?'}–${p.check_out_time ?? '?'} | max ${p.max_guests ?? '?'} guests`
                  ).join('\n')
                : '  * (No plans available)';
              return `- ${h.name} (${h.city}, ${h.country}) - From $${minPrice ?? '?'} - /hotel/${h.slug} - source:internal\n${planLines}`;
            }).join('\n') +
            `\n\nIMPORTANT: Use ONLY the plan times listed above. NEVER invent or estimate check-in/check-out times. Show these internal hotels FIRST with "Book Now" links. Use relative paths like /hotel/slug (NOT full URLs).`;
        }

        // 自社の有無にかかわらず外部ホテルも検索して追加提案
        try {
          const { searchHotelsExternal, searchHotelsBrave } = await import('../../../lib/tools');
          let extHotels: any[] = [];
          extHotels = await fetchExternalHotelsProgressive(env, city, locale, results);
          // Task #47: save external hotels for structured response
          _structExternalHotels = extHotels;

          if (extHotels.length > 0) {
            const extLines = extHotels.map((h: any) => {
              const name = h.hotel_name || h.name || 'Unknown Hotel';
              const phone = h.hotel_phone || h.phone || '';
              const address = h.address || city;
              const rating = h.rating ? ` | ⭐${h.rating}` : '';
              return `- ${name} | 📍${address}${phone ? ` | 📞${phone}` : ''}${rating} | source:external`;
            }).join('\n');

            if (results.length > 0) {
              // 自社あり＋外部あり: 外部は「追加オプション」として表示
              hotelContext += `\n\n## EXTERNAL HOTELS (AI phone booking - $7 fee — show ALL of these after DDH hotels):\n${extLines}\n\n⚠️ MANDATORY: You MUST list ALL ${extHotels.length} external hotels above verbatim in a separate section titled "More options (AI phone booking, $7)". Do NOT skip or omit any of them. Show name + 📍address + 📞phone for each one.`;
            } else {
              // 自社なし＋外部あり: 外部のみ表示
              hotelContext = `\n\n## EXTERNAL HOTELS (AI phone booking - $7 service fee):\n${extLines}\n\n⚠️ MANDATORY: You MUST list ALL ${extHotels.length} external hotels above verbatim. Do NOT skip any. Show name + 📍address + 📞phone for each. Include the $7 AI phone booking fee note.`;
            }
          } else if (results.length === 0) {
            hotelContext = `\n\nNo hotels found for "${city}". Tell the user DaydreamHub doesn't have partner hotels in ${city} yet, but our AI concierge can search and call local hotels for $7.`;
          }
        } catch (_e) {
          if (results.length === 0) {
            hotelContext = `\n\nNo hotels found for "${city}". Tell the user DaydreamHub doesn't have partner hotels in ${city} yet.`;
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  const langOverride = isJa
    ? `\n\n🔴 言語設定（最高優先）: このセッションは日本語です。必ず日本語で回答してください。\n`
    : `\n\n🔴 LANGUAGE OVERRIDE (HIGHEST PRIORITY): This session is in ENGLISH. You MUST write your entire reply in ENGLISH ONLY. Do NOT use Japanese, Thai, Korean, or any other language. Even if hotel names appear in Japanese, your response sentences must be in English.\n`;

  const systemWithContext = systemPrompt + hotelContext + langOverride +
    `\n\n` +
    `=== ABSOLUTE RULES — VIOLATION IS NOT ALLOWED ===\n` +
    `1. ONLY present hotels listed VERBATIM in the hotel data section above.\n` +
    `2. If hotel data is empty or says "No hotels found" → respond: "Sorry, no hotels were found for that location. / 該当するホテルが見つかりませんでした。"\n` +
    `3. NEVER invent hotel names, addresses, phone numbers, prices, or any URLs. Zero exceptions.\n` +
    `4. BOOKING LINKS — STRICT RULE:\n` +
    `   - source:internal hotels ONLY → use MARKDOWN link format: [Book Now](/hotel/slug) using the exact slug from the data\n` +
    `   - Example: [Book Now](/hotel/example-hotel-slug)\n` +
    `   - source:external hotels → NO booking links whatsoever. Show only the phone number (📞). Never add any URL or link.\n` +
    `   - NEVER generate daydreamhub.com/hotel/... or daydreamhub.com/book/... or any full URL. Use ONLY the exact /hotel/slug from the data.\n` +
    `5. TIME SLOTS — CRITICAL: ONLY use check_in_time and check_out_time from the plan data provided above. NEVER invent, estimate, or assume time slots. If a plan shows "10:00–20:00", write exactly that. Do not write "10:00–18:00" unless that is in the data.\n` +
    `5b. Do NOT output XML function_calls or tool_use tags.\n` +
    `6. For external hotels: show name + 📍address + 📞phone number only. Do NOT add booking links. The "Call to Book (+$7)" button is added automatically by the UI.\n` +
    `6b. EXTERNAL HOTELS MUST ALL APPEAR: If the data includes an "EXTERNAL HOTELS" section, you MUST list every single hotel in it — no exceptions, no summarizing, no skipping. Even if you also show DDH hotels, always add a separate section for external hotels.\n` +
    `7. NEVER output raw HTML tags (no <a>, <b>, <div>, etc.). Use ONLY Markdown: **bold**, [link text](url), - list item. HTML tags will be shown as broken text to the user.\n` +
    `   FORBIDDEN examples (never do this):\n` +
    `     ❌ /hotel/slug" target="_blank" class="underline">Book Now\n` +
    `     ❌ <a href="/hotel/slug" target="_blank">Book Now</a>\n` +
    `     ❌ [Book Now](/hotel/slug" target="_blank" class="underline")\n` +
    `   CORRECT format (always use this):\n` +
    `     ✅ [Book Now](/hotel/slug)\n` +
    (wantsClinic
      ? `8. The user is asking about clinics / wellness. You MAY include clinic entries from the hotel data above.\n`
      : `8. CLINIC EXCLUSION: Do NOT present clinics, medical facilities, or wellness centers as hotels — even if one appears in the data above. Skip any entry whose name or property_type contains "clinic", "medical", or "wellness" unless the user explicitly asked about clinics or wellness services.\n`) +
    `=== END RULES ===`;

  const res = await fetch('https://api.telnyx.com/v2/ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      messages: [
        { role: 'system', content: systemWithContext },
        ...messages.slice(-10),
      ],
      max_tokens: 800,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telnyx AI error: ${res.status} - ${err}`);
  }

  const data: any = await res.json();
  let text = data?.choices?.[0]?.message?.content || 'Sorry, I could not process your request.';

  // Strip internal tool/function-call payloads first
  text = stripInternalModelBlocks(text);
  // Sanitize all remaining HTML using the updated logic
  text = sanitizeAIText(text);
  if (!text) text = 'Let me help you find a day-use hotel. Could you tell me your destination city and preferred date?';

  // Task #47: return structured hotel data so the front-end renders cards without text parsing
  const _allStructured = [
    ..._structInternalHotels.map((h: any) => ({
      id: h.id,
      name: h.name,
      slug: h.slug,
      city: h.city,
      country: h.country,
      source: 'internal',
      min_price: h.plans && h.plans.length > 0
        ? Math.min(...h.plans.map((p: any) => Number(p.price_usd) || 9999))
        : null,
      plans: h.plans,
    })),
    ..._structExternalHotels.map((h: any) => ({
      name: h.hotel_name || h.name || '',
      address: h.address || '',
      phone: h.hotel_phone || h.phone || '',
      rating: h.rating || null,
      source: 'external',
    })),
  ];
  if (_allStructured.length > 0) {
    return { text, messageType: 'hotel_results', metadata: { hotels: _allStructured } };
  }
  return { text, messageType: 'text' };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  if (!db || (!env?.ANTHROPIC_API_KEY && !env?.AI)) {
    return new Response(JSON.stringify({ error: 'Service not available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const {
    session_id,
    message,
    locale = 'en',
    image_key,
    flight_info,
    guest_name,
    guest_email,
    guest_phone,
    guests,
  } = body;
  const detailsPayload =
    body?.details && typeof body.details === 'object' ? body.details : {};
  const effectiveGuestPhone = guest_phone || detailsPayload.guest_phone || detailsPayload.phone;
  const effectiveGuestsRaw = guests ?? detailsPayload.guests;
  const effectiveGuests =
    effectiveGuestsRaw !== undefined && effectiveGuestsRaw !== null && effectiveGuestsRaw !== ''
      ? Number(effectiveGuestsRaw)
      : null;
  if (!message || typeof message !== 'string' || !session_id) {
    return new Response(JSON.stringify({ error: 'message and session_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const trimmedMessage = message.trim().slice(0, 1000);
  if (!trimmedMessage) {
    return new Response(JSON.stringify({ error: 'Empty message' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const isInternalCmd = trimmedMessage.startsWith('__');
    if (!isInternalCmd) {
      const recentCount = await db
        .prepare(
          `SELECT COUNT(*) as cnt FROM concierge_messages
           WHERE session_id = ? AND role = 'user' AND created_at > datetime('now', '-5 minutes')`
        )
        .bind(session_id)
        .first();
      if (recentCount && recentCount.cnt > 30) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment.' }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // __check_call_status:<id>
    const callStatusMatch = trimmedMessage.match(/^__check_call_status:(\d+)$/);
    if (callStatusMatch) {
      const callId = parseInt(callStatusMatch[1], 10);
      const call = await db
        .prepare(
          `SELECT id, hotel_name, status, outcome, ai_summary, price_quoted, availability_info
           FROM concierge_calls WHERE id = ? AND session_id = ?`
        )
        .bind(callId, session_id)
        .first();
      if (!call) {
        return new Response(
          JSON.stringify({
            response: '',
            message_type: 'text',
            metadata: { call_status: 'not_found' },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      const c: any = call;
      let responseText = '';
      let failedCount = 0;
      const isFailed =
        (c.status === 'completed' &&
          (c.outcome === 'unavailable' ||
            c.outcome === 'no_answer' ||
            c.outcome === 'voicemail')) ||
        c.status === 'failed';
      if (isFailed) {
        const failedResult = await db
          .prepare(
            `SELECT COUNT(*) as cnt FROM concierge_calls
             WHERE session_id = ? AND (
               (status = 'completed' AND outcome IN ('unavailable', 'no_answer', 'voicemail'))
               OR status = 'failed'
             )`
          )
          .bind(session_id)
          .first();
        failedCount = failedResult?.cnt || 0;
      }
      if (c.status === 'completed') {
        // ホテルが言ったこと（transcript/ai_summary）をそのまま含める
        const hotelSaid = c.availability_info ? `\n\n📋 **ホテルとの通話内容:**\n${c.availability_info}` : '';
        const priceNote = c.price_quoted ? (locale === 'ja' ? `\n💰 **料金:** ${c.price_quoted}` : `\n💰 **Price:** ${c.price_quoted}`) : '';

        if (c.outcome === 'booked' || c.outcome === 'available') {
          responseText = locale === 'ja'
            ? `✅ **${c.hotel_name}の予約が取れました！**${priceNote}${hotelSaid}`
            : `✅ **Booking confirmed at ${c.hotel_name}!**${priceNote}${hotelSaid}`;
        } else if (c.outcome === 'unavailable') {
          responseText = locale === 'ja'
            ? `❌ **${c.hotel_name}は空きがありません。**${hotelSaid}`
            : `❌ **${c.hotel_name} is not available.**${hotelSaid}`;
        } else if (c.outcome === 'no_answer' || c.outcome === 'voicemail') {
          responseText = locale === 'ja'
            ? `📵 **${c.hotel_name}に繋がりませんでした。**${hotelSaid}`
            : `📵 **Could not reach ${c.hotel_name}.**${hotelSaid}`;
        } else if (c.outcome === 'over_budget') {
          responseText = locale === 'ja'
            ? `💸 **${c.hotel_name}は予算オーバーです。**${priceNote}${hotelSaid}`
            : `💸 **${c.hotel_name} exceeds budget.**${priceNote}${hotelSaid}`;
        } else {
          responseText = locale === 'ja'
            ? `📞 **${c.hotel_name}への電話が完了しました。**${priceNote}${hotelSaid}`
            : `📞 **Call to ${c.hotel_name} completed.**${priceNote}${hotelSaid}`;
        }
      } else if (c.status === 'failed') {
        responseText = locale === 'ja'
          ? `❌ **${c.hotel_name}への電話に失敗しました。**`
          : `❌ **Failed to call ${c.hotel_name}.**`;
      }
      return new Response(
        JSON.stringify({
          response: responseText,
          message_type: 'call_status',
          metadata: {
            call_id: callId,
            call_status: c.status,
            outcome: c.outcome,
            hotel_name: c.hotel_name,
            failed_count: failedCount,
          },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // __confirm_payment:<id>
    const paymentMatch = trimmedMessage.match(/^__confirm_payment:(\d+)$/);
    if (paymentMatch) {
      const callId = parseInt(paymentMatch[1], 10);
      const call = await db
        .prepare(
          `SELECT id, hotel_name, payment_status, request_details FROM concierge_calls WHERE id = ? AND session_id = ?`
        )
        .bind(callId, session_id)
        .first();
      if (!call) {
        return new Response(
          JSON.stringify({ response: 'Call not found', message_type: 'text' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      const c: any = call;
      if (c.payment_status !== 'paid' && c.payment_status !== 'free') {
        return new Response(
          JSON.stringify({ response: 'Payment not confirmed', message_type: 'text' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (guest_name || guest_email || effectiveGuestPhone || effectiveGuests !== null) {
        let requestDetails: any = {};
        try {
          requestDetails = JSON.parse(c.request_details || '{}');
        } catch {}
        if (guest_name) requestDetails.guest_name = guest_name;
        if (effectiveGuestPhone) requestDetails.guest_phone = effectiveGuestPhone;
        if (effectiveGuests !== null && !Number.isNaN(effectiveGuests)) requestDetails.guests = effectiveGuests;
        await db
          .prepare(
            `UPDATE concierge_calls SET guest_name = COALESCE(?, guest_name), guest_email = COALESCE(?, guest_email), request_details = ?, updated_at = datetime('now') WHERE id = ?`
          )
          .bind(guest_name || null, guest_email || null, JSON.stringify(requestDetails), callId)
          .run();
      }
      const result = await initiateCall(env, db, session_id, callId);
      const responseText =
        result.status === 'calling'
          ? locale === 'ja'
            ? `${c.hotel_name}に電話しています...`
            : `Calling ${c.hotel_name}...`
          : locale === 'ja'
            ? `電話の発信に失敗しました: ${result.message}`
            : `Call failed: ${result.message}`;
      return new Response(
        JSON.stringify({
          response: responseText,
          message_type: 'call_status',
          metadata: { call_id: callId, call_status: result.status },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // __create_call_group_direct (フロントエンドの「Call to Book $7」ボタンから直接呼び出し)
    if (trimmedMessage === '__create_call_group_direct') {
      const callGroupData = body._call_group;
      if (!callGroupData?.hotels?.length) {
        return new Response(JSON.stringify({ error: 'hotels required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' }
        });
      }
      // セッション作成（なければ）
      await db.prepare(
        `INSERT INTO concierge_sessions (id, locale, created_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')`
      ).bind(session_id, locale).run();

      const { createCallGroup } = await import('../../../lib/tools');
      const normalizedGuests = Number(callGroupData.guests || guests || 0);
      const _adults = Number(callGroupData.adults || 0) || (normalizedGuests > 0 ? normalizedGuests : 1);
      const _children = Number(callGroupData.children || 0);
      const requestDetails = {
        guest_name: callGroupData.guest_name,
        guest_email: callGroupData.guest_email,
        guest_phone: callGroupData.guest_phone || callGroupData.phone || guest_phone || null,
        // 正準キー（check_in_date / check_in_time / check_out_time / guests）に統一（Task #54）
        check_in_date: callGroupData.check_in_date,
        check_in_time: callGroupData.check_in_time || '10:00',
        check_out_time: callGroupData.check_out_time || '18:00',
        adults: _adults,
        children: _children,
        guests: normalizedGuests > 0 ? normalizedGuests : (_adults + _children),
      };
      const group = await createCallGroup(env, {
        session_id,
        hotels: callGroupData.hotels.slice(0, 3),
        request_details: requestDetails,
      });
      if (!group?.group_id) {
        return new Response(JSON.stringify({ error: 'Failed to create call group' }), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        });
      }
      const allInternal = callGroupData.hotels.every((h: any) => h.hotel_source === 'internal');
      if (allInternal) {
        // 全員自社 → 無料
        return new Response(JSON.stringify({
          response: locale === 'ja' ? '予約代行を開始しました（無料）。' : 'Starting free booking call...',
          message_type: 'call_group_created',
          group_id: group.group_id,
          call_ids: group.call_ids,
          payment_required: false,
          is_free: true,
          amount_usd: 0,
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      // 外部ホテルあり → PayPal決済 (pay.ts の create アクションと同じ処理)
      const { getAccessToken, createOrder } = await import('../../../lib/paypal');
      const mode = 'sandbox';
      const baseUrl = new URL(request.url).origin;
      const returnQuery = new URLSearchParams({
        group_id: String(group.group_id),
        session_id: String(session_id),
        ...(callGroupData.guest_name ? { guest_name: String(callGroupData.guest_name) } : {}),
        ...(callGroupData.guest_email ? { guest_email: String(callGroupData.guest_email) } : {}),
      }).toString();
      const lang = String(locale || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
      const returnPath = lang === 'ja' ? '/ja/concierge/payment/return' : '/concierge/payment/return';
      const cancelPath = lang === 'ja' ? '/ja/concierge/payment/cancel' : '/concierge/payment/cancel';
      const accessToken = await getAccessToken((env.PAYPAL_SANDBOX_CLIENT_ID || env.PAYPAL_CLIENT_ID), (env.PAYPAL_SANDBOX_SECRET || env.PAYPAL_SECRET), mode);
      const paypalOrderId = await createOrder(
        accessToken,
        7,
        mode,
        'DaydreamHub AI Phone Booking Service',
        undefined,
        {
          returnUrl: `${baseUrl}${returnPath}?${returnQuery}`,
          cancelUrl: `${baseUrl}${cancelPath}?${returnQuery}`,
        },
      );
      await db.prepare(
        `UPDATE concierge_call_groups SET paypal_order_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(paypalOrderId, group.group_id).run();
      const paypalBase = mode === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com';
      return new Response(JSON.stringify({
        response: locale === 'ja' ? 'PayPalでお支払い後、AIが電話予約を代行します。' : 'Please complete PayPal payment to proceed with AI phone booking.',
        message_type: 'payment_required',
        group_id: group.group_id,
        payment_required: true,
        is_free: false,
        amount_usd: 7,
        paypal_url: `${paypalBase}/checkoutnow?token=${paypalOrderId}`,
        paypal_order_id: paypalOrderId,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // __create_call_group
    if (trimmedMessage === '__create_call_group') {
      const { hotels, request_details } = body;
      if (!hotels || !Array.isArray(hotels) || hotels.length === 0 || !request_details) {
        return new Response(
          JSON.stringify({ error: 'hotels array and request_details required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // 正準キー guests を明示的に補完（Task #54）
      if (request_details.guests == null) {
        request_details.guests = (request_details.adults || 1) + (request_details.children || 0);
      }
      await db
        .prepare(
          `INSERT INTO concierge_sessions (id, locale, created_at, updated_at)
           VALUES (?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')`
        )
        .bind(session_id, locale)
        .run();
      const hotelsSlice = hotels.slice(0, 3);
      const result = await createCallGroup(env, {
        session_id,
        hotels: hotelsSlice,
        request_details,
      });
      // 全てDDH登録ホテルなら無料
      const allInternal = hotelsSlice.every((h: any) => h.hotel_source === 'internal');
      return new Response(
        JSON.stringify({
          response: '',
          message_type: 'call_group_created',
          metadata: {
            group_id: result.group_id,
            call_ids: result.call_ids,
            payment_required: !allInternal,
            is_free: allInternal,
            amount_usd: allInternal ? 0 : 7,
            budget_info: result.budget_info,
          },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // __confirm_group_payment:<id>
    const groupPaymentMatch = trimmedMessage.match(/^__confirm_group_payment:(\d+)$/);
    if (groupPaymentMatch) {
      const groupId = parseInt(groupPaymentMatch[1], 10);
      const group = await db
        .prepare(
          'SELECT id, payment_status FROM concierge_call_groups WHERE id = ? AND session_id = ?'
        )
        .bind(groupId, session_id)
        .first();
      if (!group) {
        return new Response(
          JSON.stringify({ response: 'Group not found', message_type: 'text' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      // DDH登録ホテルは無料（payment_status: 'free'）→ 支払い確認不要
      const groupPaymentStatus = (group as any).payment_status;
      if (groupPaymentStatus !== 'paid' && groupPaymentStatus !== 'free') {
        return new Response(
          JSON.stringify({ response: 'Payment not confirmed', message_type: 'text' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (guest_name || guest_email || effectiveGuestPhone || effectiveGuests !== null) {
        await db
          .prepare(
            "UPDATE concierge_call_groups SET guest_name = COALESCE(?, guest_name), guest_email = COALESCE(?, guest_email), updated_at = datetime('now') WHERE id = ?"
          )
          .bind(guest_name || null, guest_email || null, groupId)
          .run();
        const childCalls = await db
          .prepare(
            'SELECT id, request_details FROM concierge_calls WHERE call_group_id = ?'
          )
          .bind(groupId)
          .all();
        for (const row of (childCalls?.results as any[]) || []) {
          let details: any = {};
          try {
            details = JSON.parse(row.request_details || '{}');
          } catch {}
          if (guest_name) details.guest_name = guest_name;
          if (effectiveGuestPhone) details.guest_phone = effectiveGuestPhone;
          if (effectiveGuests !== null && !Number.isNaN(effectiveGuests)) details.guests = effectiveGuests;
          await db
            .prepare(
              "UPDATE concierge_calls SET guest_name = COALESCE(?, guest_name), guest_email = COALESCE(?, guest_email), request_details = ?, updated_at = datetime('now') WHERE id = ?"
            )
            .bind(guest_name || null, guest_email || null, JSON.stringify(details), row.id)
            .run();
        }
      }
      if (groupPaymentStatus === 'paid') {
        // 通常は /api/concierge/pay(capture) で初回発信される。
        // ただし pending のまま取りこぼしたケース向けに、ここでフォールバック再試行する。
        const groupState: any = await db
          .prepare('SELECT status, current_order, total_calls FROM concierge_call_groups WHERE id = ?')
          .bind(groupId)
          .first();

        let fallbackTriggered = false;
        let fallbackResult: any = null;
        if (
          String(groupState?.status || '') === 'pending' &&
          Number(groupState?.current_order || 0) === 0
        ) {
          fallbackTriggered = true;
          fallbackResult = await initiateNextGroupCall(env, db, groupId);
        }

        return new Response(
          JSON.stringify({
            response: '',
            message_type: 'call_group_status',
            metadata: {
              group_id: groupId,
              call_status: fallbackResult?.status || groupState?.status || 'pending',
              current: Number(fallbackResult?.current ?? groupState?.current_order ?? 0),
              total: Number(fallbackResult?.total ?? groupState?.total_calls ?? 0),
              call_id: fallbackResult?.call_id,
              trigger_source: fallbackTriggered ? 'chat_api_fallback_retry' : 'pay_api_only',
              fallback_triggered: fallbackTriggered,
            },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // free グループはここから初回発信
      try {
        const resendKey = env?.RESEND_API_KEY;
        if (resendKey) {
          const groupRow: any = await db.prepare(
            'SELECT guest_name, guest_email FROM concierge_call_groups WHERE id = ?'
          ).bind(groupId).first();
          const callRows = await db.prepare(
            'SELECT hotel_name, request_details FROM concierge_calls WHERE call_group_id = ? ORDER BY call_order ASC'
          ).bind(groupId).all();
          const guestEmail = groupRow?.guest_email;
          if (guestEmail) {
            const hotelNames: string[] = ((callRows?.results as any[]) || []).map((r: any) => r.hotel_name || 'Hotel');
            const firstDetails = (() => { try { return JSON.parse((callRows?.results as any[])?.[0]?.request_details || '{}'); } catch { return {}; } })();
            await sendConciergeCallStartedEmail(resendKey, {
              guestName: groupRow?.guest_name || 'Guest',
              guestEmail,
              hotelNames,
              date: firstDetails.check_in_date,
              checkIn: firstDetails.check_in_time,
              checkOut: firstDetails.check_out_time,
              guests: Number(firstDetails.guests || ((firstDetails.adults || 1) + (firstDetails.children || 0))),
            });
          }
        }
      } catch (e) {
        console.error('[concierge] call started email failed:', e);
      }

      const freeGroupState: any = await db
        .prepare('SELECT status, current_order, total_calls FROM concierge_call_groups WHERE id = ?')
        .bind(groupId)
        .first();

      if (Number(freeGroupState?.current_order || 0) !== 0) {
        return new Response(
          JSON.stringify({
            response: '',
            message_type: 'call_group_status',
            metadata: {
              group_id: groupId,
              call_status: freeGroupState?.status || 'pending',
              current: Number(freeGroupState?.current_order || 0),
              total: Number(freeGroupState?.total_calls || 0),
              trigger_source: 'chat_api_free_only',
              skipped_reason: 'already_started',
            },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      const result = await initiateNextGroupCall(env, db, groupId);
      return new Response(
        JSON.stringify({
          response: '',
          message_type: 'call_group_status',
          metadata: {
            group_id: groupId,
            call_status: result.status,
            current: result.current || 1,
            total: result.total || 3,
            call_id: result.call_id,
            trigger_source: 'chat_api_free_only',
          },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // __approve_over_budget:<id>
    const approveOverBudgetMatch = trimmedMessage.match(/^__approve_over_budget:(\d+)$/);
    if (approveOverBudgetMatch) {
      const callId = parseInt(approveOverBudgetMatch[1], 10);
      const call = await db
        .prepare(
          `SELECT id, call_group_id, request_details, price_quoted
           FROM concierge_calls WHERE id = ? AND session_id = ? AND outcome = 'over_budget'`
        )
        .bind(callId, session_id)
        .first();
      if (!call) {
        return new Response(
          JSON.stringify({
            response:
              locale === 'ja'
                ? '該当するコールが見つかりません。'
                : 'Call not found.',
            message_type: 'text',
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      let details: any = {};
      try {
        details = JSON.parse((call as any).request_details || '{}');
      } catch {}
      details.call_mode = 'callback_confirm';
      details.confirmed_price =
        (call as any).price_quoted || details.max_price || '';
      await db
        .prepare(
          "UPDATE concierge_calls SET status = 'pending', outcome = NULL, request_details = ?, updated_at = datetime('now') WHERE id = ?"
        )
        .bind(JSON.stringify(details), callId)
        .run();
      if ((call as any).call_group_id) {
        await db
          .prepare(
            "UPDATE concierge_call_groups SET status = 'calling', updated_at = datetime('now') WHERE id = ?"
          )
          .bind((call as any).call_group_id)
          .run();
      }
      const result = await initiateCall(env, db, session_id, callId);
      return new Response(
        JSON.stringify({
          response:
            locale === 'ja'
              ? '承認しました。ホテルに再電話して予約を確定します...'
              : 'Approved. Calling the hotel back to confirm booking...',
          message_type: 'call_group_status',
          metadata: {
            group_id: (call as any).call_group_id,
            call_status: result.status,
            call_id: callId,
            approved_over_budget: true,
          },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // __reject_over_budget:<id>
    const rejectOverBudgetMatch = trimmedMessage.match(/^__reject_over_budget:(\d+)$/);
    if (rejectOverBudgetMatch) {
      const callId = parseInt(rejectOverBudgetMatch[1], 10);
      const call = await db
        .prepare(
          `SELECT id, call_group_id
           FROM concierge_calls WHERE id = ? AND session_id = ? AND outcome = 'over_budget'`
        )
        .bind(callId, session_id)
        .first();
      if (!call || !(call as any).call_group_id) {
        return new Response(
          JSON.stringify({
            response:
              locale === 'ja'
                ? '該当するコールが見つかりません。'
                : 'Call not found.',
            message_type: 'text',
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      const result = await initiateNextGroupCall(env, db, (call as any).call_group_id);
      return new Response(
        JSON.stringify({
          response:
            locale === 'ja'
              ? '次のホテルに進みます...'
              : 'Moving to next hotel...',
          message_type: 'call_group_status',
          metadata: {
            group_id: (call as any).call_group_id,
            call_status: result.status,
            current: result.current,
            total: result.total,
            call_id: result.call_id,
            rejected_over_budget: true,
          },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // __check_group_status:<id>
    const groupStatusMatch = trimmedMessage.match(/^__check_group_status:(\d+)$/);
    if (groupStatusMatch) {
      const groupId = parseInt(groupStatusMatch[1], 10);
      const group = await db
        .prepare(
          'SELECT id, status, current_order, total_calls, refund_status, refund_id FROM concierge_call_groups WHERE id = ? AND session_id = ?'
        )
        .bind(groupId, session_id)
        .first();
      if (!group) {
        return new Response(
          JSON.stringify({
            response: '',
            message_type: 'text',
            metadata: { group_status: 'not_found' },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
      const g: any = group;
      const childCalls = await db
        .prepare(
          `SELECT id, hotel_name, call_order, status, outcome, ai_summary, price_quoted, recommendation_reason, confirmation_email_sent
           FROM concierge_calls WHERE call_group_id = ? ORDER BY call_order ASC`
        )
        .bind(groupId)
        .all();
      const calls = ((childCalls?.results as any[]) || []).map((c: any) => ({
        call_id: c.id,
        hotel_name: c.hotel_name,
        call_order: c.call_order,
        status: c.status,
        outcome: c.outcome,
        ai_summary: c.ai_summary,
        price_quoted: c.price_quoted,
        recommendation_reason: c.recommendation_reason,
        confirmation_email_sent: c.confirmation_email_sent,
      }));
      const currentCall = calls.find((c: any) => c.call_order === g.current_order);

      if (currentCall && currentCall.status === 'calling') {
        const callRow = await db
          .prepare('SELECT updated_at FROM concierge_calls WHERE id = ?')
          .bind(currentCall.call_id)
          .first();
        if (callRow) {
          const updatedAt = new Date((callRow as any).updated_at + 'Z').getTime();
          const now = Date.now();
          if (now - updatedAt > 5 * 60 * 1000) {
            await db
              .prepare(
                "UPDATE concierge_calls SET status = 'completed', outcome = 'no_answer', ai_summary = 'Timed out after 5 minutes', updated_at = datetime('now') WHERE id = ?"
              )
              .bind(currentCall.call_id)
              .run();
            const advanceResult = await initiateNextGroupCall(env, db, groupId);
            return new Response(
              JSON.stringify({
                response: '',
                message_type: 'call_group_status',
                metadata: {
                  group_id: groupId,
                  group_status: advanceResult.status,
                  current_order: advanceResult.current || g.current_order + 1,
                  total_calls: g.total_calls,
                  calls,
                  timeout_advanced: true,
                },
              }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          }
        }
      }

      if (g.status === 'over_budget_pending') {
        const groupRow = await db
          .prepare('SELECT updated_at FROM concierge_call_groups WHERE id = ?')
          .bind(groupId)
          .first();
        if (groupRow) {
          const updatedAt = new Date((groupRow as any).updated_at + 'Z').getTime();
          const now = Date.now();
          if (now - updatedAt > 10 * 60 * 1000) {
            const advanceResult = await initiateNextGroupCall(env, db, groupId);
            return new Response(
              JSON.stringify({
                response: '',
                message_type: 'call_group_status',
                metadata: {
                  group_id: groupId,
                  group_status: advanceResult.status,
                  current_order: advanceResult.current || g.current_order + 1,
                  total_calls: g.total_calls,
                  calls,
                  over_budget_timeout: true,
                },
              }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          }
        }
      }

      return new Response(
        JSON.stringify({
          response: '',
          message_type: 'call_group_status',
          metadata: {
            group_id: groupId,
            group_status: g.status,
            current_order: g.current_order,
            total_calls: g.total_calls,
            refund_status: g.refund_status,
            refund_id: g.refund_id,
            calls,
          },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Normal chat message
    await db
      .prepare(
        `INSERT INTO concierge_sessions (id, locale, created_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')`
      )
      .bind(session_id, locale)
      .run();

    const msgType = image_key ? 'image' : 'text';

    await db
      .prepare(
        `INSERT INTO concierge_messages (session_id, role, content, message_type, image_key, created_at)
         VALUES (?, 'user', ?, ?, ?, datetime('now'))`
      )
      .bind(session_id, trimmedMessage, msgType, image_key || null)
      .run();

    const history = await db
      .prepare(
        `SELECT role, content, message_type, metadata
         FROM concierge_messages
         WHERE session_id = ?
         ORDER BY created_at DESC LIMIT 20`
      )
      .bind(session_id)
      .all();
    const recentMessages = ((history?.results as any[]) || []).reverse();

    const claudeMessages: any[] = [];
    for (const msg of recentMessages) {
      const m = msg as any;
      if (m.role === 'user' || m.role === 'assistant') {
        // Sanitize stored messages before passing to AI (removes any historic HTML/class garbage)
        let cleanContent = sanitizeAIText(String(m.content || ''));
        // Extra: remove any Tailwind class patterns that snuck in
        cleanContent = cleanContent.replace(/class="[^"]*(?:underline|amber|teal|hover:)[^"]*"/g, '');
        claudeMessages.push({ role: m.role, content: cleanContent });
      }
    }

    // Telnyx is intentionally disabled for concierge chat.
    // Use Anthropic first, then Cloudflare Workers AI fallback.
    const isJa = String(locale || '').toLowerCase().startsWith('ja');
    const systemPrompt = isJa ? CONCIERGE_SYSTEM_PROMPT_JA : CONCIERGE_SYSTEM_PROMPT_EN;
    const lastMsg = claudeMessages.filter((m: any) => m.role === 'user').pop()?.content || '';
    const searched = await buildStructuredHotelResults(env, db, locale, String(lastMsg));
    const structuredHotels = searched.hotels;
    const conciseGuide = structuredHotels.length > 0
      ? (isJa
          ? `\n\n検索済み都市: ${searched.city}\nホテルカード描画用データは別送されています。本文ではホテル名やリンクを列挙せず、1〜2文の短い案内のみを返してください。`
          : `\n\nSearched city: ${searched.city}\nHotel card data is provided separately. Do NOT enumerate hotel names, links, or prices in text. Return only a short 1-2 sentence guidance line.`)
      : (isJa
          ? `\n\nホテル候補データが空の場合は、短く「該当ホテルが見つからなかったので別エリア提案をする」旨だけ回答してください。`
          : `\n\nIf hotel data is empty, respond briefly that no matching hotels were found and suggest trying a nearby area.`);
    const fullPrompt = systemPrompt + conciseGuide + '\n\nIMPORTANT: Respond in plain text only. No XML, no HTML tags, no function call tags. Use only Markdown.';
    let text: string;
    if (env?.ANTHROPIC_API_KEY) {
      text = await anthropicChat(env, claudeMessages, fullPrompt);
    } else {
      text = await cfAiChat(env, claudeMessages, fullPrompt);
    }
    text = sanitizeAIText(stripInternalModelBlocks(text));
    const result: { text: string; messageType: string; metadata?: any } =
      structuredHotels.length > 0
        ? { text, messageType: 'hotel_results', metadata: { hotels: structuredHotels } }
        : { text, messageType: 'text' };

    if (result.text) {
      await db
        .prepare(
          `INSERT INTO concierge_messages (session_id, role, content, message_type, metadata, created_at)
           VALUES (?, 'assistant', ?, ?, ?, datetime('now'))`
        )
        .bind(
          session_id,
          result.text,
          result.messageType,
          result.metadata ? JSON.stringify(result.metadata) : null
        )
        .run();
    }

    return new Response(
      JSON.stringify({
        response: result.text,
        message_type: result.messageType,
        metadata: result.metadata,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    console.error('Concierge chat error:', e);
    return new Response(
      JSON.stringify({ error: 'Internal server error', detail: e?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
