import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const runtime = (locals as any).runtime;
  const env = runtime?.env;
  const db = env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  const leadId = params.id;
  if (!leadId) return new Response(JSON.stringify({ error: 'Lead ID required' }), { status: 400 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const {
    report_type,
    appointment_date,
    result,
    content,
    next_action_hotel,
    next_action_ddh,
    next_action_due_date,
    contact_detail,
    // アポ specific
    decision_maker_present,
    hotel_questions,
    ddh_answers,
    staff_attendance_days,
    contactable_time,
    payment_method,
    other_contact_method,
    direct_phone
  } = body;

  if (!report_type) {
    return new Response(JSON.stringify({ error: 'report_type is required' }), { status: 400 });
  }

  try {
    // Use batch for transaction-like behavior (D1 batch is atomic)
    const statements = [];

    // Insert report
    statements.push(
      db.prepare(`
        INSERT INTO appointment_reports (
          crm_lead_id, report_type, appointment_date, result, content,
          next_action_hotel, next_action_ddh, next_action_due_date, contact_detail,
          decision_maker_present, hotel_questions, ddh_answers, staff_attendance_days,
          contactable_time, payment_method, other_contact_method, direct_phone
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        leadId, report_type, appointment_date || null, result || null, content || null,
        next_action_hotel || null, next_action_ddh || null, next_action_due_date || null, contact_detail || null,
        decision_maker_present ?? null, hotel_questions || null, ddh_answers || null,
        staff_attendance_days || null, contactable_time || null, payment_method || null,
        other_contact_method || null, direct_phone || null
      )
    );

    // Update lead: last_updated, progress logic (including '掲載' case)
    let newProgress = result === 'lost' ? 'lost' : (result === 'won' ? 'won' : 'in_progress');
    if (report_type === 'セットアップ' && result === 'completed') {
      newProgress = 'completed';
    }
    // Allow explicit progress override from body for '掲載' etc.
    if (body.progress) {
      newProgress = body.progress;
    }

    statements.push(
      db.prepare(`
        UPDATE crm_leads SET
          last_updated = datetime('now'),
          last_contact_date = datetime('now'),
          progress = ?,
          follow_up_required = CASE WHEN ? IN ('アポ', 'セットアップ') AND result IS NULL THEN 1 ELSE 0 END
        WHERE id = ?
      `).bind(newProgress, report_type, leadId)
    );

    // If progress becomes '掲載', also update the hotels table to published
    if (newProgress === '掲載') {
      // Get hotel_id first
      const leadRow = await db.prepare('SELECT hotel_id FROM crm_leads WHERE id = ?').bind(leadId).first();
      if (leadRow && (leadRow as any).hotel_id) {
        statements.push(
          db.prepare(`
            UPDATE hotels SET
              status = 'published',
              is_active = 1,
              published_at = datetime('now')
            WHERE id = ?
          `).bind((leadRow as any).hotel_id)
        );
      }
    }

    await db.batch(statements);

    return new Response(JSON.stringify({ success: true, message: 'Report created and lead updated' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Transaction failed' }), { status: 500 });
  }
};
