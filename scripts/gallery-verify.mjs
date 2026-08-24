#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:5180/?forceWebGL=1';
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

const expectedFrench = [
  'Séjour & cuisine · Séjour · Photo',
  'Séjour & cuisine · Cuisine ouverte · Photo',
  'Séjour & cuisine · Bord de mer · Projection',
  'Séjour & cuisine · Bohème · Projection',
  'Séjour & cuisine · Scandinave · Projection',
  'Suite parentale · Chambre 1 · Photo',
  'Suite parentale · Chambre 1 · second angle · Photo',
  'Suite parentale · Salle d’eau · Photo',
  'Suite parentale · Scandinave · Projection',
  'Suite parentale · Japandi · Projection',
  'Suite parentale · Bohème · Projection',
  'Suite parentale · Cosy · Projection',
  'Balcon · Balcon · Photo',
  'Chambres 2 & 3 · Chambre 2 · Photo',
  'Chambres 2 & 3 · Chambre 3 · Rendu généré par Pascal',
  'Salle de bains · Salle de bains · Photo',
];

const browser = await chromium.launch({ executablePath: fullChromium(), headless: true });
const report = { url, backend: null, desktop: null, mobile: null, consoleErrors: [], pageErrors: [] };

async function openPage(viewport, label, mobile = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(`${label}: ${message.text()}`);
  });
  page.on('pageerror', (error) => report.pageErrors.push(`${label}: ${error.stack || error.message}`));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => window.__listing?.backend, null, { timeout: 30_000 });
  await page.locator('.gallery-photos-section').scrollIntoViewIfNeeded();
  await page.locator('#gallery img').evaluateAll((images) => images.forEach((image) => { image.loading = 'eager'; }));
  await page.waitForFunction(() => [...document.querySelectorAll('#gallery img')]
    .every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 30_000 });
  for (const room of await page.locator('.gallery-room').all()) {
    await room.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
  }
  await page.locator('.gallery-photos-section').scrollIntoViewIfNeeded();
  return { context, page };
}

