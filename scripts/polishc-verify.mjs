import { existsSync, readdirSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const baseUrl = process.argv[2] || 'http://localhost:5199/';
const outputDir = join(process.cwd(), 'scratchpad', 'verify');
mkdirSync(outputDir, { recursive: true });

function fullChromium() {
  const bundled = chromium.executablePath();
  if (existsSync(bundled) && !bundled.includes('chromium_headless_shell')) return bundled;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const revisions = readdirSync(cache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .sort((a, b) => Number(b.name.slice(9)) - Number(a.name.slice(9)));
  for (const revision of revisions) {
    const executable = join(
      cache, revision.name, 'chrome-mac-arm64',
      'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing',
    );
    if (existsSync(executable)) return executable;
  }
  return bundled;
}

// Ink bounding box of the light glyph inside a dark round button, in CSS px offsets.
function inkOffset(file, scale) {
  const png = PNG.sync.read(readFileSync(file));
  let minY = Infinity; let maxY = -Infinity; let minX = Infinity; let maxX = -Infinity;
  const x0 = Math.floor(png.width * 0.18); const x1 = Math.ceil(png.width * 0.82);
  const y0 = Math.floor(png.height * 0.1); const y1 = Math.ceil(png.height * 0.9);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (png.width * y + x) << 2;
      if ((png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3 > 150) {
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
      }
    }
  }
  return {
    dy: +(((minY + maxY) / 2 - png.height / 2) / scale).toFixed(2),
    dx: +(((minX + maxX) / 2 - png.width / 2) / scale).toFixed(2),
    inkH: +((maxY - minY) / scale).toFixed(1),
    inkW: +((maxX - minX) / scale).toFixed(1),
  };
}

const browser = await chromium.launch({
  executablePath: fullChromium(),
  headless: false,
  args: ['--headless=new', '--use-angle=metal', '--enable-unsafe-webgpu'],
});

const results = { arrows: {}, language: [], consoleErrors: [] };
const scale = 2;

async function newPage(context, width, height) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  page.on('console', (m) => { if (m.type() === 'error') results.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => results.consoleErrors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#lightbox'), null, { timeout: 30000 });
  return page;
}

// ---- 1. lightbox arrow centring, desktop + mobile -------------------------
for (const [label, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
  const context = await browser.newContext({ deviceScaleFactor: scale });
  const page = await newPage(context, width, height);
  await page.evaluate(() => document.querySelector('.lightbox-trigger')?.click());
  await page.waitForTimeout(800);
  const shots = {};
  for (const [name, selector] of [['prev', '.lightbox-previous'], ['next', '.lightbox-next'], ['close', '.lightbox-close']]) {
    const file = join(outputDir, `polishc-arrows-${label}-${name}.png`);
    const el = await page.$(selector);
    await el.screenshot({ path: file });
    shots[name] = inkOffset(file, scale);
  }
  results.arrows[label] = shots;
  await page.screenshot({ path: join(outputDir, `polishc-lightbox-${label}.png`) });
  await context.close();
}

// ---- 2. CTA section, FR then EN ------------------------------------------
{
  const context = await browser.newContext({ deviceScaleFactor: scale, locale: 'fr-FR' });
  const page = await newPage(context, 1440, 900);
  await page.waitForSelector('#visite');
  const section = await page.$('#visite');
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await section.screenshot({ path: join(outputDir, 'polishc-cta-fr.png') });
  results.ctaFr = await page.evaluate(() => {
    const link = document.querySelector('.cta-button');
    return {
      kicker: document.querySelector('.cta-kicker').textContent,
      headline: document.querySelector('.cta-headline').textContent,
      body: document.querySelector('.cta-body').textContent,
      button: link.textContent,
      href: link.getAttribute('href'),
      target: link.getAttribute('target'),
      rel: link.getAttribute('rel'),
      isLastSection: document.querySelector('#document').lastElementChild.id,
      nextElement: document.querySelector('#visite').nextElementSibling?.className || '(end of main)',
    };
  });
  await page.click('#lang-toggle');
  await page.waitForTimeout(400);
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: join(outputDir, 'polishc-cta-en.png') });
  results.ctaEn = await page.evaluate(() => ({
    kicker: document.querySelector('.cta-kicker').textContent,
    headline: document.querySelector('.cta-headline').textContent,
    body: document.querySelector('.cta-body').textContent,
    button: document.querySelector('.cta-button').textContent,
    aria: document.querySelector('.cta-button').getAttribute('aria-label'),
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.click('#lang-toggle');
  await page.waitForTimeout(400);
  await (await page.$('#visite')).scrollIntoViewIfNeeded();
  await (await page.$('#visite')).screenshot({ path: join(outputDir, 'polishc-cta-mobile-fr.png') });
  await context.close();
}

// ---- 3. browser-language default ----------------------------------------
const languageCases = [
  ['fr-FR, no stored choice', { locale: 'fr-FR' }, null],
  ['en-US, no stored choice', { locale: 'en-US' }, null],
  ['de-DE, no stored choice', { locale: 'de-DE' }, null],
  ['fr-CA, no stored choice', { locale: 'fr-CA' }, null],
  ['de-DE, stored fr', { locale: 'de-DE' }, 'fr'],
  ['fr-FR, stored en', { locale: 'fr-FR' }, 'en'],
];
for (const [label, options, stored] of languageCases) {
  const context = await browser.newContext({ ...options, deviceScaleFactor: 1 });
  if (stored) {
    await context.addInitScript((value) => {
      localStorage.setItem('pascal-listing-language', value);
    }, stored);
  }
  const page = await context.newPage();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('#visite');
  results.language.push({
    case: label,
    navigatorLanguages: await page.evaluate(() => navigator.languages.join(',')),
    htmlLang: await page.evaluate(() => document.documentElement.lang),
    toggle: await page.evaluate(() => document.querySelector('#lang-toggle').textContent),
    ctaHeadline: await page.evaluate(() => document.querySelector('.cta-headline').textContent),
  });
  await context.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
