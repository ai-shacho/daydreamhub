export async function verifyAdmin(request: Request, jwtSecret: string) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/auth_token=([^;]+)/);
  if (!match) return null;
  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sig = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sig,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role !== "admin") return null;
    return payload;
  } catch {
    return null;
  }
}
