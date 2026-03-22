import type { APIRoute } from 'astro';
import { getExchangeRates } from '../../lib/tools';

export const GET: APIRoute = async ({ locals }) => {
  try {
    const db = (locals as any).runtime?.env?.DB;
    const rates = await getExchangeRates(db);
    return new Response(JSON.stringify({ rates }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to fetch rates' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
