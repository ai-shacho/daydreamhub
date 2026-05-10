import type { APIRoute } from 'astro';
import { verifyOwner, getOwnerHotelIds } from '../../../lib/ownerAuth';
import { sendStaffInvitationEmail } from '../../../lib/email';

function generateInvitationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if ((owner as any).role === 'staff') {
    const { getStaffRole } = await import('../../../lib/ownerAuth');
    const staffRole = await getStaffRole(db, (owner as any).sub);
    if (staffRole !== 'co_owner') {
      return new Response(JSON.stringify({ error: 'Only owners and co-owners can manage staff' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const ownerHotelIds = await getOwnerHotelIds(db, owner);
    if (ownerHotelIds.length === 0) {
      return new Response(JSON.stringify({ staff: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const placeholders = ownerHotelIds.map(() => '?').join(',');
    const staffRes = await db
      .prepare(
        `
      SELECT hs.id, hs.hotel_id, hs.created_at, u.id as user_id, u.name, u.email, h.name as hotel_name
      FROM hotel_staff hs
      JOIN users u ON hs.user_id = u.id
      JOIN hotels h ON hs.hotel_id = h.id
      WHERE hs.hotel_id IN (${placeholders})
      ORDER BY hs.created_at DESC
    `
      )
      .bind(...ownerHotelIds)
      .all();
    return new Response(JSON.stringify({ staff: staffRes?.results || [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Failed to load staff' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Allow owners and co_owners to manage staff
  if ((owner as any).role === 'staff') {
    const { getStaffRole } = await import('../../../lib/ownerAuth');
    const staffRole = await getStaffRole(db, (owner as any).sub);
    if (staffRole !== 'co_owner') {
      return new Response(JSON.stringify({ error: 'Only owners and co-owners can manage staff' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body: any = await request.json();
    const { email, name, hotel_id, staff_role: requestedRole } = body;
    const staffRoleValue = (requestedRole === 'co_owner') ? 'co_owner' : 'booking_manager';
    if (!email || !name || !hotel_id) {
      return new Response(
        JSON.stringify({ error: 'Email, name, and hotel_id are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const ownerHotelIds = await getOwnerHotelIds(db, owner);
    if (!ownerHotelIds.includes(Number(hotel_id))) {
      return new Response(JSON.stringify({ error: 'Hotel does not belong to you' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await db
      .prepare('SELECT id, role FROM users WHERE email = ?')
      .bind(normalizedEmail)
      .first();
    let userId: number;
    let isNewUser = false;
    if (existingUser) {
      if ((existingUser as any).role !== 'staff') {
        return new Response(
          JSON.stringify({ error: 'User already exists with a different role' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      userId = (existingUser as any).id;
      const existingStaff = await db
        .prepare('SELECT id FROM hotel_staff WHERE hotel_id = ? AND user_id = ?')
        .bind(Number(hotel_id), userId)
        .first();
      if (existingStaff) {
        return new Response(
          JSON.stringify({ error: 'This staff member is already assigned to this hotel' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      const randomPass = crypto.randomUUID();
      const encoder = new TextEncoder();
      const data = encoder.encode(randomPass);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const passwordHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      const insertRes = await db
        .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .bind(name.trim(), normalizedEmail, passwordHash, 'staff')
        .run();
      userId = insertRes?.meta?.last_row_id;
      isNewUser = true;
    }
    await db
      .prepare('INSERT INTO hotel_staff (hotel_id, user_id, invited_by, staff_role) VALUES (?, ?, ?, ?)')
      .bind(Number(hotel_id), userId, owner.sub, staffRoleValue)
      .run();

    // Send invitation email with password setup link (for new users only)
    let emailSent = false;
    if (isNewUser) {
      const resendApiKey = runtime?.env?.RESEND_API_KEY;
      if (resendApiKey) {
        try {
          // Generate invitation token (7 days expiry)
          const token = generateInvitationToken();
          const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
          await db
            .prepare('INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)')
            .bind(normalizedEmail, token, expiresAt)
            .run();

          // Get hotel name
          const hotelRow = await db
            .prepare('SELECT name FROM hotels WHERE id = ?')
            .bind(Number(hotel_id))
            .first();
          const hotelName = (hotelRow as any)?.name || 'DayDreamHub';

          // Build invitation link
          const origin = request.headers.get('origin') || new URL(request.url).origin || 'https://daydreamhub.com';
          const invitationLink = `${origin}/auth/new-password?token=${token}`;

          const result = await sendStaffInvitationEmail(resendApiKey, {
            name: name.trim(),
            email: normalizedEmail,
            staffRole: staffRoleValue as 'co_owner' | 'booking_manager',
            hotelName,
            inviterName: (owner as any).name || '',
            invitationLink,
          });
          emailSent = result.success;
        } catch (e) {
          console.error('Failed to send staff invitation email:', e);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, user_id: userId, email_sent: emailSent, is_new_user: isNewUser }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Failed to invite staff' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const runtime = (locals as any).runtime;
  const db = runtime?.env?.DB;
  const jwtSecret = runtime?.env?.JWT_SECRET || 'dev-secret';
  const owner = await verifyOwner(request, jwtSecret);
  if (!owner) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if ((owner as any).role === 'staff') {
    const { getStaffRole } = await import('../../../lib/ownerAuth');
    const staffRole = await getStaffRole(db, (owner as any).sub);
    if (staffRole !== 'co_owner') {
      return new Response(JSON.stringify({ error: 'Only owners and co-owners can manage staff' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database not available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body: any = await request.json();
    const { staff_id } = body;
    if (!staff_id) {
      return new Response(JSON.stringify({ error: 'staff_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const ownerHotelIds = await getOwnerHotelIds(db, owner);
    if (ownerHotelIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No hotels found' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const placeholders = ownerHotelIds.map(() => '?').join(',');
    const staffEntry = await db
      .prepare(`SELECT id FROM hotel_staff WHERE id = ? AND hotel_id IN (${placeholders})`)
      .bind(Number(staff_id), ...ownerHotelIds)
      .first();
    if (!staffEntry) {
      return new Response(
        JSON.stringify({ error: 'Staff entry not found or does not belong to your hotel' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    await db.prepare('DELETE FROM hotel_staff WHERE id = ?').bind(Number(staff_id)).run();
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Failed to remove staff' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
