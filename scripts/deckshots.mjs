/**
 * Screenshots for the project deck — real corpus, real scheme names, real links.
 *
 * Viewport crops rather than full-page: against the real corpus a search returns
 * 9 eligible and 39 likely, so a full-page capture is 20,000px tall and useless
 * on a slide.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5188';
const OUT = '/tmp/deckshots';
mkdirSync(OUT, { recursive: true });

const QUERY = 'I am 33, a farmer in Telangana with 1.5 acres, my yearly income is about 1.5 lakh';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function shot(name, size, fn, fullPage = false) {
  const ctx = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await fn(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  await ctx.close();
  console.log('✓', name);
}

// 1240 rather than 1500: the app centres its content at max-w-6xl (1152px), so a
// wider viewport bakes ~120px of empty page background into each side of the
// capture, and on a slide that reads as a badly cropped, undersized screenshot.
const WIDE = { width: 1240, height: 880 };
const PHONE = { width: 390, height: 844 };

async function search(p) {
  await p.goto(`${BASE}/en`, { waitUntil: 'networkidle' });
  await p.fill('#situation', QUERY);
  await p.getByRole('button', { name: /find my schemes/i }).click();
  await p.waitForSelector('#h-yes', { timeout: 30000 });
  await p.waitForTimeout(1500);
}

await shot('hero', WIDE, async (p) => {
  await p.goto(`${BASE}/en`, { waitUntil: 'networkidle' });
});

await shot('welcome', WIDE, async (p) => {
  await p.goto(`${BASE}/en/welcome`, { waitUntil: 'networkidle' });
});

await shot('results', WIDE, async (p) => {
  await search(p);
  await p.locator('#summary-h').scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -24));
  await p.waitForTimeout(400);
});

await shot('evidence', WIDE, async (p) => {
  await search(p);
  await p.getByRole('button', { name: /^Why\?/ }).first().click();
  await p.waitForTimeout(600);
  // Put the group heading at the very top: the summary panel above it is a
  // separate slide's subject, and half of it bleeding into frame reads as a
  // cropping accident.
  await p.evaluate(() => {
    document.querySelector('#h-yes')?.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -18);
  });
  await p.waitForTimeout(400);
});

await shot('phone-results', PHONE, async (p) => {
  await search(p);
  // Land on the group heading, not part-way through a button: an arbitrary
  // offset sliced a control in half and left a stray dark bar at the top edge.
  await p.evaluate(() => {
    document.querySelector('#h-yes')?.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -14);
  });
  await p.waitForTimeout(400);
});

await browser.close();
