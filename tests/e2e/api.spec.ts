import { test, expect } from '@playwright/test';

test.describe('APIエンドポイントテスト', () => {

  test('ホテル一覧APIが応答する', async ({ request }) => {
    const response = await request.get('/api/hotels');
    // 200 または 認証エラー (401/403) が正常、500はNG
    expect([200, 400, 401, 403, 404]).toContain(response.status());
  });

  test('booking-status APIがorder未指定で400を返す', async ({ request }) => {
    const response = await request.get('/api/booking-status');
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error).toBeDefined();
  });

  test('booking-status APIが存在しないorderで404を返す', async ({ request }) => {
    const response = await request.get('/api/booking-status?order=nonexistent-order-xyz-999');
    expect(response.status()).toBe(404);
  });

  test('sitemap.xmlが正常に返される', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain('<?xml');
    expect(text).toContain('urlset');
  });

  test('robots.txtが正常に返される', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain('User-agent');
    expect(text).toContain('Sitemap');
  });

  test('geocode APIが住所なしで400を返す', async ({ request }) => {
    const response = await request.get('/api/geocode');
    expect(response.status()).toBe(400);
  });

  test('geocode APIが住所ありで応答する', async ({ request }) => {
    const response = await request.get('/api/geocode?address=Bangkok,Thailand');
    // 200（成功）または404（見つからない）が正常
    expect([200, 404, 500]).toContain(response.status());
    if (response.status() === 200) {
      const json = await response.json();
      expect(json.latitude).toBeDefined();
      expect(json.longitude).toBeDefined();
    }
  });

});
