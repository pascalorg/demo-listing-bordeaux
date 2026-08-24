#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) throw new Error('Usage: bun scripts/wow1-verify.mjs http://127.0.0.1:<port>/?forceWebGL=1');

const output = join(process.cwd(), 'scratchpad', 'verify');
mkdirSync(output, { recursive: true });

function fullChromium() {
  const bundled = chromium.executablePath();
  if (existsSync(bundled) && !bundled.includes('chromium_headless_shell')) return bundled;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const revisions = readdirSync(cache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .sort((a, b) => Number(b.name.slice(9)) - Number(a.name.slice(9)));
  for (const revision of revisions) {
    const executable = join(
      cache,
      revision.name,
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    );
    if (existsSync(executable)) return executable;
  }
  return bundled;
}

const report = { url, backend: null, desktop: {}, mobile: {}, consoleErrors: [], pageErrors: [] };
const browser = await chromium.launch({ executablePath: fullChromium(), headless: true });

async function openPage(viewport, label, mobile = false, reduceMotion = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
    reducedMotion: reduceMotion ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(`${label}: ${message.text()}`);
  });
  page.on('pageerror', (error) => report.pageErrors.push(`${label}: ${error.stack || error.message}`));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => window.__listing?.backend, null, { timeout: 30_000 });
  await page.waitForFunction(() => document.documentElement.dataset.modelReady === '1');
  await page.waitForTimeout(1_000);
  return { context, page };
}

async function showBeat(page, index, id) {
  await page.evaluate((beatIndex) => window.scrollTo({ top: beatIndex * innerHeight, behavior: 'instant' }), index);
  await page.waitForFunction((beatId) => window.__listing?.beat === beatId, id, { timeout: 10_000 });
  await page.waitForTimeout(1_500);
}

