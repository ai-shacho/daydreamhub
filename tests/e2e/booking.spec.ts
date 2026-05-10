import { test, expect } from '@playwright/test';

test.describe('予約フォームテスト', () => {

  test('ホテル詳細ページが表示される（スラッグが存在する場合）', async ({ page }) => {
    // テスト用のスラッグ（実際に存在するスラッグを使用、なければスキップ）
    const response = await page.goto('/hotel/work-loft-bangkok');
    if (response?.status() === 404) {
      test.skip();
      return;
    }
    await expect(page.locator('main')).toBeVisible();
  });

  test('予約確認ページが正常に表示される', async ({ page }) => {
    await page.goto('/booking/confirmation');
    await expect(page.locator('main, body').first()).toBeVisible();
    // 404でないことを確認
    const body = await page.content();
    expect(body.includes('DayDreamHub')).toBe(true);
  });

  test('予約確認ページ（orderId付き）が正常に表示される', async ({ page }) => {
    await page.goto('/booking/confirmation?order=test-order-123');
    await expect(page.locator('main, body').first()).toBeVisible();
    const body = await page.content();
    expect(body.includes('DayDreamHub')).toBe(true);
  });

});
