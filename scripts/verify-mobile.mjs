import { chromium } from 'playwright';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUTPUT = join(ROOT, 'scratchpad', 'verify');
const BASE_URL = process.env.MOBILE_VERIFY_URL || 'http://127.0.0.1:4173';
const beats = [
  ['hero', 0],
  ['staging', 3],
  ['balcon', 4],
  ['chambre1', 5],
  ['salledeau', 6],
  ['plan', 8],
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForFunction(
  () => document.documentElement.dataset.modelReady === '1' && window.__listing?.backend,
  null,
  { timeout: 30_000 },
);

const report = { viewport: '390x844', backend: await page.evaluate(() => window.__listing.backend), probes: [] };
for (const [beat, index] of beats) {
  await page.evaluate((beatIndex) => {
    document.documentElement.style.scrollBehavior = 'auto';
    const track = document.querySelector('#story-track');
    window.scrollTo({ top: track.offsetTop + beatIndex * innerHeight, behavior: 'instant' });
  }, index);
  await page.waitForFunction((expected) => window.__listing?.beat === expected, beat, { timeout: 10_000 });
  await page.waitForTimeout(1_400);

  const details = await page.evaluate((beatId) => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right),
        width: Math.round(box.width), height: Math.round(box.height), display: style.display, visibility: style.visibility,
        opacity: Number(style.opacity),
      };
    };
    const controls = {
      staging: rect('#staging-picker'),
      balcon: rect('#sun-scrub'),
      chambre1: rect("[data-photo-beat='chambre1']"),
      salledeau: rect("[data-photo-beat='salledeau']"),
      plan: rect('#plan-panel'),
    };
    return {
      beat: window.__listing.beat,
      card: rect(`.beat-card[data-beat='${beatId}']`),
      control: controls[beatId],
      activeFeatures: {
        staging: document.querySelector('#staging-picker').classList.contains('is-active'),
        sun: document.querySelector('#sun-scrub').classList.contains('is-active'),
        photoCard: Boolean(document.querySelector(`[data-photo-beat='${beatId}']`))
          && Number(getComputedStyle(document.querySelector(`[data-photo-beat='${beatId}']`)).opacity) > 0.9,
      },
    };
  }, beat);
  if (details.card.width < 350) throw new Error(`${beat} card is squeezed: ${JSON.stringify(details.card)}`);
  if (details.control && details.control.visibility !== 'hidden' && details.control.opacity > 0
      && details.control.bottom > details.card.top + 1) {
    throw new Error(`${beat} control overlaps its copy sheet: ${JSON.stringify(details)}`);
  }
  const expectedFeature = { staging: 'staging', balcon: 'sun', chambre1: 'photoCard', salledeau: 'photoCard' }[beat];
  for (const [feature, isActive] of Object.entries(details.activeFeatures)) {
    if (isActive !== (feature === expectedFeature)) {
      throw new Error(`${beat} has incorrect active feature state: ${JSON.stringify(details.activeFeatures)}`);
    }
  }
  await page.screenshot({ path: join(OUTPUT, `p3-mobile-${beat}.png`) });
  report.probes.push(details);
}

await page.locator('.plan-toggle').click();
await page.waitForTimeout(150);
const expanded = await page.evaluate(() => ({
  expanded: document.querySelector('#plan-panel').classList.contains('is-expanded'),
  labelsHidden: getComputedStyle(document.querySelector('#zone-label-layer')).visibility === 'hidden',
  ariaExpanded: document.querySelector('.plan-toggle').getAttribute('aria-expanded'),
}));
if (!expanded.expanded || !expanded.labelsHidden || expanded.ariaExpanded !== 'true') {
  throw new Error(`Plan overlay state failed: ${JSON.stringify(expanded)}`);
}
await page.screenshot({ path: join(OUTPUT, 'p3-mobile-plan-expanded.png') });

const firstZone = page.locator('.plan-zone').first();
await firstZone.click();
const selection = await page.evaluate(() => ({
  selected: document.querySelectorAll('.plan-zone.is-selected').length,
  actionVisible: !document.querySelector('.plan-room-action').hidden,
  browsing: window.__listing.story.browsing,
}));
if (selection.selected !== 1 || !selection.actionVisible || selection.browsing) {
  throw new Error(`First room tap did not select: ${JSON.stringify(selection)}`);
}
await firstZone.click();
await page.waitForTimeout(100);
if (!await page.evaluate(() => window.__listing.story.browsing)) {
  throw new Error('Second room tap did not fly to the room');
}
await page.evaluate(() => window.__listing.story.resumeStory());
await page.locator('#lang-toggle').click();
await page.waitForTimeout(100);
const englishAffordance = await page.locator('.plan-toggle').textContent();
if (!englishAffordance.startsWith('View plan')) {
  throw new Error(`English plan affordance was not rebuilt: ${JSON.stringify(englishAffordance)}`);
}

if (consoleErrors.length || pageErrors.length) {
  throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors, pageErrors }, null, 2)}`);
}
report.planOverlay = expanded;
report.planTap = selection;
report.englishAffordance = englishAffordance;
report.consoleErrors = consoleErrors;
report.pageErrors = pageErrors;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await browser.close();
