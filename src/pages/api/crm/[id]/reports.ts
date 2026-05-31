import type { APIRoute } from 'astro';
import { verifyAdmin } from '../../../../lib/adminAuth';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const runtime = (locals as any).runtime;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const admin = await verifyAdmin(request, jwtSecret);
  if (!admin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: 'DB not available' }), { status: 500 });

  const leadId = params.id;
  if (!leadId) return new Response(JSON.stringify({ error: 'Lead ID required' }), { status: 400 });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const {
    report_type, appointment_date, result, content,
    next_action_hotel, next_action_ddh, next_action_due_date, contact_detail,
    decision_maker_present, hotel_questions, ddh_answers,
    staff_attendance_days, contactable_time, payment_method,
    other_contact_method, direct_phone, lost_reason,
  } = body;

  if (!report_type) {
    return new Response(JSON.stringify({ error: 'report_type is required' }), { status: 400 });
  }

  try {
    // Determine new progress status
    let newProgress: string;
    if (body.progress) {
      newProgress = body.progress;
    } else if (result === 'lost') {
      newProgress = 'lost';
    } else if (result === 'won') {
      newProgress = 'won';
    } else if (report_type === 'セットアップ' && result === 'completed') {
      newProgress = 'won'; // セットアップ完了 = 掲載確定
    } else {
      newProgress = 'in_progress';
    }

    const statements: any[] = [];

    // 1. Insert the report
    statements.push(
      db.prepare(`
        INSERT INTO appointment_reports (
          crm_lead_id, report_type, appointment_date, result, content,
          next_action_hotel, next_action_ddh, next_action_due_date, contact_detail,
          decision_maker_present, hotel_questions, ddh_answers,
          staff_attendance_days, contactable_time, payment_method,
          other_contact_method, direct_phone, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        leadId, report_type, appointment_date || null, result || null, content || null,
        next_action_hotel || null, next_action_ddh || null, next_action_due_date || null, contact_detail || null,
        decision_maker_present ?? null, hotel_questions || null, ddh_answers || null,
        staff_attendance_days || null, contactable_time || null, payment_method || null,
        other_contact_method || null, direct_phone || null
      )
    );

    // 2. Update lead progress + timestamps
    statements.push(
      db.prepare(`
        UPDATE crm_leads SET
          last_updated = datetime('now'),
          updated_at = datetime('now'),
          last_contact_date = datetime('now'),
          progress = ?,
          follow_up_required = CASE WHEN ? = 'in_progress' THEN 1 ELSE 0 END,
          lost_reason = CASE WHEN ? IS NOT NULL THEN ? ELSE lost_reason END
        WHERE id = ?
      `).bind(newProgress, newProgress, lost_reason || null, lost_reason || null, leadId)
    );

    // 3. If progress → 'won', auto-publish the linked hotel (atomic batch)
    if (newProgress === 'won') {
      const leadRow = await db.prepare('SELECT hotel_id FROM crm_leads WHERE id = ?').bind(leadId).first();
      if (leadRow && (leadRow as any).hotel_id) {
        statements.push(
          db.prepare(`
            UPDATE hotels SET status = 'published', is_active = 1
            WHERE id = ?
          `).bind((leadRow as any).hotel_id)
        );
      }
    }

    await db.batch(statements);

    return new Response(JSON.stringify({ success: true, new_progress: newProgress }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Transaction failed' }), { status: 500 });
  }
};
