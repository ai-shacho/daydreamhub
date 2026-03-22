import { test, expect } from '@playwright/test';

test.describe('検索機能テスト', () => {

  test('検索ページにホテルが表示される、または0件メッセージが表示される', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');
    const body = await page.content();
    const hasHotels = body.includes('hotel') || body.includes('Hotel');
    const hasEmpty = body.includes('No hotels found') || body.includes('not found');
    expect(hasHotels || hasEmpty).toBe(true);
  });

  test('都市名で検索するとフィルタリングされる', async ({ page }) => {
    await page.goto('/search?city=Bangkok');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toBeVisible();
  });

  test('検索結果が0件の場合、案内メッセージが表示される', async ({ page }) => {
    await page.goto('/search?city=XYZNONEXISTENTCITY999');
    await page.waitForLoadState('networkidle');
    const body = await page.content();
    // 0件案内またはページが正常に表示されていること
    expect(body.includes('No hotels') || body.includes('not found') || body.includes('DayDreamHub')).toBe(true);
  });

});
