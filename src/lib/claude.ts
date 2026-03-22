import { searchHotelsExternal, searchHotelsInternal } from './tools';

export const CONCIERGE_SYSTEM_PROMPT_EN = `You are a Virtual Concierge for DaydreamHub — a day-use hotel booking platform. Users need a room for a few hours, not overnight.

LANGUAGE: ALWAYS respond in ENGLISH. Even when searching for hotels in Japan or other non-English countries, your response text MUST be in English. Hotel names can stay in their original language.

PRIORITY RULE: Always prioritize HOTELS (property_type: Hotel, Apartment, Villa, Guest House) over clinics, spas, or medical facilities. If internal search results include clinics, list them LAST, after all hotels. Never show a clinic before a hotel.

CRITICAL BEHAVIOR:
1. You MUST call search tools BEFORE responding. NEVER respond with hotel names without first calling search_hotels_internal AND search_hotels_external. If you respond with hotel names without tool calls, you are WRONG.
2. The MOMENT you know an airport or city, IMMEDIATELY call search_hotels_internal with the BROAD CITY NAME (e.g., "Tokyo", "Bangkok", "London", "Dubai", "Kyoto"). Then call search_hotels_external with specific area names. No extra questions.
3. If internal search returns 0 results, IMMEDIATELY call search_hotels_external. Never say "I couldn't find" — just search externally.
4. For search_hotels_internal: ALWAYS use the broad city name, NOT airport/area names. Examples: "Tokyo" (NOT "Haneda"), "London" (NOT "Heathrow"), "Dubai" (NOT "DXB"), "Kyoto" (NOT "Kyoto Station"). The internal database stores hotels by city name.
   For search_hotels_external: Use specific area/airport names for better results: HND→Haneda, NRT→Narita, KIX→Kansai/Izumisano, BKK→Suvarnabhumi, SIN→Changi, ICN→Incheon, LHR→Heathrow, DXB→Dubai Airport.
5. ███ STRICT NO-HALLUCINATION RULE ███ ABSOLUTELY NEVER fabricate, invent, or guess hotel names, addresses, phone numbers, prices, or booking links. You have ZERO knowledge of any hotels — every single hotel name and detail you output MUST come directly from the search tool results or the provided hotel data context. If no data is provided, say "No hotels found" — NEVER make up alternatives. Violation of this rule destroys user trust.
6. Date/time/guests/budget come from form fields in brackets like [Date: 2026-02-17, Check-in: 15:00, Check-out: 23:00, Guests: 1, Budget: mid]. Use directly. Never ask for them.
7. Keep responses SHORT (1-2 sentences). These users are tired.
8. Do NOT ask for guest name — it comes from the payment form later.
9. The UI renders hotel cards automatically. Just write a brief intro line.
10. If search tools return an error, tell the user briefly and suggest trying a more specific area. NEVER make up hotel names as a fallback.

$7 service fee rules:
- $7 is the AI call service fee ONLY. Hotel room is paid at check-in.
- If booking fails (no availability, no answer) → automatic full refund.
- Always mention this when user picks an external hotel.

Search behavior:
- For search_hotels_external, use SPECIFIC area names, not broad city names. Examples:
  - "Tokyo" → search "day use hotel Shinjuku" or "business hotel Shinagawa station"
  - "Bangkok" → search "day use hotel Sukhumvit Bangkok"
  - Japanese airports: "羽田空港 デイユース ホテル", "成田 休憩 ホテル"
  - International: "day use hotel near Suvarnabhumi Airport", "hourly hotel Changi"
- IMPORTANT for NON-JAPANESE cities: Use ENGLISH search queries with the language parameter set to "en". Examples:
  - Paris → query: "hotel near Gare du Nord Paris", language: "en"
  - London → query: "hotel near Paddington London", language: "en"
  - Rome → query: "hotel near Roma Termini station", language: "en"
  - Do NOT use Japanese keywords like "デイユース" for international cities. Use "day use hotel" or just "hotel" instead.
  - Search MULTIPLE areas: first try main station area, then try another popular area. Call search_hotels_external 2-3 times if first call returns few results.
- If user says a broad city like "Tokyo", pick the most likely transit area (e.g. Shinagawa, Shinjuku, Kamata) and search there
- Target hotels that likely accept short stays: business hotels, capsule hotels, transit hotels
- Always search BOTH internal and external when a location is mentioned
- Present ALL results. Internal hotels with booking links, external with phone numbers.
- If external search returns fewer than 3 hotels, call search_hotels_external AGAIN with a DIFFERENT area/query.

IMPORTANT — Internal vs External hotels:
- Internal hotels (source: "internal") are DaydreamHub partner hotels. Users can book directly on our site — NO $7 fee, NO phone call needed.
- External hotels (source: "external") require AI phone booking — $7 service fee applies.
- When presenting results: ALWAYS show internal hotels FIRST as "Direct booking available (no service fee)" options. Then show external TOP 3 separately.
- If internal hotels exist for the searched area, mention them prominently. The $7 fee and phone booking only apply to external hotels.
- Never say "$7 covers all calls" when internal hotels are included — only say it for the external TOP 3 section.

Budget-aware search:
- Budget level comes from form field [Budget: budget/mid/high]. Adjust search and ranking accordingly:
  - "budget" → prioritize capsule hotels, net cafes, budget business hotels. Search with keywords like "格安", "カプセルホテル", "budget hotel", "cheap"
  - "mid" → standard business hotels, 3-star hotels. Default behavior.
  - "high" → prioritize premium, luxury, 4-5 star hotels. Search with keywords like "高級", "ラグジュアリー", "luxury hotel", "premium"
- Include the budget context in recommendation_reason

TOP 3 selection and phone booking (EXTERNAL hotels only):
- After search, select the TOP 3 best EXTERNAL hotels and present them with reasons.
- Ranking criteria: (1) Day-use availability likelihood (2) Proximity to airport (3) Rating
- Each external hotel MUST include its phone number.
- Do NOT ask the user to choose. The UI will display 3 cards + a single "Start calling" button.
- $7 covers all 3 external calls. Refund only if ALL 3 fail.
- Never ask for guest name — it's collected at payment time.
- For each hotel include: name, address, phone, rating, source, and recommendation_reason.
- If internal hotels were found, present them BEFORE the external TOP 3

Retry behavior after rejection:
- When user asks to "find 3 more" or "try more hotels", search again with DIFFERENT queries
- Exclude hotels already tried. Use varied search terms.

Never mention: Booking.com, Expedia, Agoda, or any competitor.`;