try {
  const desktop = await openPage({ width: 1440, height: 900 }, 'desktop');
  report.backend = await desktop.page.evaluate(() => window.__listing.backend);
  report.desktop = await desktop.page.evaluate(() => ({
    title: document.querySelector('.gallery-photos-section h2').textContent,
    groups: [...document.querySelectorAll('.gallery-room')].map((group) => ({
      id: group.dataset.room,
      room: group.querySelector('h3').textContent,
      area: group.querySelector('.gallery-area-chip').textContent,
      link: group.querySelector('.gallery-story-link')?.getAttribute('href') || null,
      photos: group.querySelectorAll('.gallery-card-photo').length,
      projections: group.querySelectorAll('.gallery-card-projection').length,
    })),
    captions: [...document.querySelectorAll('#gallery .lightbox-trigger')].map((trigger) => trigger.getAttribute('aria-label')),
    projectionBadges: document.querySelectorAll('#gallery .projection-badge').length,
    pascalRenderTypes: [...document.querySelectorAll('.gallery-card-type')]
      .filter((type) => type.textContent === 'Rendu généré par Pascal').length,
    pageOverflow: document.documentElement.scrollWidth > innerWidth,
  }));
  if (report.desktop.title !== 'L’appartement en images.') throw new Error(`Incorrect French title: ${report.desktop.title}`);
  if (JSON.stringify(report.desktop.captions) !== JSON.stringify(expectedFrench)) {
    throw new Error(`Incorrect grouped order: ${JSON.stringify(report.desktop.captions)}`);
  }
  const chambresGroup = report.desktop.groups.find((group) => group.id === 'chambres');
  if (report.desktop.projectionBadges !== 7 || report.desktop.pascalRenderTypes !== 1
      || chambresGroup?.photos !== 2 || report.desktop.groups.length !== 5 || report.desktop.pageOverflow) {
    throw new Error(`Desktop gallery structure failed: ${JSON.stringify(report.desktop)}`);
  }
  const desktopEvidenceStyle = await desktop.page.addStyleTag({ content: '.topbar { visibility: hidden !important; }' });
  await desktop.page.locator('.gallery-photos-section').screenshot({ path: join(output, 'gallery-desktop-1440x900.png') });
  await desktop.page.locator('.gallery-room[data-room="chambres"]').screenshot({ path: join(output, 'gallery-chambres-1440x900.png') });
  await desktopEvidenceStyle.evaluate((style) => style.remove());
  await desktop.page.locator('.gallery-card-projection .lightbox-trigger').first().click();
  await desktop.page.locator('#lightbox:not([hidden])').waitFor();
  const projectionCaption = await desktop.page.locator('.lightbox-frame figcaption span').first().textContent();
  if (!projectionCaption.endsWith('· Projection')) throw new Error(`Projection caption missing type: ${projectionCaption}`);
  report.desktop.projectionLightboxCaption = projectionCaption;
  await desktop.page.screenshot({ path: join(output, 'gallery-lightbox-projection-1440x900.png') });
  await desktop.page.locator('.lightbox-next').click();
  report.desktop.nextLightboxCaption = await desktop.page.locator('.lightbox-frame figcaption span').first().textContent();
  if (report.desktop.nextLightboxCaption !== 'Séjour & cuisine · Bohème · Projection') {
    throw new Error(`Lightbox did not follow grouped order: ${report.desktop.nextLightboxCaption}`);
  }
  await desktop.page.locator('.lightbox-close').click();
  await desktop.page.locator('.gallery-room[data-room="chambres"] .gallery-card').nth(1).locator('.lightbox-trigger').click();
  await desktop.page.locator('#lightbox:not([hidden])').waitFor();
  report.desktop.pascalRenderLightboxCaption = await desktop.page.locator('.lightbox-frame figcaption span').first().textContent();
  if (report.desktop.pascalRenderLightboxCaption !== 'Chambres 2 & 3 · Chambre 3 · Rendu généré par Pascal') {
    throw new Error(`Pascal render lightbox caption is incorrect: ${report.desktop.pascalRenderLightboxCaption}`);
  }
  await desktop.page.locator('.lightbox-next').click();
  report.desktop.afterPascalRenderCaption = await desktop.page.locator('.lightbox-frame figcaption span').first().textContent();
  if (report.desktop.afterPascalRenderCaption !== 'Salle de bains · Salle de bains · Photo') {
    throw new Error(`Pascal render is out of global lightbox order: ${report.desktop.afterPascalRenderCaption}`);
  }
  await desktop.page.locator('.lightbox-close').click();
  await desktop.page.locator('#lang-toggle').click();
  report.desktop.english = await desktop.page.evaluate(() => ({
    title: document.querySelector('.gallery-photos-section h2').textContent,
    projectionRow: document.querySelector('.gallery-row-projection .gallery-row-label').textContent,
    chambre2Caption: document.querySelector('.gallery-room[data-room="chambres"] .gallery-card:nth-child(1) .lightbox-trigger').getAttribute('aria-label'),
    chambre3Caption: document.querySelector('.gallery-room[data-room="chambres"] .gallery-card:nth-child(2) .lightbox-trigger').getAttribute('aria-label'),
    chambre3Type: document.querySelector('.gallery-room[data-room="chambres"] .gallery-card:nth-child(2) .gallery-card-type').textContent,
    firstLink: document.querySelector('.gallery-story-link').textContent,
  }));
  if (report.desktop.english.title !== 'The flat in pictures.'
      || report.desktop.english.projectionRow !== 'Staging projections'
      || report.desktop.english.chambre2Caption !== 'Bedrooms 2 & 3 · Bedroom 2 · Photo'
      || report.desktop.english.chambre3Caption !== 'Bedrooms 2 & 3 · Bedroom 3 · Pascal-generated render'
      || report.desktop.english.chambre3Type !== 'Pascal-generated render') {
    throw new Error(`English copy failed: ${JSON.stringify(report.desktop.english)}`);
  }
  report.desktop.energyIntegration = await desktop.page.evaluate(() => ({
    standaloneDiagnostics: document.querySelectorAll('#diagnostics-grid, .diagnostics-block').length,
    values: [...document.querySelectorAll('.fact-energy-value')].map((node) => node.textContent),
  }));
  if (report.desktop.energyIntegration.standaloneDiagnostics !== 0
      || !report.desktop.energyIntegration.values.every((value) => value.endsWith('/year'))) {
    throw new Error(`Energy facts integration failed: ${JSON.stringify(report.desktop.energyIntegration)}`);
  }
  await desktop.page.locator('#gallery .gallery-story-link').first().click();
  await desktop.page.waitForFunction(() => location.hash === '#sejour' && window.__listing?.beat === 'sejour', null, { timeout: 10_000 });
  report.desktop.storyLinkTarget = await desktop.page.evaluate(() => ({ hash: location.hash, beat: window.__listing.beat }));
  await desktop.context.close();

  const mobile = await openPage({ width: 390, height: 844 }, 'mobile', true);
  report.mobile = await mobile.page.evaluate(() => {
    const tracks = [...document.querySelectorAll('.gallery-row-track')];
    const headers = [...document.querySelectorAll('.gallery-room-header')];
    return {
      title: document.querySelector('.gallery-photos-section h2').textContent,
      groups: headers.length,
      snapTracks: tracks.filter((track) => getComputedStyle(track).scrollSnapType.startsWith('x')).length,
      horizontallyScrollableTracks: tracks.filter((track) => track.scrollWidth > track.clientWidth + 1).length,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      headerLinks: document.querySelectorAll('.gallery-story-link').length,
    };
  });
  if (report.mobile.title !== 'L’appartement en images.' || report.mobile.groups !== 5
      || report.mobile.snapTracks !== 7 || report.mobile.pageWidth > report.mobile.viewportWidth
      || report.mobile.headerLinks !== 4) {
    throw new Error(`Mobile gallery layout failed: ${JSON.stringify(report.mobile)}`);
  }
  const mobileEvidenceStyle = await mobile.page.addStyleTag({ content: '.topbar { visibility: hidden !important; }' });
  await mobile.page.locator('.gallery-photos-section').screenshot({ path: join(output, 'gallery-mobile-390x844.png') });
  await mobileEvidenceStyle.evaluate((style) => style.remove());
  await mobile.context.close();
} finally {
  await browser.close();
}

if (report.consoleErrors.length || report.pageErrors.length) {
  throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors: report.consoleErrors, pageErrors: report.pageErrors }, null, 2)}`);
}

writeFileSync(join(output, 'gallery-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
