const PAYPAL_API_BASE: Record<string, string> = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

function getBaseUrl(mode?: string): string {
  return PAYPAL_API_BASE[mode || 'sandbox'] || PAYPAL_API_BASE.sandbox;
}

export async function getAccessToken(clientId: string, secret: string, mode: string = 'sandbox'): Promise<string> {
  const base = getBaseUrl(mode);
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`PayPal auth failed: ${res.status} ${errorText}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function createOrder(accessToken: string, amount: number, mode: string = 'sandbox', description?: string): Promise<string> {
  const base = getBaseUrl(mode);
  const res = await fetch(`${base}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: 'USD',
            value: amount.toFixed(2),
          },
          ...(description ? { description } : {}),
        },
      ],
    }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`PayPal create order failed: ${res.status} ${errorText}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function captureOrder(accessToken: string, orderId: string, mode: string = 'sandbox'): Promise<any> {
  const base = getBaseUrl(mode);
  const res = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`PayPal capture failed: ${res.status} ${errorText}`);
  }
  return await res.json();
}

export async function refundCapture(accessToken: string, captureId: string, mode: string = 'sandbox', amount?: number): Promise<any> {
  const base = getBaseUrl(mode);
  const body: any = {};
  const res = await fetch(`${base}/v2/payments/captures/${captureId}/refund`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`PayPal refund failed: ${res.status} ${errorText}`);
  }
  return await res.json();
}
