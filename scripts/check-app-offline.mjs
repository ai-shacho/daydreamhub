// Does /app still open with no network? A TWA is expected to survive that —
// Play reviewers do test it. Read-only: loads the page, cuts the network,
// reloads, and reports what rendered.
import { chromium } from 'playwright';

const BASE = process.env.APP_BASE || 'https://www.daydreamhub.com';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'allow',
});
const page = await ctx.newPage();

await page.goto(`${BASE}/app`, { waitUntil: 'networkidle', timeout: 60000 });

const registered = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration('/app');
  return !!(reg && (reg.active || reg.installing || reg.waiting));
});
console.log('service worker registered :', registered);

// Give the worker a moment to take control and fill its cache.
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(3000);

await ctx.setOffline(true);
let offlineOk = false;
let offlineText = '';
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  offlineText = (await page.locator('body').innerText()).trim().slice(0, 120);
  offlineOk = offlineText.length > 0 && !/ERR_INTERNET|no internet|can.t be reached/i.test(offlineText);
} catch (e) {
  offlineText = `reload threw: ${e.message.split('\n')[0]}`;
}
console.log('offline reload rendered   :', offlineOk);
console.log('offline first line        :', offlineText.split('\n')[0]);

await page.screenshot({ path: '/tmp/app-offline.png' });
await ctx.setOffline(false);
await browser.close();
console.log('screenshot -> /tmp/app-offline.png');
