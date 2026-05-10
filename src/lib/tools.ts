const LANGUAGE_MAP: Record<string, { code: string; name: string; nativeName: string; greeting: string; currency: string }> = {
  en: { code: "en", name: "English", nativeName: "English", greeting: "Hi there! This is Sarah from DayDreamHub. Thank you for your time.", currency: "USD" },
  fr: { code: "fr", name: "French", nativeName: "Français", greeting: "Bonjour! Je suis Sarah de DayDreamHub. Merci de prendre mon appel.", currency: "EUR" },
  de: { code: "de", name: "German", nativeName: "Deutsch", greeting: "Guten Tag! Hier ist Sarah von DayDreamHub. Vielen Dank für Ihre Zeit.", currency: "EUR" },
  es: { code: "es", name: "Spanish", nativeName: "Español", greeting: "Buenos días! Soy Sarah de DayDreamHub. Gracias por atender mi llamada.", currency: "EUR" },
  it: { code: "it", name: "Italian", nativeName: "Italiano", greeting: "Buongiorno! Sono Sarah di DayDreamHub. Grazie per il suo tempo.", currency: "EUR" },
  pt: { code: "pt", name: "Portuguese", nativeName: "Português", greeting: "Bom dia! Aqui é a Sarah da DayDreamHub. Obrigada pelo seu tempo.", currency: "EUR" },
  nl: { code: "nl", name: "Dutch", nativeName: "Nederlands", greeting: "Goedendag! Dit is Sarah van DayDreamHub. Bedankt voor uw tijd.", currency: "EUR" },
  th: { code: "th", name: "Thai", nativeName: "ไทย", greeting: "สวัสดีค่ะ ดิฉันซาร่าจาก DayDreamHub ค่ะ ขอบคุณที่รับสาย", currency: "THB" },
  vi: { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", greeting: "Xin chào! Tôi là Sarah từ DayDreamHub. Cảm ơn đã nhận cuộc gọi.", currency: "VND" },
  id: { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", greeting: "Selamat siang! Saya Sarah dari DayDreamHub. Terima kasih atas waktunya.", currency: "IDR" },
  ms: { code: "ms", name: "Malay", nativeName: "Bahasa Melayu", greeting: "Selamat sejahtera! Saya Sarah dari DayDreamHub. Terima kasih kerana sudi menjawab.", currency: "MYR" },
  ko: { code: "ko", name: "Korean", nativeName: "한국어", greeting: "안녕하세요! DayDreamHub의 Sarah입니다. 시간 내주셔서 감사합니다.", currency: "KRW" },
  zh: { code: "zh", name: "Chinese", nativeName: "中文", greeting: "您好！我是DayDreamHub的Sarah。感谢您接听电话。", currency: "CNY" },
  ja: { code: "ja", name: "Japanese", nativeName: "日本語", greeting: "もしもし、DayDreamHubのたいいちと申します。お忙しいところ恐れ入ります。", currency: "JPY" }
};

export function getLanguageConfig(langCode: string) {
  return LANGUAGE_MAP[langCode] || LANGUAGE_MAP["en"];
}

const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  "Japan": "JPY", "Thailand": "THB", "Singapore": "SGD", "South Korea": "KRW",
  "China": "CNY", "Taiwan": "TWD", "Hong Kong": "HKD", "Macau": "MOP",
  "Vietnam": "VND", "Indonesia": "IDR", "Malaysia": "MYR", "Philippines": "PHP",
  "India": "INR", "Sri Lanka": "LKR", "Cambodia": "KHR", "Myanmar": "MMK",
  "Laos": "LAK", "Nepal": "NPR", "Bangladesh": "BDT", "Pakistan": "PKR",
  "United Arab Emirates": "AED", "Saudi Arabia": "SAR", "Qatar": "QAR",
  "Bahrain": "BHD", "Kuwait": "KWD", "Oman": "OMR", "Jordan": "JOD",
  "Israel": "ILS", "Turkey": "TRY",
  "United Kingdom": "GBP", "France": "EUR", "Germany": "EUR", "Italy": "EUR",
  "Spain": "EUR", "Portugal": "EUR", "Netherlands": "EUR", "Belgium": "EUR",
  "Austria": "EUR", "Ireland": "EUR", "Greece": "EUR", "Finland": "EUR",
  "Switzerland": "CHF", "Sweden": "SEK", "Norway": "NOK", "Denmark": "DKK",
  "Poland": "PLN", "Czech Republic": "CZK", "Hungary": "HUF", "Romania": "RON",
  "Croatia": "EUR",
  "Australia": "AUD", "New Zealand": "NZD",
  "United States": "USD", "Canada": "CAD", "Mexico": "MXN", "Brazil": "BRL",
  "Argentina": "ARS", "Chile": "CLP", "Colombia": "COP", "Peru": "PEN",
  "South Africa": "ZAR", "Egypt": "EGP", "Morocco": "MAD", "Kenya": "KES",
  "Nigeria": "NGN", "Russia": "RUB"
};

export const BUDGET_TIER_USD: Record<string, number> = {
  budget: 40, mid: 80, high: 200
};

const FALLBACK_RATES: Record<string, number> = {
  USD: 1, JPY: 150, THB: 35, SGD: 1.35, KRW: 1350, CNY: 7.2, TWD: 32,
  HKD: 7.8, VND: 25000, IDR: 15800, MYR: 4.7, PHP: 56, INR: 83,
  AED: 3.67, SAR: 3.75, GBP: 0.79, EUR: 0.92, CHF: 0.88, AUD: 1.55,
  NZD: 1.68, CAD: 1.36, MXN: 17.2, BRL: 5, TRY: 32, SEK: 10.5,
  NOK: 10.8, DKK: 6.9, PLN: 4, CZK: 23, HUF: 360, ZAR: 18.5,
  EGP: 31, QAR: 3.64, KWD: 0.31, BHD: 0.38
};

const HIGH_DENOMINATION_CURRENCIES = new Set([
  "JPY", "KRW", "IDR", "VND", "CLP", "COP", "HUF", "LKR", "KHR", "LAK", "MMK"
]);

export function getCurrencyForCountry(country: string, addressFallback?: string) {
  if (country) {
    const direct = COUNTRY_CURRENCY_MAP[country];
    if (direct) return direct;
    const lower = country.toLowerCase();
    for (const [k, v] of Object.entries(COUNTRY_CURRENCY_MAP)) {
      if (k.toLowerCase() === lower) return v;
    }
  }
  return "USD";
}

export async function getExchangeRates(db: any) {
  try {
    const cached = await db.prepare("SELECT rates, updated_at FROM exchange_rate_cache WHERE base = 'USD'").first();
    if (cached) {
      const updatedAt = new Date(cached.updated_at + "Z");
      const age = Date.now() - updatedAt.getTime();
      if (age < 24 * 60 * 60 * 1000) {
        return JSON.parse(cached.rates);
      }
    }
  } catch (e) {
    console.error("exchange_rate_cache read error:", e);
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { "User-Agent": "DayDreamHub/1.0" }
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data: any = await res.json();
    if (data.result !== "success" || !data.rates) throw new Error("Invalid response");
    const rates = data.rates;
    try {
      await db.prepare(
        "INSERT OR REPLACE INTO exchange_rate_cache (base, rates, updated_at) VALUES ('USD', ?, datetime('now'))"
      ).bind(JSON.stringify(rates)).run();
    } catch (e) {
      console.error("exchange_rate_cache write error:", e);
    }
    return rates;
  } catch (e) {
    console.error("Exchange rate fetch failed, using fallback:", e);
    return FALLBACK_RATES;
  }
}

export function convertBudgetToLocalCurrency(budgetTier: string, currencyCode: string, rates: Record<string, number>) {
  const usdAmount = BUDGET_TIER_USD[budgetTier] || BUDGET_TIER_USD["mid"];
  const rate = rates[currencyCode] || 1;
  let localAmount = usdAmount * rate;
  if (HIGH_DENOMINATION_CURRENCIES.has(currencyCode)) {
    localAmount = Math.ceil(localAmount / 100) * 100;
  } else {
    localAmount = Math.ceil(localAmount);
  }
  const localFormatted = formatLocalAmount(localAmount, currencyCode);
  return { localAmount, localFormatted, currencyCode };
}

export function formatLocalAmount(amount: number, currencyCode: string) {
  const formatted = amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${formatted} ${currencyCode}`;
}

export function formatPriceWithUSD(localPrice: string, currencyCode: string, rates: Record<string, number>) {
  if (currencyCode === "USD") return localPrice;
  const rate = rates[currencyCode];
  if (!rate || rate === 0) return localPrice;
  const numStr = localPrice.replace(/[^\d.]/g, "");
  const num = parseFloat(numStr);
  if (isNaN(num)) return localPrice;
  const usdAmount = Math.round(num / rate);
  return `${localPrice} (~$${usdAmount} USD)`;
}

function stripDiacritics(str: string) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export async function searchHotelsInternal(env: any, params: any) {
  const db = env.DB;
  const conditions = ["h.status = 'active'"];
  const binds: any[] = [];
  const cityNormalized = stripDiacritics(params.city.toLowerCase());
  const cityLike = `%${cityNormalized}%`;

  const stripAccentsSql = (col: string) =>
    `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${col}), 'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'), 'ñ', 'n')`;

  conditions.push(`(${stripAccentsSql("h.city")} LIKE ? OR ${stripAccentsSql("h.country")} LIKE ?)`);
  binds.push(cityLike, cityLike);

  let query = `
    SELECT h.id, h.name, h.name_ja, h.slug, h.city, h.country, h.address,
           h.thumbnail_url, h.rating, h.phone, h.categories,
           p.id as plan_id, p.name as plan_name, p.name_ja as plan_name_ja,
           p.price_usd, p.check_in_time, p.check_out_time, p.max_guests
    FROM hotels h
    LEFT JOIN plans p ON p.hotel_id = h.id AND p.is_active = 1
    WHERE ${conditions.join(" AND ")}
    ${params.max_price_usd ? "AND (p.price_usd IS NULL OR p.price_usd <= ?)" : ""}
    ORDER BY h.rating DESC, p.price_usd ASC
    LIMIT 15
  `;
  if (params.max_price_usd) binds.push(params.max_price_usd);

  const result = await db.prepare(query).bind(...binds).all();
  const rows = result?.results || [];
  const hotelsMap = new Map();

  for (const row of rows) {
    if (!hotelsMap.has(row.id)) {
      hotelsMap.set(row.id, {
        id: row.id, name: row.name, name_ja: row.name_ja, slug: row.slug,
        city: row.city, country: row.country, address: row.address,
        thumbnail_url: row.thumbnail_url, rating: row.rating, phone: row.phone,
        categories: row.categories, source: "internal", plans: []
      });
    }
    if (row.plan_id) {
      hotelsMap.get(row.id).plans.push({
        id: row.plan_id, name: row.plan_name, name_ja: row.plan_name_ja,
        price_usd: row.price_usd, check_in_time: row.check_in_time,
        check_out_time: row.check_out_time, max_guests: row.max_guests
      });
    }
  }

  const hotels = Array.from(hotelsMap.values()).slice(0, 10);
  return { count: hotels.length, source: "internal", hotels };
}

const DAY_USE_KEYWORDS: Record<string, string[]> = {
  ja: ["デイユース", "日帰り", "休憩"],
  en: ["day use", "hourly", "day stay"],
  th: ["เดย์ยูส", "พักรายชั่วโมง"],
  ko: ["대실", "데이유즈"],
  fr: ["journée", "day use"],
  zh: ["钟点房", "day use"]
};

function enrichQuery(query: string, language?: string) {
  const allKeywords = Object.values(DAY_USE_KEYWORDS).flat();
  const lowerQuery = query.toLowerCase();
  const alreadyHasKeyword = allKeywords.some(kw => lowerQuery.includes(kw.toLowerCase()));
  if (alreadyHasKeyword) return query;
  const lang = language || "en";
  if (lang === "ja") {
    const hasJapanese = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(query);
    if (!hasJapanese) return `${query} day use`;
  }
  const keywords = DAY_USE_KEYWORDS[lang] || DAY_USE_KEYWORDS["en"];
  return `${query} ${keywords[0]}`;
}

const HOTEL_TYPES = ["hotel", "lodging", "motel", "resort_hotel", "extended_stay_hotel"];

export async function searchHotelsExternal(env: any, params: any) {
  const apiKey = env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { count: 0, source: "external", hotels: [], error: "Google Places API key not configured." };
  }

  const fieldMask = [
    "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber",
    "places.internationalPhoneNumber", "places.rating", "places.userRatingCount",
    "places.websiteUri", "places.types", "places.location"
  ].join(",");

  const lang = params.language || "en";
  const enrichedQuery = enrichQuery(params.query, lang);
  // Only bias by region for non-English locales; for English leave unset so international results aren't biased toward US
  const regionMap: Record<string, string> = { ja: "JP", th: "TH", ko: "KR" };
  const regionCode = regionMap[lang] || undefined;

  const baseBody: any = {
    textQuery: enrichedQuery,
    languageCode: lang,
    maxResultCount: 20
  };
  if (regionCode) baseBody.regionCode = regionCode;

  let response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask
    },
    body: JSON.stringify({ ...baseBody, includedType: "lodging" })
  });

  if (!response.ok) {
    response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask
      },
      body: JSON.stringify(baseBody)
    });
  }

  if (!response.ok) {
    const errText = await response.text();
    return { count: 0, source: "external", hotels: [], error: `Places API error ${response.status}` };
  }

  const data: any = await response.json();
  return processPlacesResults(data);
}

function processPlacesResults(data: any) {
  const places = data.places || [];
  const hotels = places
    .filter((p: any) => {
      if (!p.internationalPhoneNumber && !p.nationalPhoneNumber) return false;
      const types = p.types || [];
      const isLodging = types.some((t: string) => HOTEL_TYPES.includes(t));
      return types.length === 0 || isLodging;
    })
    .sort((a: any, b: any) => {
      const ratingDiff = (b.rating || 0) - (a.rating || 0);
      if (ratingDiff !== 0) return ratingDiff;
      return (b.userRatingCount || 0) - (a.userRatingCount || 0);
    })
    .map((p: any) => ({
      name: p.displayName?.text || "",
      address: p.formattedAddress || "",
      phone: p.internationalPhoneNumber || p.nationalPhoneNumber || "",
      rating: p.rating || null,
      rating_count: p.userRatingCount || 0,
      website: p.websiteUri || null,
      source: "external"
    }));
  return { count: hotels.length, source: "external", hotels };
}

// Brave Search でデイユースホテルを検索（Google Places API 未設定時のフォールバック）
export async function searchHotelsBrave(env: any, city: string, language: string = 'en') {
  const apiKey = env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];

  const query = language === 'ja'
    ? `${city} ホテル デイユース 日帰り 電話番号`
    : `day use hotel ${city} hourly booking phone number`;

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&country=ALL`,
      { headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': apiKey } }
    );
    if (!res.ok) return [];
    const data: any = await res.json();
    const results = data?.web?.results || [];
    return results.slice(0, 5).map((r: any) => ({
      hotel_name: r.title?.replace(/\s*[-–|].*$/, '').trim() || r.title,
      address: city,
      hotel_phone: '',
      website: r.url,
      description: r.description || '',
      hotel_source: 'external',
    }));
  } catch {
    return [];
  }
}

