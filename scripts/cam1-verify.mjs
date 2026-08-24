import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const baseUrl = process.argv[2] || 'http://127.0.0.1:5199/?forceWebGL=1&pose';
const outputDir = new URL('../scratchpad/verify/', import.meta.url).pathname;
const layout = JSON.parse(await readFile(new URL('../public/assets/data/layout.json', import.meta.url), 'utf8'));
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
  await page.waitForFunction(() => (
    Math.abs(window.__listing.story.value - window.__listing.story.targetValue) < 0.0003
  ), null, { timeout: 10_000 });
  await page.waitForTimeout(80);
}

async function seekStoryValue(value) {
  const beat = Math.floor(value);
  const localTarget = value - beat;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 18; index += 1) {
    const local = (low + high) / 2;
    await page.evaluate((raw) => {
      const track = document.querySelector('#story-track');
      window.scrollTo({ top: track.offsetTop + raw * innerHeight, behavior: 'instant' });
    }, beat + local);
    await page.waitForTimeout(16);
    const actual = await page.evaluate(() => window.__listing.story.targetValue % 1);
    if (actual < localTarget) low = local;
    else high = local;
  }
  await page.evaluate((raw) => {
    const track = document.querySelector('#story-track');
    window.scrollTo({ top: track.offsetTop + raw * innerHeight, behavior: 'instant' });
  }, beat + (low + high) / 2);
  await settle(value);
}

async function state() {
  return page.evaluate(() => {
    const listing = window.__listing;
    const target = new listing.viewer.camera.position.constructor();
    listing.story.copyCameraTarget(target);
    const windowRecord = listing.viewer.windows.records.get('window_cheeuc6e0qbb0e44');
    const doorRecord = listing.viewer.doors.records.get('door_2udbl7hf9ws2cdnr');
    return {
      value: listing.story.value,
      beat: listing.story.beat,
      moment: listing.story.moment,
      camera: {
        eye: listing.viewer.camera.position.toArray(),
        tgt: target.toArray(),
        fov: listing.viewer.camera.fov,
      },
      window: {
        clip: windowRecord?.clip?.name,
        duration: windowRecord?.clip?.duration,
        progress: windowRecord?.progress,
        actionTime: windowRecord?.action?.time,
        paused: windowRecord?.action?.paused,
        moving: windowRecord?.moving,
      },
      pocketDoor: {
        clip: doorRecord?.clip?.name,
        progress: doorRecord?.progress,
        actionTime: doorRecord?.action?.time,
        paused: doorRecord?.action?.paused,
      },
    };
  });
}

const captures = [];
async function capture(name, value) {
  await seekStoryValue(value);
  const path = `${outputDir}${name}`;
  await page.screenshot({ path });
  captures.push({ path, state: await state() });
}

await capture('cam1-floor-sejour-t036.png', 1.36);
await page.keyboard.press('c');
await page.waitForTimeout(80);
const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
await capture('cam1-balcon-chambre1-t043.png', 4.43);
await capture('cam1-balcon-chambre1-window-entry.png', 4.62);
await capture('cam1-chambre1-arrival.png', 5);
await capture('cam1-chambre1-salledeau-t035.png', 5.35);
await capture('cam1-salledeau-arrival.png', 6);
await capture('cam1-salledeau-chambres-t016.png', 6.16);

const sampledPath = [];
const pathSampleCount = 50;
for (let index = 0; index <= pathSampleCount; index += 1) {
  const progress = index / pathSampleCount;
  await seekStoryValue(6 + progress);
  sampledPath.push(await state());
}

function pointSegmentDistance([x, z], start, end) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length2 = dx * dx + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((x - start[0]) * dx + (z - start[1]) * dz) / length2)) : 0;
  return Math.hypot(x - start[0] - t * dx, z - start[1] - t * dz);
}

const walls = Object.values(layout.nodes).filter((node) => node.type === 'wall' && node.start && node.end);
const openings = Object.values(layout.nodes).filter((node) => node.type === 'door' || node.type === 'window');
const wallClearance = sampledPath.map((sample, index) => {
  const [x, y, z] = sample.camera.eye;
  const distances = walls.map((wall) => {
    const distance = pointSegmentDistance([x, z], wall.start, wall.end);
    const inOpening = openings.some((opening) => {
      if ((opening.wallId || opening.parentId) !== wall.id) return false;
      const dx = wall.end[0] - wall.start[0];
      const dz = wall.end[1] - wall.start[1];
      const length = Math.hypot(dx, dz) || 1;
      const center = [
        wall.start[0] + (dx / length) * Number(opening.position?.[0] || 0),
        wall.start[1] + (dz / length) * Number(opening.position?.[0] || 0),
      ];
      return Math.hypot(x - center[0], z - center[1]) <= Number(opening.width || 0.8) / 2;
    });
    return { id: wall.id, distance, inOpening };
  }).filter(({ inOpening }) => !inOpening).sort((a, b) => a.distance - b.distance);
  return { progress: index / pathSampleCount, eye: sample.camera.eye, nearest: distances[0] };
});
const belowWallTop = wallClearance.filter((sample) => sample.eye[1] <= 2.5);
const collisionAudit = {
  samples: sampledPath.length,
  clearanceThreshold: 0.12,
  minimumBelowWallTop: belowWallTop.sort((a, b) => a.nearest.distance - b.nearest.distance)[0],
  collisions: belowWallTop.filter((sample) => sample.nearest.distance < 0.12),
};

const report = {
  baseUrl,
  backend: await page.evaluate(() => window.__listing.backend),
  consoleErrors,
  pageErrors,
  clipboardText,
  captures,
  collisionAudit,
};
await writeFile(`${outputDir}cam1-report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
