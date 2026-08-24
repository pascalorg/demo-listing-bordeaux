#!/usr/bin/env node

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:5180/?forceWebGL=1';

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

  const idle = await page.evaluate(async () => {
    const track = document.querySelector('#story-track');
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo({ top: track.offsetTop + innerHeight * 3.37, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const start = scrollY;
    let maximumMovement = 0;
    const samples = [];
    const started = performance.now();
    while (performance.now() - started < 2_000) {
      await new Promise(requestAnimationFrame);
      maximumMovement = Math.max(maximumMovement, Math.abs(scrollY - start));
      samples.push(scrollY);
    }
    return {
      start,
      end: scrollY,
      maximumMovement,
      distinctPositions: new Set(samples).size,
      mode: window.__listing.story.scrollAuthority.mode,
      velocity: window.__listing.story.scrollAuthority.velocity,
    };
  });

  const coast = await page.evaluate(async () => {
    const story = window.__listing.story;
    const track = document.querySelector('#story-track');
    const center = track.offsetTop + innerHeight * 2;
    window.scrollTo({ top: center, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.dispatchEvent(new WheelEvent('wheel', {
      deltaY: 100,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      bubbles: true,
      cancelable: true,
    }));
    const samples = [{ time: 0, y: scrollY, velocity: story.scrollAuthority.velocity }];
    const started = performance.now();
    while (performance.now() - started < 4_000 && story.scrollAuthority.mode !== 'idle') {
      await new Promise(requestAnimationFrame);
      samples.push({
        time: performance.now() - started,
        y: scrollY,
        velocity: story.scrollAuthority.velocity,
      });
    }
    const restY = scrollY;
    await new Promise((resolve) => setTimeout(resolve, 300));
    let velocityGrowthSamples = 0;
    let backwardsSamples = 0;
    for (let index = 1; index < samples.length; index += 1) {
      if (Math.abs(samples[index].velocity) > Math.abs(samples[index - 1].velocity) + 0.01) velocityGrowthSamples += 1;
      if (samples[index].y < samples[index - 1].y) backwardsSamples += 1;
    }
    return {
      initialVelocity: samples[0].velocity,
      finalVelocity: story.scrollAuthority.velocity,
      durationMs: samples.at(-1).time,
      sampleCount: samples.length,
      velocityGrowthSamples,
      backwardsSamples,
      travelBeats: (restY - center) / innerHeight,
      nextCenterErrorBeats: Math.abs(restY - (center + innerHeight)) / innerHeight,
      postRestMovement: Math.abs(scrollY - restY),
      finalMode: story.scrollAuthority.mode,
    };
  });

  const blend = await page.evaluate(async () => {
    const story = window.__listing.story;
    const track = document.querySelector('#story-track');
    const center = track.offsetTop + innerHeight * 4;
    window.scrollTo({ top: center, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.dispatchEvent(new WheelEvent('wheel', {
      deltaY: 80,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 180));
    const before = { y: scrollY, velocity: story.scrollAuthority.velocity };
    window.dispatchEvent(new WheelEvent('wheel', {
      deltaY: 60,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      bubbles: true,
      cancelable: true,
    }));
    const after = { y: scrollY, velocity: story.scrollAuthority.velocity };
    const expectedImpulse = (60 / 100) * story.scrollAuthority.impulseBeatsPerSecond * innerHeight;
    await new Promise(requestAnimationFrame);
    const nextFrame = { y: scrollY, velocity: story.scrollAuthority.velocity };
    while (story.scrollAuthority.mode !== 'idle') await new Promise(requestAnimationFrame);
    return {
      beforeVelocity: before.velocity,
      afterVelocity: after.velocity,
      expectedImpulse,
      blendError: Math.abs(after.velocity - before.velocity - expectedImpulse),
      inputPositionJump: Math.abs(after.y - before.y),
      nextFrameMovement: nextFrame.y - after.y,
      finalMode: story.scrollAuthority.mode,
      finalVelocity: story.scrollAuthority.velocity,
    };
  });

  const stage = await page.locator('#stage').boundingBox();
  await page.evaluate(() => {
    const track = document.querySelector('#story-track');
    window.scrollTo({ top: track.offsetTop + innerHeight * 2, behavior: 'instant' });
  });
  await page.waitForTimeout(150);
  await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.5 + 80, stage.y + stage.height * 0.5 + 50, { steps: 5 });
  await page.mouse.up();
  const draggedLook = await page.evaluate(() => window.__listing.story.lookOffsets);
  await page.evaluate(() => window.scrollBy({ top: 1, behavior: 'instant' }));
  await page.waitForTimeout(100);
  const tinyScrollLook = await page.evaluate(() => window.__listing.story.lookOffsets);
  await page.evaluate(() => window.scrollBy({ top: 10, behavior: 'instant' }));
  await page.waitForTimeout(100);
  const recenterEarly = await page.evaluate(() => window.__listing.story.lookOffsets);
  await page.waitForTimeout(650);
  const recenterDone = await page.evaluate(() => window.__listing.story.lookOffsets);

  await page.mouse.move(stage.x + stage.width * 0.9, stage.y + stage.height * 0.9);
  await page.waitForFunction(
    () => [...window.__listing.viewer.doors.records.values()].every((door) => !door.moving),
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2_500);
  const parallax = await page.evaluate(async () => {
    const amplitudes = window.__listing.story.lookOffsets;
    const before = window.__listing.viewer.renderCount;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      yawDegrees: amplitudes.parallaxYaw * 180 / Math.PI,
      pitchDegrees: amplitudes.parallaxPitch * 180 / Math.PI,
      idleRenders: window.__listing.viewer.renderCount - before,
      movingDoors: [...window.__listing.viewer.doors.records.values()].filter((door) => door.moving).length,
      valueDifference: Math.abs(window.__listing.story.targetValue - window.__listing.story.value),
      movingZones: window.__listing.viewer.zones.records.filter((zone) => Math.abs(zone.target - zone.current) > 0.001).length,
    };
  });

  const result = {
    backend: await page.evaluate(() => window.__listing.backend),
    idle,
    coast,
    blend,
    camera: { draggedLook, tinyScrollLook, recenterEarly, recenterDone, parallax },
    consoleErrors,
    pageErrors,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  const failures = [];
  if (idle.maximumMovement !== 0 || idle.mode !== 'idle' || idle.velocity !== 0) failures.push('V1a idle moved or retained motion');
  if (coast.velocityGrowthSamples || coast.backwardsSamples || coast.nextCenterErrorBeats > 0.15
    || coast.postRestMovement !== 0 || coast.finalMode !== 'idle' || coast.finalVelocity !== 0) failures.push('V1b coast failed');
  if (blend.blendError > 0.01 || blend.inputPositionJump !== 0 || blend.nextFrameMovement <= 0
    || blend.finalMode !== 'idle' || blend.finalVelocity !== 0) failures.push('V1c blend failed');
  if (Math.abs(draggedLook.yaw) < 0.05 || Math.abs(draggedLook.pitch) < 0.05) failures.push('V3 drag did not affect both axes');
  if (tinyScrollLook.recentering) failures.push('V2 triggered on tiny jitter');
  if (!recenterEarly.recentering || Math.abs(recenterDone.yaw) > 0.00001 || Math.abs(recenterDone.pitch) > 0.00001) failures.push('V2 recenter failed');
  if (Math.abs(parallax.yawDegrees - 1.6) > 0.001 || Math.abs(parallax.pitchDegrees - 1.0) > 0.001 || parallax.idleRenders !== 0) failures.push('V4 amplitude/idle failed');
  if (consoleErrors.length || pageErrors.length) failures.push('page emitted errors');
  if (failures.length) throw new Error(failures.join('; '));
} finally {
  await context.close();
  await browser.close();
}