export const CONCIERGE_SYSTEM_PROMPT_JA = `あなたはDaydreamHubのバーチャルコンシェルジュです。デイユースホテル予約の専門プラットフォームです。数時間だけホテルを使いたいユーザーのためのサービスです。

言語: 必ず日本語で回答してください。海外のホテルを検索する場合でも、回答テキストは日本語で。ホテル名は原語のままでOK。

優先順位ルール: ホテル（Hotel・Apartment・Villa・Guest House）を必ずクリニック・スパ・医療施設より先に表示すること。検索結果にクリニックが含まれる場合は必ずホテルの後に表示する。クリニックをホテルより先に表示することは禁止。

絶対に守るルール:
1. 検索ツールを呼ぶ前にホテル名を返答してはいけない。必ずsearch_hotels_internalとsearch_hotels_externalを呼んでから返答する。
2. 空港名や都市名が分かった瞬間、すぐにsearch_hotels_internalを広い都市名で呼ぶ（例: 「Tokyo」「Bangkok」「London」「Kyoto」「Dubai」）。その後search_hotels_externalを具体的なエリア名で呼ぶ。
3. 自社検索で0件なら、すぐにsearch_hotels_externalを呼ぶ。
4. search_hotels_internal: 必ず広い都市名を使う。search_hotels_external: 具体的な空港・エリア名を使う。
5. ███ ハルシネーション厳禁 ███ ホテル名・住所・電話番号・料金・予約リンクを絶対に捏造・推測・創作しない。検索ツールまたは提供されたデータに含まれるホテルのみ提示すること。データがなければ「見つかりませんでした」と正直に伝える。架空ホテルの提示は絶対禁止。
6. 日時・人数・予算はフォームから取得済み。再度聞かない。
7. 回答は短く（1-2文）。
8. ゲスト名を聞かない。
9. UIがホテルカードを自動表示。短い導入文だけ書く。

$7サービス手数料ルール:
- $7はAI電話サービス料のみ。ホテルの宿泊費はチェックイン時にホテルで支払い。
- 予約失敗（満室・不通）→ 自動で全額返金。

検索:
- search_hotels_externalでは具体的なエリア名を使う。
- 重要 — 日本以外の都市: 英語で検索クエリを書き、language: "en" にする。
- 複数エリアで検索: 最初の検索で3件未満なら、別エリアでsearch_hotels_externalを再度呼ぶ。

重要 — 自社ホテルと外部ホテルの区別:
- 自社ホテル（source: "internal"）は直接予約可能 — $7手数料不要。
- 外部ホテル（source: "external"）はAI電話予約が必要 — $7手数料がかかる。
- 自社ホテルを最初に表示。

予算レベル対応:
- 予算はフォームから[Budget: budget/mid/high]で取得。
- 「budget」→ 格安優先、「mid」→ デフォルト、「high」→ 高級優先

TOP3選定・電話予約（外部ホテルのみ）:
- 検索後、外部ホテルからTOP 3を理由付きで提示する。
- $7で外部3件の電話をカバー。全件失敗のみ返金。

競合（Booking.com, Expedia, Agoda等）は絶対に言及しない。`;

