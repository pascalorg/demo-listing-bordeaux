import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = process.argv[2] || 'http://127.0.0.1:5199/?forceWebGL=1&pose';
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

async function settle(expectedValue) {
  await page.waitForFunction(() => {
    const listing = window.__listing;
    return Math.abs(listing.story.value - listing.story.targetValue) < 0.0003
      && listing.viewer.convergenceFramesRemaining === 0;
  }, null, { timeout: 12000 });
  if (expectedValue != null) {
    await page.waitForFunction((expected) => (
      Math.abs(window.__listing.story.targetValue - expected) < 0.003
    ), expectedValue, { timeout: 3000 });
  }
}

async function seekStoryValue(value) {
  const beat = Math.floor(value);
  const localTarget = value - beat;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 16; index += 1) {
    const local = (low + high) / 2;
    await page.evaluate(({ raw }) => {
      const track = document.querySelector('#story-track');
      window.scrollTo({ top: track.offsetTop + raw * innerHeight, behavior: 'instant' });
    }, { raw: beat + local });
    await page.waitForTimeout(20);
    const actual = await page.evaluate(() => window.__listing.story.targetValue % 1);
    if (actual < localTarget) low = local;
    else high = local;
  }
  const raw = beat + (low + high) / 2;
  await page.evaluate((next) => {
    const track = document.querySelector('#story-track');
    window.scrollTo({ top: track.offsetTop + next * innerHeight, behavior: 'instant' });
  }, raw);
  await settle(value);
}

async function state() {
  return page.evaluate(() => {
    const listing = window.__listing;
    const ids = ['door_cvdmtaj49xgwpnfh', 'door_2udbl7hf9ws2cdnr'];
    return {
      beat: listing.story.beat,
      value: listing.story.value,
      camera: {
        eye: listing.viewer.camera.position.toArray(),
        quaternion: listing.viewer.camera.quaternion.toArray(),
        fov: listing.viewer.camera.fov,
      },
      doors: Object.fromEntries(ids.map((id) => {
        const record = listing.viewer.doors.records.get(id);
        return [id, {
          clip: record?.clip?.name,
          duration: record?.clip?.duration,
          progress: record?.progress,
          actionTime: record?.action?.time,
          paused: record?.action?.paused,
          moving: record?.moving,
        }];
      })),
      renderCount: listing.viewer.renderCount,
      convergenceFramesRemaining: listing.viewer.convergenceFramesRemaining,
    };
  });
}

const captures = [];
for (const progress of [0.3, 0.6, 0.9]) {
  console.log(`capturing floor-sejour ${progress}`);
  await seekStoryValue(1 + progress);
  const path = `${outputDir}door1-floor-sejour-t${String(progress).replace('.', '')}.png`;
  await page.screenshot({ path });
  captures.push({ path, state: await state() });
}

await seekStoryValue(2);
console.log('capturing sejour reached');
let path = `${outputDir}door1-sejour-open.png`;
await page.screenshot({ path });
captures.push({ path, state: await state() });

await seekStoryValue(5.55);
console.log('capturing suite-salledeau');
path = `${outputDir}door1-suite-salledeau-mid.png`;
await page.screenshot({ path });
captures.push({ path, state: await state() });

await page.evaluate(() => {
  const track = document.querySelector('#story-track');
  window.scrollTo({ top: track.offsetTop, behavior: 'instant' });
});
console.log('capturing direct dot jump');
await page.waitForFunction(() => window.__listing.story.targetValue < 0.003);
await settle(0);
await page.locator('#chapter-rail button').nth(8).click();
await page.waitForFunction(() => window.__listing.story.targetValue > 7.997);
await settle(8);
await page.evaluate(() => {
  window.__listing.story.flyTo({
    eye: [-1.35, 1.62, -3.1],
    tgt: [-5.5, 1.2, -3.0],
    fov: 62,
  });
});
await page.waitForTimeout(1100);
await page.waitForFunction(() => window.__listing.viewer.convergenceFramesRemaining === 0);
path = `${outputDir}door1-direct-dot-late.png`;
await page.screenshot({ path });
captures.push({ path, state: await state() });

await seekStoryValue(1.6);
console.log('capturing pose overlay');
await page.keyboard.press('c');
await page.waitForTimeout(80);
path = `${outputDir}door1-pose-overlay.png`;
await page.screenshot({ path });
captures.push({ path, state: await state() });
const clipboardText = await page.evaluate(() => navigator.clipboard.readText());

const idle = await page.evaluate(async () => {
  const viewer = window.__listing.viewer;
  const before = viewer.renderCount;
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { before, after: viewer.renderCount, remaining: viewer.convergenceFramesRemaining };
});

const hashUrl = new URL(baseUrl);
hashUrl.searchParams.set('hashAudit', '1');
hashUrl.hash = 'plan';
console.log('checking hash navigation');
await page.goto(hashUrl.href, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__listing?.viewer && document.documentElement.dataset.modelReady === '1');
await page.waitForFunction(() => window.__listing.story.targetValue > 7.997);
await settle(8);
const hashState = await state();
console.log('checking hash reload');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__listing?.viewer && window.__listing.story.targetValue > 7.997);
await settle(8);
const reloadState = await state();
await page.evaluate(() => window.__listing.walkthrough.enter());
await page.waitForFunction(() => window.__listing.walkthrough.active);
await page.evaluate(() => window.__listing.walkthrough.setHeading(0.7));
await page.waitForTimeout(120);
const walkthroughPose = await page.evaluate(() => ({
  text: document.querySelector('.pose-capture')?.textContent,
  eye: window.__listing.viewer.camera.position.toArray(),
  direction: window.__listing.viewer.camera.getWorldDirection(new window.__listing.viewer.camera.position.constructor()).toArray(),
}));
await page.evaluate(() => window.__listing.walkthrough.exit());

const noPosePage = await browser.newPage({ viewport: { width: 800, height: 600 } });
const noPoseUrl = new URL(baseUrl);
noPoseUrl.searchParams.delete('pose');
await noPosePage.goto(noPoseUrl.href, { waitUntil: 'networkidle' });
await noPosePage.waitForFunction(() => window.__listing?.viewer);
const noPoseDomCount = await noPosePage.locator('.pose-capture').count();
await noPosePage.close();

const report = {
  baseUrl,
  consoleErrors,
  pageErrors,
  captures,
  clipboardText,
  idle,
  hashState,
  reloadState,
  walkthroughPose,
  noPoseDomCount,
};
await writeFile(`${outputDir}door1-report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
