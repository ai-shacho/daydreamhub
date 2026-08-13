// Capture PWA manifest screenshots from the live /app.
// Read-only: loads the page and shoots it. No clicks, no API side effects.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.APP_BASE || 'https://www.daydreamhub.com';
const OUT = 'public/app-screenshots';

const SHOTS = [
  { name: 'narrow-1', width: 412, height: 915, scrollY: 0 },
  { name: 'narrow-2', width: 412, height: 915, scrollY: 700 },
  { name: 'wide-1', width: 1280, height: 800, scrollY: 0 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const s of SHOTS) {
  const ctx = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: 1,
    isMobile: s.width < 800,
    hasTouch: s.width < 800,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle', timeout: 60000 });
  if (s.scrollY) {
    await page.evaluate((y) => window.scrollTo(0, y), s.scrollY);
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  console.log(`${s.name}.png  ${s.width}x${s.height}`);
  await ctx.close();
}

await browser.close();
