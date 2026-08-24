import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const site = process.argv[2] || 'http://127.0.0.1:5193/?forceWebGL=1#plan';
const output = join(process.cwd(), 'scratchpad', 'verify');
mkdirSync(output, { recursive: true });
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const candidates = [
  join(cache, 'chromium-1194/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  join(cache, 'chromium-1194/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const executablePath = candidates.find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

const camera = () => page.evaluate(() => {
  const { viewer, story } = window.__listing;
  const target = story.copyCameraTarget({
    x: 0, y: 0, z: 0,
    copy(value) { this.x = value.x; this.y = value.y; this.z = value.z; return this; },
    toArray() { return [this.x, this.y, this.z]; },
  });
  const offset = viewer.camera.position.clone().sub(target);
  return {
    eye: viewer.camera.position.toArray(),
    target: target.toArray(),
    fov: viewer.camera.fov,
    polar: Math.acos(offset.y / offset.length()),
    renderCount: viewer.renderCount,
  };
});

await page.goto(site, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__listing?.viewer?.doors?.records?.size >= 12);
await page.waitForFunction(() => window.__listing.story.beat === 'plan');
await page.waitForTimeout(1300);

const stageBox = await page.locator('#stage').boundingBox();
await page.mouse.move(stageBox.x + stageBox.width * 0.58, stageBox.y + stageBox.height * 0.38);
await page.mouse.down();
await page.mouse.move(stageBox.x + stageBox.width * 0.77, stageBox.y + stageBox.height * 0.72, { steps: 18 });
await page.mouse.up();
await page.waitForTimeout(500);
const planLow = await camera();
const planLowPath = join(output, 'polishb-plan-low-angle.png');
await page.screenshot({ path: planLowPath });

async function captureRoom(key, file) {
  await page.evaluate((zoneKey) => document.querySelector(`.plan-zone[data-zone-key='${zoneKey}']`).dispatchEvent(
    new MouseEvent('click', { bubbles: true }),
  ), key);
  await page.waitForFunction(() => window.__listing.story.browsing);
  await page.waitForTimeout(1100);
  const pose = await camera();
  const path = join(output, file);
  await page.screenshot({ path });
  await page.locator('.plan-return').click();
  await page.waitForFunction(() => !window.__listing.story.browsing);
  await page.waitForTimeout(350);
  return { pose, path };
}

const entree = await captureRoom('entree', 'polishb-plan-entree.png');
const wc = await captureRoom('wc', 'polishb-plan-wc.png');

const preWalkDoors = await page.evaluate(() => Object.fromEntries(
  [...window.__listing.viewer.doors.records].map(([id, record]) => [id, record.progress]),
));
await page.evaluate(() => {
  const canvas = document.querySelector('#viewer-canvas');
  let locked = null;
  window.__polishbPointerRequests = [];
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
  canvas.requestPointerLock = () => {
    window.__polishbPointerRequests.push({
      walkthroughActive: window.__listing.walkthrough.active,
      userActivation: navigator.userActivation?.isActive ?? null,
    });
    locked = canvas;
    document.dispatchEvent(new Event('pointerlockchange'));
    return Promise.resolve();
  };
  document.exitPointerLock = () => {
    locked = null;
    document.dispatchEvent(new Event('pointerlockchange'));
  };
});
await page.locator('.walk-trigger-header').click();
await page.waitForFunction(() => window.__listing.walkthrough.active);
await page.waitForFunction(() => window.__listing.walkthrough.pointerLocked);
await page.evaluate(() => {
  window.__listing.viewer.camera.position.set(-7.05, 1.6, 3.55);
  window.__listing.walkthrough.setHeading(0.027);
});
await page.waitForFunction(() => !document.querySelector('.walkthrough-door-hint').hidden);
const targetDoor = await page.evaluate(() => {
  const hint = document.querySelector('.walkthrough-door-hint');
  const record = [...window.__listing.viewer.doors.records.values()].find((door) => (
    Math.abs(door.center?.[0] + 7.1) < 0.02 && Math.abs(door.center?.[1] - 1.7) < 0.02
  ));
  return { id: record?.id, progress: record?.progress, hint: hint?.textContent };
});
const doorFocusPath = join(output, 'polishb-walkthrough-door-focus.png');
await page.screenshot({ path: doorFocusPath });
await page.mouse.click(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
await page.waitForFunction((id) => {
  const record = window.__listing.viewer.doors.records.get(id);
  return record?.moving && record.progress > 0.35 && record.progress < 0.65;
}, targetDoor.id);
const doorMid = await page.evaluate((id) => {
  const record = window.__listing.viewer.doors.records.get(id);
  return {
    id,
    progress: record.progress,
    time: record.action.time,
    moving: record.moving,
    targetProgress: record.targetProgress,
    hint: document.querySelector('.walkthrough-door-hint')?.textContent,
    hintDoorId: document.querySelector('.walkthrough-door-hint')?.dataset.doorId,
  };
}, targetDoor.id);
const doorMidPath = join(output, 'polishb-walkthrough-door-mid-open.png');
await page.screenshot({ path: doorMidPath });
await page.evaluate(() => document.exitPointerLock());
await page.waitForFunction(() => !window.__listing.walkthrough.active);
await page.waitForFunction(() => window.__listing.viewer.zones.records.every((zone) => (
  Math.abs(zone.current - zone.target) < 0.001
)) && Math.abs(window.__listing.story.value - window.__listing.story.targetValue) < 0.001);
await page.waitForTimeout(300);
const reconciledDoors = await page.evaluate(() => Object.fromEntries(
  [...window.__listing.viewer.doors.records].map(([id, record]) => [id, { progress: record.progress, moving: record.moving }]),
));
const countBeforeIdle = await page.evaluate(() => window.__listing.viewer.renderCount);
await page.waitForTimeout(900);
const countAfterIdle = await page.evaluate(() => window.__listing.viewer.renderCount);

const report = {
  backend: await page.evaluate(() => window.__listing.backend),
  planLow,
  entree,
  wc,
  pointerLockRequests: await page.evaluate(() => window.__polishbPointerRequests),
  targetDoor,
  doorMid,
  preWalkDoors,
  reconciledDoors,
  idleRenderCounts: [countBeforeIdle, countAfterIdle],
  consoleErrors,
  pageErrors,
  screenshots: [planLowPath, entree.path, wc.path, doorFocusPath, doorMidPath],
};
writeFileSync(join(output, 'polishb-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
console.log(JSON.stringify(report, null, 2));
