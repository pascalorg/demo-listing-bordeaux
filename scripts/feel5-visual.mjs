#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:5180/?forceWebGL=1';
const evidenceDirectory = join(process.cwd(), 'scratchpad', 'verify');
const beats = ['hero', 'floor', 'sejour', 'staging', 'balcon', 'chambre1', 'salledeau', 'chambres', 'plan'];

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

function intersection(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return { width, height, area: width * height };
}

mkdirSync(evidenceDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: fullChromium(), headless: true });
const results = { viewports: {}, consoleErrors: [], pageErrors: [] };

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const label = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') results.consoleErrors.push(`${label}: ${message.text()}`);
    });
    page.on('pageerror', (error) => results.pageErrors.push(`${label}: ${error.stack || error.message}`));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(
      () => document.documentElement.dataset.modelReady === '1' && window.__listing?.backend,
      null,
      { timeout: 30_000 },
    );
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
    const beatResults = [];

    for (let index = 0; index < beats.length; index += 1) {
      await page.evaluate((beatIndex) => {
        const track = document.querySelector('#story-track');
        window.scrollTo({ top: track.offsetTop + innerHeight * beatIndex, behavior: 'instant' });
      }, index);
      await page.waitForFunction(
        (beatIndex) => Math.abs(window.__listing.story.value - beatIndex) < 0.002,
        index,
        { timeout: 4_000 },
      );
      await page.waitForTimeout(beats[index] === 'staging' ? 1_350 : 120);

      const layout = await page.evaluate(() => {
        const visible = (element) => {
          if (!element) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden'
            && Number(style.opacity) > 0.05 && rect.width > 0 && rect.height > 0;
        };
        const describe = (name, element) => {
          if (!visible(element)) return null;
          const rect = element.getBoundingClientRect();
          return {
            name,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            zIndex: getComputedStyle(element).zIndex,
            classes: element.className,
          };
        };
        const card = document.querySelector(`.beat-card[data-beat='${window.__listing.beat}']`);
        const railLabel = document.querySelector(".chapter-rail button[aria-current='true'] em");
        return [
          describe('card', card),
          describe('mini-plan', document.querySelector('#plan-panel.is-mini')),
          describe('plan-ui', document.querySelector('#plan-panel.is-plan-beat:not(.is-mini)')),
          describe('staging-ui', document.querySelector('.staging-picker.is-active')),
          describe('sun-ui', document.querySelector('.sun-scrub.is-active')),
          describe('photo-ui', [...document.querySelectorAll('.beat-photo-card')].find(visible)),
          describe('chapter-ui', railLabel),
        ].filter(Boolean);
      });

      const overlaps = [];
      for (let first = 0; first < layout.length; first += 1) {
        for (let second = first + 1; second < layout.length; second += 1) {
          const overlap = intersection(layout[first], layout[second]);
          if (overlap.area > 1) overlaps.push({ pair: [layout[first].name, layout[second].name], ...overlap });
        }
      }
      beatResults.push({ beat: beats[index], elements: layout, overlaps });

      if (label === '1440x900' && beats[index] === 'floor') {
        await page.screenshot({ path: join(evidenceDirectory, 'feel5-floor-1440x900.png') });
        await page.locator('#topbar').screenshot({ path: join(evidenceDirectory, 'feel5-header-logo.png') });
      }
    }

    results.viewports[label] = beatResults;
    await context.close();
  }
} finally {
  await browser.close();
}

writeFileSync(join(evidenceDirectory, 'feel5-layout.json'), `${JSON.stringify(results, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);

const failures = [];
for (const [viewport, beatResults] of Object.entries(results.viewports)) {
  for (const result of beatResults) {
    if (result.overlaps.length) failures.push(`${viewport} ${result.beat}: ${JSON.stringify(result.overlaps)}`);
  }
}
if (results.consoleErrors.length || results.pageErrors.length) failures.push('page emitted errors');
if (failures.length) throw new Error(failures.join('\n'));
