#!/usr/bin/env node

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:5180/?forceWebGL=1';
const output = process.argv[3];

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

const browser = await chromium.launch({ executablePath: fullChromium(), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(
    () => document.documentElement.dataset.modelReady === '1' && window.__listing?.backend,
    null,
    { timeout: 30_000 },
  );

  const staticY = await page.evaluate(async () => {
    const track = document.querySelector('#story-track');
    document.documentElement.style.scrollBehavior = 'auto';
    const results = [];
    for (let raw = 1; raw <= 3.0001; raw += 0.05) {
      window.scrollTo({ top: track.offsetTop + innerHeight * raw, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const started = performance.now();
      while (Math.abs(window.__listing.story.targetValue - window.__listing.story.value) > 0.00005
        && performance.now() - started < 2_000) {
        await new Promise(requestAnimationFrame);
      }
      results.push({
        raw: Number(raw.toFixed(2)),
        value: window.__listing.story.value,
        y: window.__listing.viewer.camera.position.y,
      });
    }
    return results;
  });

  const coast = await page.evaluate(async () => {
    const story = window.__listing.story;
    const viewer = window.__listing.viewer;
    const track = document.querySelector('#story-track');
    window.scrollTo({ top: track.offsetTop + innerHeight * 1.2, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let settleStarted = performance.now();
    while (Math.abs(story.targetValue - story.value) > 0.00005 && performance.now() - settleStarted < 2_000) {
      await new Promise(requestAnimationFrame);
    }
    window.dispatchEvent(new WheelEvent('wheel', {
      deltaY: 130,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      bubbles: true,
      cancelable: true,
    }));
    const samples = [];
    const started = performance.now();
    let previous = null;
    while (performance.now() - started < 4_000 && (story.scrollAuthority.mode !== 'idle' || story.value < 2.12)) {
      await new Promise(requestAnimationFrame);
      const position = viewer.camera.position;
      const sample = {
        time: performance.now() - started,
        value: story.value,
        x: position.x,
        y: position.y,
        z: position.z,
        speed: 0,
      };
      if (previous) {
        const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y, sample.z - previous.z);
        sample.speed = distance / ((sample.time - previous.time) / 1000);
      }
      samples.push(sample);
      previous = sample;
    }
    const closest = (value) => samples.reduce((best, sample) => (
      Math.abs(sample.value - value) < Math.abs(best.value - value) ? sample : best
    ));
    const centerWindow = samples.filter((sample) => Math.abs(sample.value - 2) <= 0.1);
    let yDirectionReversals = 0;
    let previousDirection = 0;
    for (let index = 1; index < centerWindow.length; index += 1) {
      const deltaY = centerWindow[index].y - centerWindow[index - 1].y;
      const direction = Math.abs(deltaY) < 0.00001 ? 0 : Math.sign(deltaY);
      if (direction && previousDirection && direction !== previousDirection) yDirectionReversals += 1;
      if (direction) previousDirection = direction;
    }
    const center = closest(2);
    const midBefore = closest(1.5);
    const midAfter = closest(2.5);
    const availableMidpoints = [midBefore, midAfter].filter((sample) => Math.abs(sample.value - (sample === midBefore ? 1.5 : 2.5)) < 0.18);
    const midTravelSpeed = Math.max(...availableMidpoints.map((sample) => sample.speed));
    return {
      startValue: samples[0]?.value,
      endValue: samples.at(-1)?.value,
      center,
      midBefore,
      midAfter,
      midTravelSpeed,
      centerSpeedRatio: center.speed / midTravelSpeed,
      yDirectionReversals,
      centerWindowYRange: Math.max(...centerWindow.map((sample) => sample.y)) - Math.min(...centerWindow.map((sample) => sample.y)),
      samples,
    };
  });

  const stage = await page.locator('#stage').boundingBox();
  await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(stage.x + 2, stage.y + stage.height - 2, { steps: 8 });
  await page.mouse.up();
  const draggedLook = await page.evaluate(() => window.__listing.story.lookOffsets);
  await page.evaluate(() => window.scrollBy({ top: 10, behavior: 'instant' }));
  await page.waitForTimeout(100);
  const recenterEarly = await page.evaluate(() => window.__listing.story.lookOffsets);
  await page.waitForTimeout(650);
  const recenterDone = await page.evaluate(() => window.__listing.story.lookOffsets);

  await page.evaluate(() => {
    const track = document.querySelector('#story-track');
    window.scrollTo({ top: track.offsetTop, behavior: 'instant' });
  });
  await page.waitForFunction(() => Math.abs(window.__listing.story.value) < 0.002, null, { timeout: 4_000 });
  await page.mouse.move(stage.x + stage.width - 2, stage.y + stage.height - 2);
  await page.waitForTimeout(2_500);
  const parallax = await page.evaluate(async () => {
    const amplitudes = window.__listing.story.lookOffsets;
    const before = window.__listing.viewer.renderCount;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      yawDegrees: amplitudes.parallaxYaw * 180 / Math.PI,
      pitchDegrees: amplitudes.parallaxPitch * 180 / Math.PI,
      idleRenders: window.__listing.viewer.renderCount - before,
    };
  });

  const result = {
    backend: await page.evaluate(() => window.__listing.backend),
    constants: await page.evaluate(() => ({
      look: window.__listing.story.lookOffsets,
      motion: window.__listing.story.motionProfile,
    })),
    staticY,
    coast,
    interaction: { draggedLook, recenterEarly, recenterDone, parallax },
    consoleErrors,
    pageErrors,
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (output) writeFileSync(output, json);
  process.stdout.write(json);
  const failures = [];
  if (!(coast.centerSpeedRatio < 0.08)) failures.push(`center speed ratio was ${(coast.centerSpeedRatio * 100).toFixed(2)}%`);
  if (coast.yDirectionReversals !== 0) failures.push(`${coast.yDirectionReversals} Y direction reversal(s) inside center ±0.1 beats`);
  if (Math.abs(draggedLook.yaw) < draggedLook.yawClamp - 0.001
    || Math.abs(draggedLook.pitch) < draggedLook.pitchClamp - 0.001) failures.push('drag did not reach both look clamps');
  if (!recenterEarly.recentering || Math.abs(recenterDone.yaw) > 0.00001
    || Math.abs(recenterDone.pitch) > 0.00001) failures.push('600 ms scroll recenter failed');
  if (Math.abs(parallax.yawDegrees - 1.6) > 0.001 || Math.abs(parallax.pitchDegrees - 1.0) > 0.001
    || parallax.idleRenders !== 0) failures.push('parallax amplitude/idle rendering failed');
  if (consoleErrors.length || pageErrors.length) failures.push('page emitted errors');
  if (failures.length) throw new Error(failures.join('; '));
} finally {
  await context.close();
  await browser.close();
}
