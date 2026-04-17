import type { APIRoute } from 'astro';
import { initiateCall, createCallGroup, initiateNextGroupCall } from '../../../lib/tools';
import { CONCIERGE_SYSTEM_PROMPT_EN, CONCIERGE_SYSTEM_PROMPT_JA } from '../../../lib/claude';

// Shared text sanitizer — strips raw HTML from AI output, converts <a> to Markdown
function sanitizeAIText(text: string): string {
  if (!text) return text;

  // 0. Handle [label](<a href="url" ...>) — AI mixing Markdown links with HTML anchors in URL
  text = text.replace(/\[([^\]]+)\]\(<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>\)/gi, (_, label, href) => `[${label}](${href})`);
  text = text.replace(/\[([^\]]+)\]\(<a[^>]*href="([^"]+)"[^>]*>\)/gi, (_, label, href) => `[${label}](${href})`);

  // 1. Convert complete <a href="...">label</a> → Markdown [label](href)
  text = text.replace(/<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const cleanLabel = label.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || href;
    return `[${cleanLabel}](${href})`;
  });

  // 1b. Handle unclosed <a href="..."> tags (no </a>)
  text = text.replace(/<a\s[^>]*?href="([^"]*)"[^>]*>/gi, (_, href) => `[リンク](${href})`);

  // 2. Strip orphaned HTML attribute fragments (e.g. /hotel/slug" target="_blank" class="...">Book Now)
  text = text.replace(/[^\s"(]*"?\s*target="_blank"[^>]*>(.*?)(?=\n|$)/gi, (_, after) => after.trim());
  text = text.replace(/"?\s*target="_blank"/gi, '');
  text = text.replace(/\s*class="(?:underline|text-amber|hover:|text-teal|font-)[^"]*"/gi, '');
  // orphaned closing > after attribute cleanup
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

// Anthropic fallback when Telnyx is unavailable
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

  const systemPrompt = locale === 'ja' ? CONCIERGE_SYSTEM_PROMPT_JA : CONCIERGE_SYSTEM_PROMPT_EN;

  // Try to search hotels if the message seems to need it
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
  let hotelContext = '';
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

      // 1. DB登録都市と照合
      if (!city) {
        const dbCityRows = await db.prepare(
          `SELECT DISTINCT city FROM hotels WHERE is_active = 1 ORDER BY city`
        ).all();
        for (const row of (dbCityRows?.results || []) as any[]) {
          if (row.city && lowerMsg.includes(row.city.toLowerCase())) {
            city = row.city; break;
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
        const hotels = await db.prepare(
          `SELECT h.id, h.name, h.slug, h.city, h.country, h.property_type, h.rating,
                  p.id as plan_id, p.name as plan_name,
                  p.price_usd, p.check_in_time, p.check_out_time, p.max_guests
           FROM hotels h LEFT JOIN plans p ON p.hotel_id = h.id AND p.is_active = 1
           WHERE h.is_active = 1 AND (
             LOWER(h.city) LIKE ? OR LOWER(h.country) LIKE ?
             OR LOWER(h.city) LIKE ? OR LOWER(h.country) LIKE ?
           )
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

        // 同じ親ホテルから1件のみ表示（最大5件）
        const seenBase = new Set<string>();
        const results = Array.from(hotelMap.values()).filter((h: any) => {
          const base = h.name.split('–')[0].split('-')[0].trim().toLowerCase().slice(0, 30);
          if (seenBase.has(base)) return false;
          seenBase.add(base);
          return true;
        }).slice(0, 5);

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
          // 複数クエリで検索して候補を増やす
          const queries = [
            `day use hotel ${city}`,
            `hourly hotel ${city}`,
            `hotel ${city}`
          ];
          const seen = new Set<string>();
          for (const q of queries) {
            if (extHotels.length >= 5) break;
            const gResult = await searchHotelsExternal(env, { query: q, location: city, language: locale });
            for (const h of (gResult?.hotels || [])) {
              const key = h.name?.toLowerCase().slice(0, 20) || '';
              if (!seen.has(key)) { seen.add(key); extHotels.push(h); }
              if (extHotels.length >= 5) break;
            }
          }
          if (extHotels.length === 0) {
            extHotels = (await searchHotelsBrave(env, city, locale)).slice(0, 5);
          }

          // Inject test hotel for Bangkok searches
          if (cityLower.includes('bangkok') || cityLower.includes('バンコク')) {
            const testHotel = { name: 'Test Hotel Bangkok', address: 'Bangkok, Thailand', phone: '+818053689489', rating: null };
            if (!extHotels.some((h: any) => (h.hotel_name || h.name || '').toLowerCase().includes('test hotel bangkok'))) {
              extHotels.unshift(testHotel);
            }
          }

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
              hotelContext += `\n\n## EXTERNAL HOTELS (Optional add-on - $7 AI phone booking fee if selected):\n${extLines}\n\nAfter showing the free DDH hotels above, add a section "Want more options? (+$7 AI call fee)" with these external hotels. The $7 only applies IF the user chooses to add external hotels.`;
            } else {
              // 自社なし＋外部あり: 外部のみ表示
              hotelContext = `\n\n## EXTERNAL HOTELS (AI phone booking - $7 service fee):\n${extLines}\n\nDaydreamHub has no registered hotels in ${city}. Show these external options with clear note about the $7 AI phone booking fee.`;
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

  const langOverride = locale === 'en'
    ? `\n\n🔴 LANGUAGE OVERRIDE (HIGHEST PRIORITY): This session is in ENGLISH. You MUST write your entire reply in ENGLISH ONLY. Do NOT use Japanese, Thai, Korean, or any other language. Even if hotel names appear in Japanese, your response sentences must be in English.\n`
    : `\n\n🔴 言語設定（最高優先）: このセッションは日本語です。必ず日本語で回答してください。\n`;

  const systemWithContext = systemPrompt + hotelContext + langOverride +
    `\n\n` +
    `=== ABSOLUTE RULES — VIOLATION IS NOT ALLOWED ===\n` +
    `1. ONLY present hotels listed VERBATIM in the hotel data section above.\n` +
    `2. If hotel data is empty or says "No hotels found" → respond: "Sorry, no hotels were found for that location. / 該当するホテルが見つかりませんでした。"\n` +
    `3. NEVER invent hotel names, addresses, phone numbers, prices, or any URLs. Zero exceptions.\n` +
    `4. BOOKING LINKS — STRICT RULE:\n` +
    `   - source:internal hotels ONLY → use MARKDOWN link format: [Book Now](/hotel/slug) using the exact slug from the data\n` +
    `   - Example: [Book Now](/hotel/wellmed-bangkok)\n` +
    `   - source:external hotels → NO booking links whatsoever. Show only the phone number (📞). Never add any URL or link.\n` +
    `   - NEVER generate daydreamhub.com/hotel/... or daydreamhub.com/book/... or any full URL. Use ONLY the exact /hotel/slug from the data.\n` +
    `5. TIME SLOTS — CRITICAL: ONLY use check_in_time and check_out_time from the plan data provided above. NEVER invent, estimate, or assume time slots. If a plan shows "10:00–20:00", write exactly that. Do not write "10:00–18:00" unless that is in the data.\n` +
    `5b. Do NOT output XML function_calls or tool_use tags.\n` +
    `6. For external hotels: show name + address + phone number only. The "Call to Book (+$7)" button is added automatically by the UI — do not add it yourself.\n` +
    `7. NEVER output raw HTML tags (no <a>, <b>, <div>, etc.). Use ONLY Markdown: **bold**, [link text](url), - list item. HTML tags will be shown as broken text to the user.\n` +
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

  // Strip function_call / tool XML tags first
  text = text.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '').trim();
  text = text.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, '').trim();
  text = text.replace(/\[?\{[\s\S]*?"tool_name"[\s\S]*?\}\]?/g, '').trim();
  // Sanitize all remaining HTML
  text = sanitizeAIText(text);
  if (!text) text = 'Let me help you find a day-use hotel. Could you tell me your destination city and preferred date?';

  return { text, messageType: 'text' };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  if (!db || (!env?.TELNYX_API_KEY && !env?.ANTHROPIC_API_KEY && !env?.AI)) {
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
  } = body;
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
        const aiNote = c.ai_summary ? `\n\n🤖 **AIサマリー:** ${c.ai_summary}` : '';
        const priceNote = c.price_quoted ? (locale === 'ja' ? `\n💰 **料金:** ${c.price_quoted}` : `\n💰 **Price:** ${c.price_quoted}`) : '';

        if (c.outcome === 'booked' || c.outcome === 'available') {
          responseText = locale === 'ja'
            ? `✅ **${c.hotel_name}の予約が取れました！**${priceNote}${aiNote}${hotelSaid}`
            : `✅ **Booking confirmed at ${c.hotel_name}!**${priceNote}${aiNote}${hotelSaid}`;
        } else if (c.outcome === 'unavailable') {
          responseText = locale === 'ja'
            ? `❌ **${c.hotel_name}は空きがありません。**${aiNote}${hotelSaid}`
            : `❌ **${c.hotel_name} is not available.**${aiNote}${hotelSaid}`;
        } else if (c.outcome === 'no_answer' || c.outcome === 'voicemail') {
          responseText = locale === 'ja'
            ? `📵 **${c.hotel_name}に繋がりませんでした。**${aiNote}${hotelSaid}`
            : `📵 **Could not reach ${c.hotel_name}.**${aiNote}${hotelSaid}`;
        } else if (c.outcome === 'over_budget') {
          responseText = locale === 'ja'
            ? `💸 **${c.hotel_name}は予算オーバーです。**${priceNote}${aiNote}${hotelSaid}`
            : `💸 **${c.hotel_name} exceeds budget.**${priceNote}${aiNote}${hotelSaid}`;
        } else {
          responseText = locale === 'ja'
            ? `📞 **${c.hotel_name}への電話が完了しました。**${priceNote}${aiNote}${hotelSaid}`
            : `📞 **Call to ${c.hotel_name} completed.**${priceNote}${aiNote}${hotelSaid}`;
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
      if (guest_name || guest_email) {
        let requestDetails: any = {};
        try {
          requestDetails = JSON.parse(c.request_details || '{}');
        } catch {}
        if (guest_name) requestDetails.guest_name = guest_name;
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
      const requestDetails = {
        guest_name: callGroupData.guest_name,
        guest_email: callGroupData.guest_email,
        check_in_date: callGroupData.check_in_date,
        check_in_time: callGroupData.check_in_time || '10:00',
        check_out_time: callGroupData.check_out_time || '18:00',
        adults: callGroupData.adults || 1,
        children: callGroupData.children || 0,
      };
      const group = await createCallGroup(env, {
        session_id,
        hotels: callGroupData.hotels,
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
      const mode = env.PAYPAL_MODE || 'live';
      const accessToken = await getAccessToken(env.PAYPAL_CLIENT_ID, env.PAYPAL_SECRET, mode);
      const paypalOrderId = await createOrder(accessToken, 7, mode, 'DaydreamHub AI Phone Booking Service');
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
      if (guest_name || guest_email) {
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
          await db
            .prepare(
              "UPDATE concierge_calls SET guest_name = COALESCE(?, guest_name), guest_email = COALESCE(?, guest_email), request_details = ?, updated_at = datetime('now') WHERE id = ?"
            )
            .bind(guest_name || null, guest_email || null, JSON.stringify(details), row.id)
            .run();
        }
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

    let result: { text: string; messageType: string; metadata?: any };
    if (env?.TELNYX_API_KEY) {
      result = await telnyxOrchestrate(env, claudeMessages, locale, db, session_id);
    } else {
      // Anthropic / Cloudflare AI fallback
      const systemPrompt = locale === 'ja' ? CONCIERGE_SYSTEM_PROMPT_JA : CONCIERGE_SYSTEM_PROMPT_EN;
      const lastMsg = claudeMessages.filter((m: any) => m.role === 'user').pop()?.content || '';
      let hotelCtx = '';
      try {
        const cityMatch = lastMsg.match(/\b(tokyo|bangkok|dubai|singapore|london|paris|osaka|kyoto|bali|jakarta|kuala lumpur|seoul|taipei|hong kong|sydney|new york|berlin|rome|istanbul|cairo|mumbai|delhi|hanoi|cebu|phuket|nairobi|birmingham|belgrade|tbilisi|manama|doha)\b/i);
        if (cityMatch) {
          const city = cityMatch[1];
          const hotels = await db.prepare(
            `SELECT h.name, h.slug, h.city, h.country, h.property_type, MIN(p.price_usd) as min_price
             FROM hotels h LEFT JOIN plans p ON p.hotel_id = h.id
             WHERE h.is_active = 1 AND (LOWER(h.city) LIKE ? OR LOWER(h.country) LIKE ?)
             GROUP BY h.id
             ORDER BY
               CASE WHEN LOWER(h.property_type) LIKE '%clinic%' OR LOWER(h.name) LIKE '%clinic%' THEN 1 ELSE 0 END ASC,
               h.rating DESC
             LIMIT 6`
          ).bind(`%${city.toLowerCase()}%`, `%${city.toLowerCase()}%`).all();
          const rs = hotels?.results || [];
          if (rs.length > 0) {
            hotelCtx = '\n\nAvailable DayDreamHub hotels for "' + city + '":\n' +
              rs.map((h: any) => `- ${h.name} (${h.city}, ${h.country}) from $${h.min_price || '?'} → /hotel/${h.slug}`).join('\n');
          }
        }
      } catch {}
      const fullPrompt = systemPrompt + hotelCtx + '\n\nIMPORTANT: Respond in plain text only. No XML, no HTML tags, no function call tags. Use only Markdown.';
      let text: string;
      if (env?.ANTHROPIC_API_KEY) {
        text = await anthropicChat(env, claudeMessages, fullPrompt);
      } else {
        text = await cfAiChat(env, claudeMessages, fullPrompt);
      }
      text = sanitizeAIText(text);
      result = { text, messageType: 'text' };
    }

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