export async function createCallGroup(env: any, params: any) {
  const db = env.DB;
  const totalCalls = params.hotels.length;

  // DDH登録ホテル（internal）のみなら無料、外部ホテルが1件でもあれば課金
  const allInternal = params.hotels.every((h: any) => h.hotel_source === 'internal');
  const initialPaymentStatus = allInternal ? 'free' : 'required';

  const groupResult = await db.prepare(
    `INSERT INTO concierge_call_groups
       (session_id, status, current_order, total_calls, payment_status, request_details, created_at, updated_at)
       VALUES (?, 'pending', 0, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(params.session_id, totalCalls, initialPaymentStatus, JSON.stringify(params.request_details)).run();

  const groupId = groupResult.meta.last_row_id;
  const callIds: number[] = [];

  for (let i = 0; i < totalCalls; i++) {
    const hotel = params.hotels[i];
    const perCallDetails = { ...params.request_details, hotel_country: hotel.hotel_country || "" };
    // DDH登録ホテルは個別にもfree、外部は none
    const callPaymentStatus = (hotel.hotel_source === 'internal') ? 'free' : 'none';
    const callResult = await db.prepare(
      `INSERT INTO concierge_calls
         (session_id, hotel_name, hotel_phone, hotel_source, hotel_id, request_details, status, payment_status,
          call_group_id, call_order, recommendation_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, datetime('now'))`
    ).bind(
      params.session_id,
      hotel.hotel_name || '',
      hotel.hotel_phone || '',
      hotel.hotel_source || 'external',
      hotel.hotel_id || null,
      JSON.stringify(perCallDetails),
      callPaymentStatus,
      groupId,
      i + 1,
      hotel.recommendation_reason || null
    ).run();
    callIds.push(callResult.meta.last_row_id);
  }

  let budgetInfo = null;
  if (params.request_details.budget) {
    try {
      const firstCountry = params.hotels[0]?.hotel_country || "";
      const currencyCode = getCurrencyForCountry(firstCountry) || "USD";
      const rates = await getExchangeRates(db);
      const converted = convertBudgetToLocalCurrency(params.request_details.budget, currencyCode, rates);
      budgetInfo = {
        tier: params.request_details.budget,
        local: converted.localFormatted,
        currency: currencyCode,
        usd: BUDGET_TIER_USD[params.request_details.budget] || 80
      };
    } catch (e) {
      console.error("Budget info generation failed:", e);
    }
  }

  return { group_id: groupId, call_ids: callIds, budget_info: budgetInfo };
}

export async function initiateNextGroupCall(env: any, db: any, groupId: number) {
  const group: any = await db.prepare("SELECT id, session_id, current_order, total_calls, status FROM concierge_call_groups WHERE id = ?").bind(groupId).first();
  if (!group) return { error: "Group not found" };
  if (group.status === "success") return { status: "success", message: "Already booked" };

  // ── リトライロジック: 出なかった場合は同じホテルにもう1回 ──
  const currentCall: any = await db.prepare(
    "SELECT id, attempt, max_attempts, hotel_name, hotel_phone, outcome FROM concierge_calls WHERE call_group_id = ? AND call_order = ?"
  ).bind(groupId, group.current_order).first();

  const MAX_ATTEMPTS = 2; // ホテル1件につき最大2回
  const attempt = currentCall?.attempt || 1;
  const isRetryableOutcome = currentCall?.outcome === 'no_answer' || currentCall?.outcome === 'voicemail';

  if (currentCall && isRetryableOutcome && attempt < MAX_ATTEMPTS) {
    // 同じホテルにリトライ（新しいconcierge_callsレコードを追加）
    await db.prepare(
      `INSERT INTO concierge_calls
         (session_id, hotel_name, hotel_phone, hotel_source, request_details, status, payment_status,
          call_group_id, call_order, attempt, max_attempts, guest_name, guest_email, created_at)
         SELECT session_id, hotel_name, hotel_phone, hotel_source, request_details, 'pending', payment_status,
                call_group_id, call_order, ?, ?, guest_name, guest_email, datetime('now')
         FROM concierge_calls WHERE id = ?`
    ).bind(attempt + 1, MAX_ATTEMPTS, currentCall.id).run();
    // INSERTしたばかりの行のIDを取得
    const newRow: any = await db.prepare(
      `SELECT id FROM concierge_calls WHERE call_group_id = ? AND attempt = ? ORDER BY id DESC LIMIT 1`
    ).bind(groupId, attempt + 1).first();
    const retryCallId = newRow?.id;
    if (!retryCallId) {
      console.error(`[retry] Failed to get retry call ID for group ${groupId}`);
      return { status: "retry_failed", group_id: groupId };
    }

    // 少し間隔を置いてリトライ（Workerの制約上5秒以内）
    await new Promise(r => setTimeout(r, 3000));
    const result = await initiateCall(env, db, group.session_id, retryCallId);
    return {
      status: result.status,
      group_id: groupId,
      call_id: retryCallId,
      is_retry: true,
      attempt: attempt + 1,
      hotel_name: currentCall.hotel_name,
      message: `Retrying ${currentCall.hotel_name} (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`
    };
  }

  // ── 次のホテルへ ──
  const nextOrder = group.current_order + 1;
  if (nextOrder > group.total_calls) {
    await db.prepare("UPDATE concierge_call_groups SET status = 'all_failed', updated_at = datetime('now') WHERE id = ?").bind(groupId).run();
    return { status: "all_failed", group_id: groupId };
  }

  const nextCall: any = await db.prepare("SELECT id FROM concierge_calls WHERE call_group_id = ? AND call_order = ?").bind(groupId, nextOrder).first();
  if (!nextCall) {
    await db.prepare("UPDATE concierge_call_groups SET status = 'all_failed', updated_at = datetime('now') WHERE id = ?").bind(groupId).run();
    return { status: "all_failed", group_id: groupId };
  }

  const updateResult = await db.prepare(
    "UPDATE concierge_call_groups SET current_order = ?, status = 'calling', updated_at = datetime('now') WHERE id = ? AND current_order = ? AND status != 'success'"
  ).bind(nextOrder, groupId, group.current_order).run();

  if (!updateResult.meta.changes || updateResult.meta.changes === 0) {
    return { status: "already_advanced", group_id: groupId };
  }

  const result = await initiateCall(env, db, group.session_id, nextCall.id);
  return {
    status: result.status,
    group_id: groupId,
    call_id: nextCall.id,
    current: nextOrder,
    total: group.total_calls,
    message: result.message
  };
}

export async function initiateCall(env: any, db: any, sessionId: string, callId: number, params?: any) {
  if (!params) {
    const callRow: any = await db.prepare("SELECT hotel_name, hotel_phone, hotel_source, request_details FROM concierge_calls WHERE id = ?").bind(callId).first();
    if (!callRow) return { call_id: callId, status: "failed", message: "Call record not found" };
    const details = JSON.parse(callRow.request_details);
    params = {
      hotel_name: callRow.hotel_name, hotel_phone: callRow.hotel_phone,
      hotel_source: callRow.hotel_source, guest_name: details.guest_name || "Guest",
      date: details.date, check_in_time: details.check_in,
      check_out_time: details.check_out, guests: details.guests,
      language: details.language, special_requests: details.special_requests,
      max_price: details.max_price || "",
      call_mode: details.call_mode || "initial",
      confirmed_price: details.confirmed_price || ""
    };
    if (details.budget && !details.max_price) {
      try {
        const langConfig = getLanguageConfig(details.language || "en");
        const currencyCode = getCurrencyForCountry(details.hotel_country) || langConfig.currency;
        const rates = await getExchangeRates(db);
        const converted = convertBudgetToLocalCurrency(details.budget, currencyCode, rates);
        params.max_price = converted.localFormatted;
      } catch (e) {
        console.error("Budget conversion failed:", e);
      }
    }
  }

  try {
    const webhookUrl = (env?.SITE_URL || 'https://daydreamhub-1sv.pages.dev') + '/api/webhooks/telnyx-voice';

    // Unicode-safe base64 encoding
    const stateJson = JSON.stringify({
      call_log_id: null,
      concierge_call_id: callId,
      session_id: sessionId,
      booking_id: null,
      hotel_id: null,
      guest_name: params.guest_name || 'Guest',
      check_in_date: params.date || params.check_in_date || 'the requested date',
      check_in_time: params.check_in_time || null,
      check_out_time: params.check_out_time || null,
      guests: params.guests || 1,
      phase: 'ivr',
    });
    const bytes = new TextEncoder().encode(stateJson);
    let binary = ''; bytes.forEach((b: number) => binary += String.fromCharCode(b));
    const clientState = btoa(binary);

    const response = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: env.TELNYX_CONNECTION_ID,
        to: params.hotel_phone,
        from: env.TELNYX_FROM_NUMBER,
        from_display_name: 'DayDreamHub',
        webhook_url: webhookUrl,
        webhook_url_method: 'POST',
        client_state: clientState,
        timeout_secs: 30,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Telnyx API error: ${response.status} ${err}`);
    }

    const resData: any = await response.json();
    const telnyxCallId = resData.data?.call_control_id || resData.data?.call_session_id || "";
    await db.prepare(`UPDATE concierge_calls SET telnyx_call_id = ?, status = 'calling', updated_at = datetime('now') WHERE id = ?`).bind(telnyxCallId, callId).run();

    return { call_id: callId, status: "calling", message: `Calling ${params.hotel_name}...` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db.prepare(`UPDATE concierge_calls SET status = 'failed', ai_summary = ?, updated_at = datetime('now') WHERE id = ?`).bind(message, callId).run();
    return { call_id: callId, status: "failed", message: `Failed to call: ${message}` };
  }
}
