import { test, expect } from '@playwright/test';

test.describe('ページ表示テスト', () => {

  test('トップページが正常に表示される', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/DayDreamHub/i);
    // ヒーローセクションが存在する
    await expect(page.locator('header')).toBeVisible();
  });

  test('検索ページが正常に表示される', async ({ page }) => {
    await page.goto('/search');
    await expect(page).toHaveTitle(/DayDreamHub/i);
    // 検索フォームまたはホテル一覧が表示される
    await expect(page.locator('main')).toBeVisible();
  });

  test('存在しないページで404ページが表示される', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist-xyz');
    // 404ステータスまたは404コンテンツが表示される
    const body = await page.content();
    const is404 =
      response?.status() === 404 ||
      body.includes('404') ||
      body.includes('Page not found') ||
      body.includes('not found');
    expect(is404).toBe(true);
  });

  test('ブログページが正常に表示される', async ({ page }) => {
    await page.goto('/blog');
    await expect(page.locator('main')).toBeVisible();
  });

  test('お問い合わせページが正常に表示される', async ({ page }) => {
    await page.goto('/contact');
    await expect(page.locator('main')).toBeVisible();
  });

  test('利用規約ページが正常に表示される', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.locator('main, article, section').first()).toBeVisible();
  });

  test('プライバシーポリシーページが正常に表示される', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('main, article, section').first()).toBeVisible();
  });

});
