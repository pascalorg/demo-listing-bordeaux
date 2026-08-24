#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) throw new Error('Usage: bun scripts/wow2-verify.mjs http://127.0.0.1:<port>/?forceWebGL=1');

const output = join(process.cwd(), 'scratchpad', 'verify');
await mkdir(output, { recursive: true });

const report = { url, backend: null, desktop: {}, mobile: {}, consoleErrors: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true });

async function openPage(viewport, label, mobile = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
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
  await page.evaluate((beatIndex) => {
    const track = document.querySelector('#story-track');
    window.scrollTo({ top: track.offsetTop + beatIndex * innerHeight, behavior: 'instant' });
  }, index);
  await page.waitForFunction((beatId) => window.__listing?.beat === beatId, id, { timeout: 10_000 });
  await page.waitForTimeout(1_200);
}

function rowCounts(boxes) {
  const rows = new Map();
  boxes.forEach((box) => {
    const key = Math.round(box.top);
    rows.set(key, (rows.get(key) || 0) + 1);
  });
  return [...rows.values()];
}

try {
  const desktop = await openPage({ width: 1440, height: 900 }, 'desktop');
  const page = desktop.page;
  report.backend = await page.evaluate(() => window.__listing.backend);
  await page.locator('.plan-panel.is-mini.is-active').waitFor({ timeout: 10_000 });

  report.desktop.hero = await page.evaluate(() => {
    const scrim = document.querySelector('.scroll-cue-scrim');
    const cue = document.querySelector('.scroll-cue');
    const plan = document.querySelector('.plan-panel.is-mini');
    return {
      cueOpacity: getComputedStyle(cue).opacity,
      cueTextShadow: getComputedStyle(cue).textShadow,
      scrimBackground: getComputedStyle(scrim).backgroundImage,
      scrimZ: Number(getComputedStyle(scrim).zIndex),
      planZ: Number(getComputedStyle(plan).zIndex),
      cueZ: Number(getComputedStyle(cue).zIndex),
      planBottom: Math.round(plan.getBoundingClientRect().bottom),
      dots: document.querySelectorAll('.chapter-rail button').length,
      beats: window.__listing.story.beats.length,
    };
  });
  if (report.desktop.hero.cueTextShadow !== 'none'
      || !report.desktop.hero.scrimBackground.includes('linear-gradient')
      || !(report.desktop.hero.scrimZ < report.desktop.hero.planZ
        && report.desktop.hero.planZ < report.desktop.hero.cueZ)
      || report.desktop.hero.dots !== 9
      || report.desktop.hero.beats !== 9) {
    throw new Error(`Hero stacking/dot audit failed: ${JSON.stringify(report.desktop.hero)}`);
  }
  await page.screenshot({ path: join(output, 'wow2-hero-scrim-behind-plan.png') });

  await showBeat(page, 1, 'floor');
  await page.waitForFunction(() => {
    const labels = [...document.querySelectorAll('.zone-label:not([hidden])')];
    return labels.length >= 6 && labels.every((label) => Number(getComputedStyle(label).opacity) > 0.999);
  }, null, { timeout: 10_000 });
  report.desktop.floor = await page.evaluate(() => (
    [...document.querySelectorAll('.zone-label:not([hidden])')].map((label) => ({
      text: label.textContent,
      opacity: Number(getComputedStyle(label).opacity),
      background: getComputedStyle(label).backgroundColor,
      borderRadius: getComputedStyle(label).borderRadius,
      backdropFilter: getComputedStyle(label).backdropFilter,
    }))
  ));
  if (report.desktop.floor.length < 6
      || report.desktop.floor.some((label) => label.opacity < 0.999
        || label.borderRadius !== '999px'
        || !label.background.startsWith('rgba(14, 21, 19,'))) {
    throw new Error(`Floor label audit failed: ${JSON.stringify(report.desktop.floor)}`);
  }
  await page.screenshot({ path: join(output, 'wow2-floor-pill-labels.png') });

  await page.locator('#details').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  report.desktop.facts = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.facts-grid > .fact-chip')];
    const dpe = document.querySelector('.fact-dpe-badge');
    const ges = document.querySelector('.fact-ges-badge');
    const dpeBox = dpe.getBoundingClientRect();
    const gesBox = ges.getBoundingClientRect();
    return {
      chips: chips.length,
      boxes: chips.map((chip) => {
        const box = chip.getBoundingClientRect();
        return { top: box.top, width: box.width };
      }),
      dpe: dpe.textContent.replace(/\s+/g, ' ').trim(),
      ges: ges.textContent.replace(/\s+/g, ' ').trim(),
      dpeSize: [dpeBox.width, dpeBox.height],
      gesSize: [gesBox.width, gesBox.height],
      diagnosticsElement: Boolean(document.querySelector('#diagnostics-grid, .diagnostics-block')),
      diagnosticsI18nKeys: document.querySelectorAll('[data-i18n*="diagnostic"]').length,
      documentSections: document.querySelectorAll('#document > .document-section').length,
    };
  });
  report.desktop.facts.rows = rowCounts(report.desktop.facts.boxes);
  if (report.desktop.facts.chips !== 11
      || JSON.stringify(report.desktop.facts.rows) !== JSON.stringify([4, 4, 3])
      || Math.abs(report.desktop.facts.dpeSize[0] - report.desktop.facts.gesSize[0]) > 1
      || Math.abs(report.desktop.facts.dpeSize[1] - report.desktop.facts.gesSize[1]) > 1
      || !report.desktop.facts.dpe.includes('48 kWhEP/m²/an')
      || !report.desktop.facts.ges.includes('11 kgéqCO₂/m²/an')
      || report.desktop.facts.diagnosticsElement
      || report.desktop.facts.diagnosticsI18nKeys
      || report.desktop.facts.documentSections !== 4) {
    throw new Error(`Desktop facts/removal audit failed: ${JSON.stringify(report.desktop.facts)}`);
  }
  await page.locator('.intro-section').screenshot({ path: join(output, 'wow2-facts-desktop.png') });

  await page.locator('.fact-dpe-badge').click();
  await page.locator('#lightbox:not([hidden])').waitFor();
  report.desktop.dpeLightbox = {
    source: await page.locator('.lightbox-frame img').getAttribute('src'),
    caption: await page.locator('.lightbox-frame figcaption span').first().textContent(),
  };
  await page.waitForFunction(() => {
    const image = document.querySelector('.lightbox-frame img');
    return image?.complete && image.naturalWidth > 0;
  });
  await page.screenshot({ path: join(output, 'wow2-dpe-lightbox.png') });
  await page.locator('.lightbox-close').click();

  await page.locator('.fact-ges-badge').click();
  await page.locator('#lightbox:not([hidden])').waitFor();
  report.desktop.gesLightbox = {
    source: await page.locator('.lightbox-frame img').getAttribute('src'),
    caption: await page.locator('.lightbox-frame figcaption span').first().textContent(),
  };
  await page.waitForFunction(() => {
    const image = document.querySelector('.lightbox-frame img');
    return image?.complete && image.naturalWidth > 0;
  });
  await page.screenshot({ path: join(output, 'wow2-ges-lightbox.png') });
  await page.locator('.lightbox-close').click();
  if (!report.desktop.dpeLightbox.source.endsWith('/dpe.jpeg')
      || !report.desktop.gesLightbox.source.endsWith('/dpe-ges.jpeg')) {
    throw new Error(`Energy chart lightbox audit failed: ${JSON.stringify({ dpe: report.desktop.dpeLightbox, ges: report.desktop.gesLightbox })}`);
  }

  await page.locator('#document').screenshot({ path: join(output, 'wow2-document-flow-no-diagnostics.png') });

  await page.locator('#lang-toggle').click();
  report.desktop.englishEnergy = await page.locator('.fact-energy-value').allTextContents();
  if (!report.desktop.englishEnergy.every((value) => value.endsWith('/year'))) {
    throw new Error(`English energy values were not updated: ${JSON.stringify(report.desktop.englishEnergy)}`);
  }
  await desktop.context.close();

  const mobile = await openPage({ width: 390, height: 844 }, 'mobile', true);
  await mobile.page.locator('#details').scrollIntoViewIfNeeded();
  await mobile.page.waitForTimeout(500);
  report.mobile.facts = await mobile.page.evaluate(() => {
    const grid = document.querySelector('.facts-grid');
    const chips = [...grid.children];
    const dpe = document.querySelector('.fact-dpe-badge').getBoundingClientRect();
    const ges = document.querySelector('.fact-ges-badge').getBoundingClientRect();
    const rows = new Map();
    chips.forEach((chip) => {
      const box = chip.getBoundingClientRect();
      const key = Math.round(box.top);
      rows.set(key, (rows.get(key) || 0) + box.width);
    });
    return {
      gridWidth: grid.getBoundingClientRect().width,
      rowWidths: [...rows.values()],
      dpeSize: [dpe.width, dpe.height],
      gesSize: [ges.width, ges.height],
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      energyText: [...document.querySelectorAll('.fact-energy-value')].map((node) => node.textContent),
    };
  });
  if (report.mobile.facts.pageOverflow
      || report.mobile.facts.rowWidths.some((width) => width < report.mobile.facts.gridWidth * 0.9)
      || Math.abs(report.mobile.facts.dpeSize[0] - report.mobile.facts.gesSize[0]) > 1
      || Math.abs(report.mobile.facts.dpeSize[1] - report.mobile.facts.gesSize[1]) > 1) {
    throw new Error(`Mobile facts audit failed: ${JSON.stringify(report.mobile.facts)}`);
  }
  await mobile.page.locator('.intro-section').screenshot({ path: join(output, 'wow2-facts-mobile-390.png') });
  await mobile.context.close();
} finally {
  await browser.close();
}

if (report.consoleErrors.length || report.pageErrors.length) {
  throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors: report.consoleErrors, pageErrors: report.pageErrors }, null, 2)}`);
}

await writeFile(join(output, 'wow2-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
