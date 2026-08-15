import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/apiAuth';
import { listOptions, createOption, updateOption, deleteOption } from '../../../lib/planOptions';

// Paid add-ons, from the admin side. Same rules as the owner route — the logic
// lives in lib/planOptions — but an admin is not restricted to one hotel's
// plans. Added because add-ons could only ever be created by an owner, and
// after the feature shipped not one hotel had any: nobody on the DayDreamHub
// side could set one up on a hotel's behalf.
const json = { 'Content-Type': 'application/json' };

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: json });
}

const planOf = (db: any, planId: number) =>
  db.prepare('SELECT id, hotel_id FROM plans WHERE id = ?').bind(planId).first();

const optionOf = (db: any, id: number) =>
  db.prepare('SELECT * FROM plan_options WHERE id = ?').bind(id).first();

async function gate(request: Request, locals: any) {
  const env = locals?.runtime?.env;
  const db = env?.DB;
  if (!db) return { error: bad('Database not available', 503) };
  const { response } = await requireAdmin(request, env?.JWT_SECRET || 'dev-secret');
  if (response) return { error: response };
  return { db };
}

export const GET: APIRoute = async ({ request, locals }) => {
  const { db, error } = await gate(request, locals);
  if (error) return error;

  const planId = Number(new URL(request.url).searchParams.get('plan_id'));
  if (!planId) return bad('plan_id required');
  if (!(await planOf(db, planId))) return bad('Plan not found', 404);

  return new Response(JSON.stringify({ options: await listOptions(db, planId) }), { headers: json });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const { db, error } = await gate(request, locals);
  if (error) return error;

  let body: any;
  try { body = await request.json(); } catch { return bad('Invalid JSON'); }

  const planId = Number(body.plan_id);
  if (!planId) return bad('plan_id required');
  const plan: any = await planOf(db, planId);
  if (!plan) return bad('Plan not found', 404);

  try {
    const created = await createOption(db, planId, plan.hotel_id, body);
    return new Response(JSON.stringify({ success: true, ...created }), { headers: json });
  } catch (e: any) {
    return bad(e?.message || 'Failed to create option', 400);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const { db, error } = await gate(request, locals);
  if (error) return error;

  let body: any;
  try { body = await request.json(); } catch { return bad('Invalid JSON'); }
  const id = Number(body.id);
  if (!id) return bad('id required');

  const existing: any = await optionOf(db, id);
  if (!existing) return bad('Option not found', 404);

  try {
    await updateOption(db, id, existing, body);
    return new Response(JSON.stringify({ success: true }), { headers: json });
  } catch (e: any) {
    return bad(e?.message || 'Failed to update option', 400);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const { db, error } = await gate(request, locals);
  if (error) return error;

  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!id) return bad('id required');
  if (!(await optionOf(db, id))) return bad('Option not found', 404);

  await deleteOption(db, id);
  return new Response(JSON.stringify({ success: true }), { headers: json });
};