try {
  const desktop = await openPage({ width: 1440, height: 900 }, 'desktop');
  const page = desktop.page;
  report.backend = await page.evaluate(() => window.__listing.backend);

  report.desktop.hero = await page.evaluate(() => {
    const cue = document.querySelector('.scroll-cue');
    const capsule = document.querySelector('.chapter-rail-capsule');
    const cueScrim = getComputedStyle(cue, '::before');
    return {
      cueOpacity: getComputedStyle(cue).opacity,
      cueColor: getComputedStyle(cue).color,
      scrim: cueScrim.backgroundImage,
      capsuleBackground: getComputedStyle(capsule).backgroundColor,
      capsuleBorderRadius: getComputedStyle(capsule).borderRadius,
      capsuleWidth: capsule.getBoundingClientRect().width,
    };
  });
  if (report.desktop.hero.cueOpacity !== '1'
      || !report.desktop.hero.scrim.includes('linear-gradient')
      || report.desktop.hero.capsuleWidth < 25) {
    throw new Error(`Hero scrim/capsule check failed: ${JSON.stringify(report.desktop.hero)}`);
  }
  await page.screenshot({ path: join(output, 'wow1-hero-scrim-dots.png') });

  await showBeat(page, 1, 'floor');
  report.desktop.floor = await page.evaluate(() => [...document.querySelectorAll('.zone-label:not([hidden])')].map((label) => ({
    label: label.textContent,
    opacity: Number(getComputedStyle(label).opacity),
    background: getComputedStyle(label).backgroundColor,
    color: getComputedStyle(label).color,
  })));
  if (report.desktop.floor.length < 6
      || report.desktop.floor.some((label) => label.opacity < 0.999 || label.background.includes('/'))) {
    throw new Error(`Floor labels are not fully opaque: ${JSON.stringify(report.desktop.floor)}`);
  }
  await page.screenshot({ path: join(output, 'wow1-floor-opaque-labels.png') });

  await showBeat(page, 4, 'balcon');
  await page.waitForFunction(() => document.querySelector('.sun-scrub.is-active'));
  const firstHour = await page.locator('#sun-range').inputValue();
  const firstLabel = await page.locator('.sun-scrub output').textContent();
  await page.screenshot({ path: join(output, 'wow1-balcon-autoplay-1.png') });
  await page.waitForTimeout(5_000);
  const secondHour = await page.locator('#sun-range').inputValue();
  const secondLabel = await page.locator('.sun-scrub output').textContent();
  await page.screenshot({ path: join(output, 'wow1-balcon-autoplay-2.png') });
  report.desktop.balcon = {
    firstHour: Number(firstHour), firstLabel, secondHour: Number(secondHour), secondLabel,
    elapsedWithoutInputMs: 5_000,
  };
  if (Number(secondHour) - Number(firstHour) < 1.4 || firstLabel === secondLabel) {
    throw new Error(`Sun did not autoplay: ${JSON.stringify(report.desktop.balcon)}`);
  }
  await showBeat(page, 1, 'floor');
  const stoppedHour = Number(await page.locator('#sun-range').inputValue());
  await page.waitForTimeout(1_200);
  const stoppedHourAfterWait = Number(await page.locator('#sun-range').inputValue());
  await showBeat(page, 4, 'balcon');
  const resumedHour = Number(await page.locator('#sun-range').inputValue());
  await page.locator('#sun-range').press('ArrowRight');
  const touchedHour = Number(await page.locator('#sun-range').inputValue());
  await page.waitForTimeout(1_200);
  const touchedHourAfterWait = Number(await page.locator('#sun-range').inputValue());
  report.desktop.balcon.stopResumeAndTouch = {
    stoppedHour, stoppedHourAfterWait, resumedHour, touchedHour, touchedHourAfterWait,
  };
  if (stoppedHour !== stoppedHourAfterWait || resumedHour <= stoppedHour
      || touchedHour !== touchedHourAfterWait) {
    throw new Error(`Sun stop/resume/touch behavior failed: ${JSON.stringify(report.desktop.balcon)}`);
  }

  await showBeat(page, 5, 'chambre1');
  const photoButton = page.locator('.beat-photo-tabs button[data-style="photo"]');
  const japandiButton = page.locator('.beat-photo-tabs button[data-style="japandi"]');
  await photoButton.waitFor({ state: 'visible' });
  report.desktop.suiteHitTarget = await japandiButton.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return { tag: hit?.tagName, style: hit?.dataset?.style || null, pointerEvents: getComputedStyle(button).pointerEvents };
  });
  if (report.desktop.suiteHitTarget.style !== 'japandi') {
    throw new Error(`Suite chip is not the hit target: ${JSON.stringify(report.desktop.suiteHitTarget)}`);
  }
  await page.screenshot({ path: join(output, 'wow1-suite-photo-chip.png') });
  await page.evaluate(() => window.scrollTo({ top: 5.36 * innerHeight, behavior: 'instant' }));
  await page.waitForTimeout(800);
  report.desktop.suiteOffCenter = await page.locator('.beat-photo-card[data-photo-beat="chambre1"]').evaluate((card) => ({
    storyValue: window.__listing.story.value,
    opacity: Number(getComputedStyle(card).opacity),
    pointerEvents: getComputedStyle(card).pointerEvents,
  }));
  if (report.desktop.suiteOffCenter.opacity >= 0.92
      || report.desktop.suiteOffCenter.opacity <= 0.35
      || report.desktop.suiteOffCenter.pointerEvents !== 'auto') {
    throw new Error(`Visible off-centre suite chips are not interactive: ${JSON.stringify(report.desktop.suiteOffCenter)}`);
  }
  await showBeat(page, 5, 'chambre1');
  await japandiButton.click();
  await page.waitForFunction(() => {
    const current = document.querySelector('.beat-photo-card img.is-current');
    return current?.src.endsWith('/chambre1-japandi.webp')
      && current.complete && current.naturalWidth > 0 && Number(getComputedStyle(current).opacity) === 1;
  }, null, { timeout: 15_000 });
  report.desktop.suiteSelected = await page.evaluate(() => ({
    selected: document.querySelector('.beat-photo-tabs button[aria-pressed="true"]')?.dataset.style,
    image: new URL(document.querySelector('.beat-photo-card img.is-current').src).pathname,
  }));
  if (report.desktop.suiteSelected.selected !== 'japandi') throw new Error('Suite click did not switch the image');
  await page.screenshot({ path: join(output, 'wow1-suite-japandi-chip.png') });

  await showBeat(page, 3, 'staging');
  report.desktop.stagingControls = await page.locator('.staging-picker button').first().evaluate((button) => ({
    borderRadius: getComputedStyle(button).borderRadius,
    minHeight: getComputedStyle(button).minHeight,
  }));
  if (report.desktop.stagingControls.borderRadius !== '999px') {
    throw new Error(`Staging controls do not share the pill language: ${JSON.stringify(report.desktop.stagingControls)}`);
  }
  await page.screenshot({ path: join(output, 'wow1-staging-pill-row.png') });

  await page.locator('#details').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  report.desktop.facts = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.fact-chip')];
    const rows = new Map();
    chips.forEach((chip) => {
      const box = chip.getBoundingClientRect();
      const key = Math.round(box.top);
      rows.set(key, (rows.get(key) || 0) + 1);
    });
    return {
      chips: chips.length,
      icons: document.querySelectorAll('.fact-icon').length,
      dpe: document.querySelector('.fact-dpe-badge')?.textContent,
      ges: document.querySelector('.fact-ges-badge')?.textContent,
      rows: [...rows.values()],
    };
  });
  if (report.desktop.facts.chips !== 11 || report.desktop.facts.icons < 8
      || JSON.stringify(report.desktop.facts.rows) !== JSON.stringify([4, 4, 3])) {
    throw new Error(`Desktop facts layout failed: ${JSON.stringify(report.desktop.facts)}`);
  }
  await page.screenshot({ path: join(output, 'wow1-facts-icons-dpe-grid.png') });
  await page.locator('.fact-chip-diagnostic').click();
  await page.locator('#lightbox:not([hidden])').waitFor();
  const diagnosticSource = await page.locator('.lightbox-frame img').getAttribute('src');
  report.desktop.facts.diagnosticLightbox = diagnosticSource;
  if (!diagnosticSource.endsWith('/dpe.jpeg')) throw new Error(`DPE badge opened the wrong asset: ${diagnosticSource}`);
  await page.locator('.lightbox-close').click();
  await desktop.context.close();

  const mobile = await openPage({ width: 390, height: 844 }, 'mobile', true);
  await mobile.page.locator('#details').scrollIntoViewIfNeeded();
  await mobile.page.waitForTimeout(400);
  report.mobile.facts = await mobile.page.evaluate(() => {
    const grid = document.querySelector('.facts-grid');
    const chips = [...grid.children];
    const rows = new Map();
    chips.forEach((chip) => {
      const box = chip.getBoundingClientRect();
      const key = Math.round(box.top);
      rows.set(key, (rows.get(key) || 0) + box.width);
    });
    return {
      gridWidth: grid.getBoundingClientRect().width,
      rowWidths: [...rows.values()],
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      dpeWidth: document.querySelector('.fact-chip-diagnostic').getBoundingClientRect().width,
    };
  });
  if (report.mobile.facts.pageOverflow
      || report.mobile.facts.rowWidths.some((width) => width < report.mobile.facts.gridWidth * 0.9)) {
    throw new Error(`Mobile facts layout failed: ${JSON.stringify(report.mobile.facts)}`);
  }
  await mobile.context.close();

  const reduced = await openPage({ width: 1280, height: 800 }, 'reduced-motion', false, true);
  await showBeat(reduced.page, 4, 'balcon');
  const reducedHour = Number(await reduced.page.locator('#sun-range').inputValue());
  await reduced.page.waitForTimeout(1_500);
  const reducedHourAfterWait = Number(await reduced.page.locator('#sun-range').inputValue());
  report.reducedMotion = { reducedHour, reducedHourAfterWait };
  if (reducedHour !== reducedHourAfterWait) {
    throw new Error(`Reduced-motion sun autoplay was not disabled: ${JSON.stringify(report.reducedMotion)}`);
  }
  await reduced.context.close();
} finally {
  await browser.close();
}

if (report.consoleErrors.length || report.pageErrors.length) {
  throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors: report.consoleErrors, pageErrors: report.pageErrors }, null, 2)}`);
}

writeFileSync(join(output, 'wow1-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
