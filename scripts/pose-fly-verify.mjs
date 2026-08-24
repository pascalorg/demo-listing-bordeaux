import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.argv[2] || 'http://localhost:5199/?forceWebGL=1&pose#sejour';
const outputDir = new URL('../scratchpad/verify/', import.meta.url).pathname;
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__listing?.viewer && document.documentElement.dataset.modelReady === '1');
await page.waitForFunction(() => Math.abs(window.__listing.story.targetValue - 2) < 0.003);
await page.waitForFunction(() => (
  Math.abs(window.__listing.story.value - window.__listing.story.targetValue) < 0.0003
  && window.__listing.viewer.convergenceFramesRemaining === 0
));

const startPose = await page.evaluate(() => ({
  eye: window.__listing.viewer.camera.position.toArray(),
  fov: window.__listing.viewer.camera.fov,
}));

await page.keyboard.press('f');
await page.waitForFunction(() => document.querySelector('.pose-capture')?.classList.contains('is-fly'));
if (!await page.evaluate(() => document.pointerLockElement === document.querySelector('#viewer-canvas'))) {
  await page.locator('#viewer-canvas').click({ position: { x: 720, y: 450 } });
  await page.waitForTimeout(100);
}
const pointerLocked = await page.evaluate(() => document.pointerLockElement === document.querySelector('#viewer-canvas'));

if (pointerLocked) {
  await page.mouse.move(720, 450);
  await page.mouse.move(720, 1200);
} else {
  await page.evaluate(() => {
    const canvas = document.querySelector('#viewer-canvas');
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: canvas });
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: 1200 }));
    delete document.pointerLockElement;
  });
}
await page.mouse.wheel(0, -320);
await page.keyboard.down('Shift');
await page.keyboard.down('e');
await page.waitForTimeout(1550);
await page.keyboard.up('e');
await page.keyboard.up('Shift');
for (let index = 0; index < 7; index += 1) await page.keyboard.press(']');
await page.waitForTimeout(100);

await page.waitForFunction(() => window.__listing.viewer.camera.position.y > 8);
await page.waitForFunction(() => window.__listing.viewer.camera.fov > 68.5);
await page.waitForFunction(() => window.__listing.viewer.convergenceFramesRemaining === 0);
const flyPose = await page.evaluate(() => ({
  eye: window.__listing.viewer.camera.position.toArray(),
  direction: window.__listing.viewer.camera.getWorldDirection(
    new window.__listing.viewer.camera.position.constructor(),
  ).toArray(),
  fov: window.__listing.viewer.camera.fov,
  overlay: document.querySelector('.pose-capture')?.textContent,
  flyClass: document.querySelector('.pose-capture')?.classList.contains('is-fly'),
  storyValue: window.__listing.story.value,
}));
await page.keyboard.press('c');
await page.waitForTimeout(80);
const clipboardText = await page.evaluate(() => navigator.clipboard.readText());

const screenshot = `${outputDir}pose-fly-high-topdown.png`;
await page.screenshot({ path: screenshot });

const flyIdle = await page.evaluate(async () => {
  const viewer = window.__listing.viewer;
  const before = viewer.renderCount;
  await new Promise((resolve) => setTimeout(resolve, 900));
  return { before, after: viewer.renderCount, remaining: viewer.convergenceFramesRemaining };
});

await page.keyboard.press('f');
await page.waitForFunction(() => !document.querySelector('.pose-capture')?.textContent.includes('RETURN'));
await page.waitForTimeout(5000);
await page.waitForFunction(() => window.__listing.viewer.convergenceFramesRemaining === 0);
const returnedPose = await page.evaluate(() => ({
  eye: window.__listing.viewer.camera.position.toArray(),
  fov: window.__listing.viewer.camera.fov,
  overlay: document.querySelector('.pose-capture')?.textContent,
  pointerLocked: document.pointerLockElement != null,
}));
const returnIdle = await page.evaluate(async () => {
  const viewer = window.__listing.viewer;
  const before = viewer.renderCount;
  await new Promise((resolve) => setTimeout(resolve, 900));
  return { before, after: viewer.renderCount, remaining: viewer.convergenceFramesRemaining };
});

await page.keyboard.press('f');
await page.waitForFunction(() => document.querySelector('.pose-capture')?.classList.contains('is-fly'));
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.pose-capture')?.textContent.includes('RETURN'));
const escapeReturned = await page.evaluate(() => ({
  flyClass: document.querySelector('.pose-capture')?.classList.contains('is-fly'),
  pointerLocked: document.pointerLockElement != null,
}));

const noPosePage = await browser.newPage({ viewport: { width: 800, height: 600 } });
const noPoseUrl = new URL(baseUrl);
noPoseUrl.searchParams.delete('pose');
noPoseUrl.hash = '';
await noPosePage.goto(noPoseUrl.href, { waitUntil: 'networkidle' });
await noPosePage.waitForFunction(() => window.__listing?.viewer);
const noPoseDomCount = await noPosePage.locator('.pose-capture').count();
await noPosePage.close();

const report = {
  baseUrl,
  consoleErrors,
  pageErrors,
  pointerLocked,
  startPose,
  flyPose,
  clipboardText,
  flyIdle,
  returnedPose,
  returnIdle,
  escapeReturned,
  noPoseDomCount,
  screenshot,
};
await writeFile(`${outputDir}pose-fly-report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
