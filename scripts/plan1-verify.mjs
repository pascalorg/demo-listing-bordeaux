#!/usr/bin/env node
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const site = process.argv[2] || 'http://127.0.0.1:5193/?forceWebGL=1';
const output = join(process.cwd(), 'scratchpad', 'verify');
mkdirSync(output, { recursive: true });
const modelBuffer = readFileSync(join(process.cwd(), 'public', 'assets', 'model', 'apartment.glb'));
let modelJson = null;
for (let offset = 12; offset < modelBuffer.length;) {
  const length = modelBuffer.readUInt32LE(offset);
  const type = modelBuffer.readUInt32LE(offset + 4);
  if (type === 0x4e4f534a) modelJson = JSON.parse(modelBuffer.subarray(offset + 8, offset + 8 + length));
  offset += 8 + length;
}
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const executablePath = [
  join(cache, 'chromium-1194/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  join(cache, 'chromium-1194/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.emulateMedia({ reducedMotion: 'reduce' });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

const shot = async (name) => {
  const path = join(output, name);
  await page.screenshot({ path });
  return path;
};
const camera = () => page.evaluate(() => {
  const { viewer, story } = window.__listing;
  return {
    eye: viewer.camera.position.toArray(),
    target: story.copyCameraTarget(viewer.camera.position.clone()).toArray(),
    fov: viewer.camera.fov,
  };
});
const go = async (index, beat) => {
  await page.evaluate((next) => window.__listing.story.goToBeat(next, false), index);
  await page.waitForFunction((id) => window.__listing.story.beat === id, beat);
  await page.waitForTimeout(450);
};

await page.goto(site, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__listing?.viewer?.doors?.records?.size >= 12);
await page.waitForFunction(() => document.querySelector('#plan-panel')?.dataset.ready === '1');

await go(2, 'sejour');
const sejour = {
  pose: await camera(),
  frenchDoor: await page.evaluate(() => {
    const record = window.__listing.viewer.doors.records.get('door_cvdmtaj49xgwpnfh');
    return { progress: record.progress, time: record.action?.time, duration: record.clip?.duration };
  }),
  screenshot: await shot('plan1-new-glb-sejour.png'),
};

await go(5, 'chambre1');
const suite = {
  pose: await camera(),
  window: await page.evaluate(() => {
    const record = window.__listing.viewer.windows.records.get('window_cheeuc6e0qbb0e44');
    return { progress: record.progress, time: record.action?.time, duration: record.clip?.duration };
  }),
  screenshot: await shot('plan1-new-glb-suite.png'),
};

await page.evaluate(() => {
  const track = document.querySelector('#story-track');
  window.scrollTo({ top: track.offsetTop + innerHeight * 1.76, behavior: 'instant' });
});
await page.waitForFunction(() => {
  const progress = window.__listing.viewer.doors.records.get('door_cvdmtaj49xgwpnfh')?.progress;
  return progress > 0.05 && progress < 0.95;
});
await page.waitForTimeout(120);
const frenchDoorMid = {
  story: await page.evaluate(() => window.__listing.story.transition),
  action: await page.evaluate(() => {
    const record = window.__listing.viewer.doors.records.get('door_cvdmtaj49xgwpnfh');
    return { progress: record.progress, time: record.action.time, duration: record.clip.duration, paused: record.action.paused };
  }),
  screenshot: await shot('plan1-new-glb-french-door-mid.png'),
};

await go(8, 'plan');
const planEntry = {
  pose: await camera(),
  screenshot: await shot('plan1-plan-entry-exact.png'),
};

const hoverPoint = await page.evaluate(() => {
  const { viewer } = window.__listing;
  const stage = document.querySelector('#stage').getBoundingClientRect();
  const panel = document.querySelector('#plan-panel').getBoundingClientRect();
  const candidates = viewer.zones.records.map((record) => {
    const projected = record.position.clone();
    projected.y = 0.02;
    projected.project(viewer.camera);
    return {
      key: record.key,
      x: stage.left + (projected.x * 0.5 + 0.5) * stage.width,
      y: stage.top + (-projected.y * 0.5 + 0.5) * stage.height,
    };
  });
  return candidates.find((point) => point.x > panel.right + 24
    && point.x < stage.right - 80 && point.y > stage.top + 70 && point.y < stage.bottom - 70);
});
if (!hoverPoint) throw new Error('No unobscured plan-zone hover point found');
await page.mouse.move(hoverPoint.x, hoverPoint.y);
await page.waitForFunction((key) => {
  const group = document.querySelector(`.plan-zone[data-zone-key='${key}']`);
  const record = window.__listing.viewer.zones.records.find((zone) => zone.key === key);
  return group?.classList.contains('is-model-hovered') && record?.target === 1;
}, hoverPoint.key);
await page.waitForTimeout(500);
const hover = {
  point: hoverPoint,
  state: await page.evaluate((key) => {
    const group = document.querySelector(`.plan-zone[data-zone-key='${key}']`);
    const record = window.__listing.viewer.zones.records.find((zone) => zone.key === key);
    return {
      planHighlighted: group.classList.contains('is-model-hovered'),
      zoneTarget: record.target,
      zoneCurrent: record.current,
    };
  }, hoverPoint.key),
  screenshot: await shot('plan1-3d-hover-bidirectional.png'),
};

await page.mouse.click(hoverPoint.x, hoverPoint.y);
await page.waitForFunction(() => window.__listing.story.browsing && !window.__listing.story.browseFlying);
await page.waitForTimeout(120);
const roomFlyPose = await camera();
await page.mouse.move(980, 260);
await page.mouse.down();
await page.mouse.move(1050, 200, { steps: 18 });
await page.mouse.up();
await page.waitForTimeout(450);
const roomOrbit = {
  key: hoverPoint.key,
  flyPose: roomFlyPose,
  orbitPose: await camera(),
  screenshot: await shot('plan1-room-focus-orbited.png'),
};

await page.locator('.plan-return').click();
await page.waitForFunction(() => !window.__listing.story.browsing);
await page.waitForTimeout(250);
const planReturn = await camera();

await page.mouse.move(980, 260);
await page.mouse.down();
await page.mouse.move(1130, 390, { steps: 16 });
await page.mouse.up();
await page.waitForTimeout(200);
const planOrbit = await camera();
await go(7, 'chambres');
await go(8, 'plan');
const planAfterOrbitReset = await camera();

const assetAudit = await page.evaluate(async () => {
  const layout = await fetch('assets/data/layout.json').then((response) => response.json());
  const doors = Object.values(layout.nodes).filter((node) => node.type === 'door').map((node) => {
    const record = window.__listing.viewer.doors.records.get(node.id);
    return { id: node.id, node: Boolean(record?.root), clip: record?.clip?.name || null };
  });
  const windowRecord = window.__listing.viewer.windows.records.get('window_cheeuc6e0qbb0e44');
  return {
    animationCount: window.__listing.viewer.gltfAnimations?.length ?? null,
    doors,
    critical: {
      french: doors.find((door) => door.id === 'door_cvdmtaj49xgwpnfh'),
      pocket: doors.find((door) => door.id === 'door_2udbl7hf9ws2cdnr'),
      window: { node: Boolean(windowRecord?.root), clip: windowRecord?.clip?.name || null },
    },
  };
});
assetAudit.animationCount = modelJson.animations.length;
assetAudit.animationNames = modelJson.animations.map((animation) => animation.name);

await page.waitForFunction(() => window.__listing.viewer.zones.records.every((zone) => (
  Math.abs(zone.current - zone.target) < 0.001
  && Math.abs(zone.collisionCurrent - zone.collisionTarget) < 0.001
)));
await page.waitForFunction(() => window.__listing.viewer.convergenceFramesRemaining === 0);
const idleBefore = await page.evaluate(() => window.__listing.viewer.renderCount);
await page.waitForTimeout(900);
const idleAfter = await page.evaluate(() => window.__listing.viewer.renderCount);

const report = {
  backend: await page.evaluate(() => window.__listing.backend),
  sejour,
  suite,
  frenchDoorMid,
  planEntry,
  hover,
  roomOrbit,
  planReturn,
  planOrbit,
  planAfterOrbitReset,
  assetAudit,
  idleRenderCounts: [idleBefore, idleAfter],
  consoleErrors,
  pageErrors,
};
writeFileSync(join(output, 'plan1-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
console.log(JSON.stringify(report, null, 2));