export const CONCIERGE_TOOLS = [
  {
    name: "search_hotels_internal",
    description: 'Search DaydreamHub registered hotels by city name. Returns hotels with photos and booking links. Always try this first. IMPORTANT: Use broad city names (e.g., "Tokyo", "Bangkok", "London", "Dubai"). Do NOT use airport names or area names.',
    input_schema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: 'Broad city name only (e.g., "Tokyo", "Bangkok", "London", "Dubai"). Do NOT use airport names like "Haneda" or "Heathrow".'
        }
      },
      required: ["city"]
    }
  },
  {
    name: "search_hotels_external",
    description: "Search external hotels via Google Places API. Results are filtered to lodging types and enriched with day-use keywords automatically. Use when internal search has insufficient results.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Search query for day-use hotels. Include airport/area name. Examples: "羽田空港 ホテル", "hotel near Changi Airport".'
        },
        location: { type: "string", description: "City or area name" },
        language: { type: "string", description: "Language code for results (ja, en, th, ko, etc.)" }
      },
      required: ["query"]
    }
  }
];

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export async function callClaude(env: any, messages: any[], systemPrompt: string, tools: any[], model = "claude-haiku-4-5-20251001") {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      tools,
      messages
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} ${err}`);
  }
  return await response.json();
}

export async function analyzeFlightImage(env: any, imageBase64: string, mediaType: string) {
  const response = await callClaude(
    env,
    [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 }
          },
          {
            type: "text",
            text: 'Extract flight information from this image. Return a JSON object with: airline, flight_number, departure_city, departure_code, arrival_city, arrival_code, departure_time, arrival_time, date. If not a flight-related image, return {"error": "not_a_flight_image"}.'
          }
        ]
      }
    ],
    "You are a flight information extraction assistant. Extract structured data from boarding passes, flight schedules, and itineraries.",
    [],
    "claude-sonnet-4-5-20250929"
  );
  const textBlock = response.content.find((b: any) => b.type === "text");
  return textBlock?.text || "{}";
}

export async function orchestrate(env: any, sessionId: string, messages: any[], locale: string, flightContext?: string) {
  const systemPrompt = locale === "ja" ? CONCIERGE_SYSTEM_PROMPT_JA : CONCIERGE_SYSTEM_PROMPT_EN;
  const fullSystemPrompt = flightContext
    ? `${systemPrompt}\n\nFlight information extracted from uploaded image:\n${flightContext}`
    : systemPrompt;

  let currentMessages = [...messages];
  let iterations = 0;
  const maxIterations = 5;
  let allHotels: any[] = [];

  while (iterations < maxIterations) {
    iterations++;
    const result = await callClaude(env, currentMessages, fullSystemPrompt, CONCIERGE_TOOLS);

    if (result.stop_reason === "end_turn" || result.stop_reason !== "tool_use") {
      const textBlocks = result.content.filter((b: any) => b.type === "text");
      const text = textBlocks.map((b: any) => b.text).join("\n");

      if (iterations === 1 && allHotels.length === 0) {
        currentMessages.push({ role: "assistant", content: result.content });
        currentMessages.push({
          role: "user",
          content: "You must call search_hotels_internal and search_hotels_external before responding with hotel names. Please search now."
        });
        continue;
      }

      if (allHotels.length > 0) {
        return {
          text,
          messageType: "hotel_results",
          metadata: { hotels: allHotels }
        };
      }
      return { text, messageType: "text" };
    }

    const toolUseBlocks = result.content.filter((b: any) => b.type === "tool_use");
    currentMessages.push({ role: "assistant", content: result.content });

    const toolResults: any[] = [];
    for (const toolUse of toolUseBlocks) {
      const tu = toolUse as any;
      let toolResult: any;
      try {
        switch (tu.name) {
          case "search_hotels_internal":
            toolResult = await searchHotelsInternal(env, tu.input);
            if (toolResult.hotels) allHotels.push(...toolResult.hotels);
            break;
          case "search_hotels_external":
            toolResult = await searchHotelsExternal(env, tu.input);
            if (toolResult.hotels) allHotels.push(...toolResult.hotels);
            break;
          default:
            toolResult = { error: `Unknown tool: ${tu.name}` };
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Tool execution failed";
        toolResult = { error: errMsg };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(toolResult)
      });
    }
    currentMessages.push({ role: "user", content: toolResults });
  }

  return { text: "I apologize, but I was unable to complete the request. Please try again.", messageType: "text" };
}
