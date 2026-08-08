// Minimal Web Push (VAPID) for Cloudflare Workers.
//
// Payload-less push: we only wake the service worker, which then fetches the
// notification text from /api/app/push-pending. That avoids the aes128gcm
// payload encryption entirely — only the VAPID JWT (ES256) is needed, which
// WebCrypto provides natively.

const VAPID_SUBJECT = 'mailto:contact@daydreamhub.com';

function b64url(buf: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof buf === 'string') bytes = new TextEncoder().encode(buf);
  else bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface VapidKeys {
  publicKey: string; // base64url raw point, handed to the browser
  privateJwk: JsonWebKey;
}

// Keypair lives in app_settings so no new deploy secret is required. Generated
// once, then reused forever (rotating it would orphan existing subscriptions).
export async function getVapidKeys(db: any): Promise<VapidKeys | null> {
  try {
    const row: any = await db
      .prepare("SELECT value FROM app_settings WHERE key = 'vapid_keys'")
      .first();
    if (row?.value) return JSON.parse(row.value);

    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
    const keys: VapidKeys = {
      publicKey: b64url(raw),
      privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
    };
    await db
      .prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('vapid_keys', ?, datetime('now')) ON CONFLICT(key) DO NOTHING"
      )
      .bind(JSON.stringify(keys))
      .run();
    // Re-read: a concurrent request may have won the insert.
    const after: any = await db
      .prepare("SELECT value FROM app_settings WHERE key = 'vapid_keys'")
      .first();
    return after?.value ? JSON.parse(after.value) : keys;
  } catch (e) {
    console.error('[webpush] getVapidKeys failed', e);
    return null;
  }
}

export async function vapidHeader(keys: VapidKeys, audience: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'jwk',
    keys.privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      sub: VAPID_SUBJECT,
    })
  );
  const signed = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signed)
  );
  return `vapid t=${signed}.${b64url(sig)}, k=${keys.publicKey}`;
}

// Wakes every device subscribed for this session. Dead subscriptions (404/410)
// are pruned. Never throws — push is best-effort next to the email path.
export async function pushToSession(env: any, sessionId: string): Promise<number> {
  const db = env?.DB;
  if (!db || !sessionId) return 0;
  try {
    const keys = await getVapidKeys(db);
    if (!keys) return 0;
    const rows = await db
      .prepare('SELECT endpoint FROM app_push_subscriptions WHERE session_id = ?')
      .bind(sessionId)
      .all();
    let sent = 0;
    for (const row of (rows.results || []) as any[]) {
      const endpoint = String(row.endpoint || '');
      if (!/^https:\/\//.test(endpoint)) continue;
      try {
        const aud = new URL(endpoint).origin;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: await vapidHeader(keys, aud),
            TTL: '86400',
            Urgency: 'high',
            'Content-Length': '0',
          },
        });
        if (res.status === 404 || res.status === 410) {
          await db
            .prepare('DELETE FROM app_push_subscriptions WHERE endpoint = ?')
            .bind(endpoint)
            .run()
            .catch(() => {});
        } else if (res.ok || res.status === 201 || res.status === 202) {
          sent++;
        } else {
          console.error('[webpush] send failed', res.status, await res.text().catch(() => ''));
        }
      } catch (e) {
        console.error('[webpush] endpoint error', e);
      }
    }
    return sent;
  } catch (e) {
    console.error('[webpush] pushToSession failed', e);
    return 0;
  }
}
