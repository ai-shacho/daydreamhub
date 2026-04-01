function b64Decode(str: string): string {
  // URL-safe base64 → standard base64 + padding
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  return atob(pad ? s + '='.repeat(4 - pad) : s);
}

export async function verifyAdmin(request: Request, jwtSecret: string) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/ddh_token=([^;]+)/);
  if (!match) return null;
  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  // ownerAuth.ts と同じフォールバック: dev-secret の場合は ddh-secret-2025 を使用
  const secret = (jwtSecret && jwtSecret !== 'dev-secret') ? jwtSecret : 'ddh-secret-2025';
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sig = Uint8Array.from(b64Decode(parts[2]), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sig,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(b64Decode(parts[1]));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role !== "admin") return null;
    return payload;
  } catch {
    return null;
  }
}
