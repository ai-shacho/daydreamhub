import type { APIRoute } from 'astro';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function createJWT(payload: Record<string, any>, secret: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${body}`)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${header}.${body}.${signature}`;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email and password required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const runtime = (locals as any).runtime;
    const db = runtime?.env?.DB;
    const jwtSecret = runtime?.env?.JWT_SECRET || "dev-secret";

    if (!db) {
      return new Response(JSON.stringify({ error: "Database not available" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const user = await db.prepare(
      "SELECT id, name, email, password_hash, role FROM users WHERE email = ?"
    ).bind(email).first();

    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid email or password" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Verify password (SHA-256 hash comparison)
    const inputHash = await hashPassword(password);
    if (inputHash !== user.password_hash) {
      return new Response(JSON.stringify({ error: "Invalid email or password" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Check role
    if (user.role !== "admin" && user.role !== "owner" && user.role !== "staff") {
      return new Response(JSON.stringify({ error: "Unauthorized role" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Create JWT
    const token = await createJWT({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
    }, jwtSecret);

    return new Response(JSON.stringify({
      token,
      role: user.role,
      name: user.name
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
