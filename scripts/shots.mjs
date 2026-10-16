import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5188';
const OUT = '/tmp/shots';
mkdirSync(OUT, { recursive: true });

const QUERY = 'I am 33, a farmer in Telangana with 1.5 acres, my yearly income is about 1.5 lakh';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function shot(name, { width, height }, fn) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await fn(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await ctx.close();
  console.log('✓', name);
}

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

await shot('01-welcome-desktop', DESKTOP, async (p) => {
  await p.goto(`${BASE}/en/welcome`, { waitUntil: 'networkidle' });
});

await shot('02-welcome-phone', PHONE, async (p) => {
  await p.goto(`${BASE}/en/welcome`, { waitUntil: 'networkidle' });
});

await shot('03-hero-desktop', DESKTOP, async (p) => {
  await p.goto(`${BASE}/en`, { waitUntil: 'networkidle' });
});

await shot('04-hero-phone', PHONE, async (p) => {
  await p.goto(`${BASE}/en`, { waitUntil: 'networkidle' });
});

async function results(p) {
  await p.goto(`${BASE}/en`, { waitUntil: 'networkidle' });
  await p.fill('#situation', QUERY);
  await p.getByRole('button', { name: /find my schemes/i }).click();
  await p.waitForSelector('#h-yes', { timeout: 20000 });
  // Let the deterministic summary land too.
  await p.waitForTimeout(1200);
}

await shot('05-results-desktop', DESKTOP, results);
await shot('06-results-phone', PHONE, results);

await shot('07-evidence-desktop', DESKTOP, async (p) => {
  await results(p);
  // Open the clause list on the first card: the quoted sentence is the point.
  await p.getByRole('button', { name: /^Why\?/ }).first().click();
  await p.waitForTimeout(500);
});

await shot('08-hero-hindi-phone', PHONE, async (p) => {
  await p.goto(`${BASE}/hi`, { waitUntil: 'networkidle' });
});

await browser.close();
