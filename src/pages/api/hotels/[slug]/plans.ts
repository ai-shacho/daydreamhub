import type { APIRoute } from 'astro';

// Rough Japanese-character ratio; used as a quality gate so a bad model
// output (romaji soup) never gets cached as a "translation".
function looksJapanese(s: string): boolean {
  if (!s) return false;
  const ja = (s.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length;
  return ja / s.length >= 0.2;
}

// Workers AI translation with model fallback. Best-effort: null on failure.
async function aiTranslate(env: any, prompt: string, text: string, maxTokens: number): Promise<string | null> {
  if (!env?.AI || !text) return null;
  for (const model of ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct']) {
    try {
      const r = await env.AI.run(model, {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: text.slice(0, 1500) },
        ],
        max_tokens: maxTokens,
      });
      const out = String(r?.response || r?.result?.response || '').trim();
      if (out) return out;
    } catch {
      // try next model
    }
  }
  return null;
}

// Fill missing Japanese fields once and cache them back into D1, so the
// translation cost is paid a single time per hotel.
async function ensureJapanese(env: any, db: any, hotel: any, plans: any[]) {
  // Re-translate when the cached value is missing OR fails the quality gate
  // (self-heals rows polluted by a bad model run).
  if (hotel.description && !looksJapanese(hotel.description_ja || '')) {
    const ja = await aiTranslate(
      env,
      'Translate this hotel description into natural, concise Japanese for travellers. Reply with ONLY the Japanese translation, no preamble.',
      hotel.description,
      600
    );
    if (ja && ja.length > 10 && looksJapanese(ja)) {
      hotel.description_ja = ja;
      await db.prepare('UPDATE hotels SET description_ja = ? WHERE id = ?').bind(ja, hotel.id).run().catch(() => {});
    } else if (!looksJapanese(hotel.description_ja || '')) {
      hotel.description_ja = null; // fall back to English rather than show garbage
    }
  }
  const missing = plans.filter((p) => p.name && !p.name_ja);
  if (missing.length) {
    const out = await aiTranslate(
      env,
      'Translate these day-use hotel plan names into Japanese. Keep prefixes like 【6H】, times, and proper nouns (airport/hotel names) as-is. Reply with ONLY a JSON array of strings, same order and length as the input.',
      JSON.stringify(missing.map((p) => p.name)),
      400
    );
    let batchOk = false;
    try {
      const m = out && out.match(/\[[\s\S]*\]/);
      const arr = m ? JSON.parse(m[0]) : null;
      if (Array.isArray(arr) && arr.length === missing.length) {
        batchOk = true;
        for (let i = 0; i < missing.length; i++) {
          const ja = String(arr[i] || '').trim();
          if (!ja || !looksJapanese(ja)) continue;
          missing[i].name_ja = ja;
          await db.prepare('UPDATE plans SET name_ja = ? WHERE id = ?').bind(ja, missing[i].id).run().catch(() => {});
        }
      }
    } catch {}
    // Batch JSON output is flaky — translate one by one as a fallback.
    if (!batchOk) {
      for (const p of missing.slice(0, 6)) {
        const ja = await aiTranslate(
          env,
          'Translate this day-use hotel plan name into Japanese. Keep prefixes like 【6H】, times, and proper nouns as-is. Reply with ONLY the translated name.',
          p.name,
          80
        );
        if (ja && looksJapanese(ja)) {
          p.name_ja = ja;
          await db.prepare('UPDATE plans SET name_ja = ? WHERE id = ?').bind(ja, p.id).run().catch(() => {});
        }
      }
    }
  }
}

export const GET: APIRoute = async ({ params, locals, url }) => {
  const env = (locals as any).runtime?.env;
  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB unavailable' }), { status: 500 });

  const { slug } = params;
  try {
    // currency and the age bands come along because the app has to price and
    // label add-ons the same way the website does; the cancellation policy
    // because a guest should see the terms before paying, not after.
    const hotel = await db.prepare(
      `SELECT id, name, name_ja, slug, city, country, thumbnail_url, images, description, description_ja,
              currency, infant_max_age, child_max_age, cancellation_policy
         FROM hotels WHERE slug = ? AND is_active = 1`
    ).bind(slug).first();

    if (!hotel) return new Response(JSON.stringify({ error: 'Hotel not found' }), { status: 404 });

    // Photos live in two places: the hotel_images table (admin-managed, most
    // hotels) and the hotels.images JSON column (owner uploads). Merge both.
    let photos: string[] = [];
    try {
      const imgRows = await db.prepare(
        'SELECT image_url FROM hotel_images WHERE hotel_id = ? ORDER BY sort_order ASC LIMIT 12'
      ).bind(hotel.id).all();
      photos = (imgRows.results || []).map((r: any) => r.image_url).filter(Boolean);
    } catch {
      // table may not exist in stripped-down environments
    }
    try {
      const arr = JSON.parse(hotel.images || '[]');
      if (Array.isArray(arr)) {
        for (const u of arr) if (typeof u === 'string' && u && !photos.includes(u)) photos.push(u);
      }
    } catch {}
    hotel.images = photos.slice(0, 12);

    const plans = await db.prepare(
      `SELECT id, name, name_ja, price_usd, price_local, check_in_time, check_out_time, plan_type,
              max_guests, duration_hours, room_type, cancellation_hours, cancellation_policy
         FROM plans WHERE hotel_id = ? AND is_active = 1 ORDER BY price_usd ASC`
    ).bind(hotel.id).all();

    const planRows = plans.results || [];

    // Paid add-ons, attached to the plan they belong to. counts_* decide who a
    // per-guest option is charged for — a day pass may count everyone through
    // the door, a tasting adults only — so the app cannot assume adults+children.
    try {
      const ids = planRows.map((p: any) => p.id);
      if (ids.length) {
        const optRows = await db.prepare(
          `SELECT id, plan_id, name, name_ja, description, pricing_type,
                  price_local, price_usd, child_price_local, child_price_usd,
                  infant_price_local, infant_price_usd,
                  counts_adults, counts_children, counts_infants
             FROM plan_options
            WHERE plan_id IN (${ids.map(() => '?').join(',')}) AND is_active = 1
            ORDER BY sort_order ASC, id ASC`
        ).bind(...ids).all();
        const byPlan = new Map<number, any[]>();
        for (const o of (optRows.results || []) as any[]) {
          if (!byPlan.has(o.plan_id)) byPlan.set(o.plan_id, []);
          byPlan.get(o.plan_id)!.push(o);
        }
        for (const p of planRows as any[]) p.options = byPlan.get(p.id) || [];
      }
    } catch {
      // An older database without plan_options should still serve plans.
      for (const p of planRows as any[]) p.options = [];
    }
    if (url.searchParams.get('lang') === 'ja') {
      await ensureJapanese(env, db, hotel, planRows).catch(() => {});
    }

    return new Response(JSON.stringify({ hotel, plans: planRows }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
