import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:5199/';
const outputDir = join(process.cwd(), 'scratchpad', 'verify');
const reportPath = join(outputDir, 'cam2-report.json');
const WINDOW_ID = 'window_cheeuc6e0qbb0e44';
const FRENCH_DOOR_ID = 'door_cvdmtaj49xgwpnfh';
const POCKET_DOOR_ID = 'door_2udbl7hf9ws2cdnr';
const layout = JSON.parse(readFileSync(join(process.cwd(), 'public', 'assets', 'data', 'layout.json'), 'utf8'));
const windowOpening = layout.nodes[WINDOW_ID];
const windowWall = layout.nodes[windowOpening.wallId || windowOpening.parentId];

function windowWallClearance(eye) {
  const [startX, startZ] = windowWall.start;
  const dx = windowWall.end[0] - startX;
  const dz = windowWall.end[1] - startZ;
  const length = Math.hypot(dx, dz) || 1;
  const tx = dx / length;
  const tz = dz / length;
  const nx = -tz;
  const nz = tx;
  const along = (eye[0] - startX) * tx + (eye[2] - startZ) * tz;
  const planeDistance = Math.abs((eye[0] - startX) * nx + (eye[2] - startZ) * nz);
  const openingCenter = Number(windowOpening.position?.[0] || 0);
  const halfWidth = Number(windowOpening.width || 0.8) / 2;
  const openingCenterY = Number(windowOpening.position?.[1] || 1.1);
  const halfHeight = Number(windowOpening.height || 2) / 2;
  const openingMin = openingCenter - halfWidth;
  const openingMax = openingCenter + halfWidth;
  const openingMinY = openingCenterY - halfHeight;
  const openingMaxY = openingCenterY + halfHeight;
  const insideWallSpan = along >= 0 && along <= length && eye[1] >= 0 && eye[1] <= 2.5;
  const insideOpening = along >= openingMin && along <= openingMax
    && eye[1] >= openingMinY && eye[1] <= openingMaxY;
  const inPlaneDistance = insideOpening
    ? Math.min(along - openingMin, openingMax - along, eye[1] - openingMinY, openingMaxY - eye[1])
    : 0;
  return {
    distance: insideWallSpan ? Math.hypot(planeDistance, inPlaneDistance) : Infinity,
    planeDistance,
    inPlaneDistance,
    insideOpening,
  };
}

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

function observeErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

async function openListing(browser, query, reducedMotion = false) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  const errors = observeErrors(page);
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  await page.goto(url.href, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForFunction(() => window.__listing?.viewer && document.documentElement.dataset.modelReady === '1');
  return { page, errors, url: url.href };
}

async function seekStoryValue(page, value) {
  const raw = await page.evaluate(async (desired) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return desired;
    const { mapDwellProgress } = await import('/src/story.js');
    const beat = Math.floor(desired);
    const local = desired - beat;
    let low = 0;
    let high = 1;
    for (let index = 0; index < 30; index += 1) {
      const middle = (low + high) / 2;
      if (mapDwellProgress(beat + middle) - beat < local) low = middle;
      else high = middle;
    }
    return beat + (low + high) / 2;
  }, value);
  await page.evaluate((next) => {
    document.documentElement.style.scrollBehavior = 'auto';
    const track = document.querySelector('#story-track');
    window.scrollTo({ top: track.offsetTop + next * innerHeight, behavior: 'instant' });
  }, raw);
  try {
    await page.waitForFunction((expected) => (
      Math.abs(window.__listing.story.targetValue - expected) < 0.006
        && Math.abs(window.__listing.story.value - expected) < 0.006
    ), value, { timeout: 15_000 });
  } catch (error) {
    const actual = await page.evaluate(() => ({
      value: window.__listing.story.value,
      targetValue: window.__listing.story.targetValue,
      scrollY,
    }));
    throw new Error(`seek ${value} via raw ${raw} stalled at ${JSON.stringify(actual)}: ${error.message}`);
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

async function state(page) {
  return page.evaluate(({ windowId, frenchDoorId, pocketDoorId }) => {
    const listing = window.__listing;
    const target = new listing.viewer.camera.position.constructor();
    listing.story.copyCameraTarget(target);
    const opening = (records, id) => {
      const record = records.get(id);
      return {
        progress: record?.progress,
        actionTime: record?.action?.time,
        duration: record?.clip?.duration,
        paused: record?.action?.paused,
        moving: record?.moving,
      };
    };
    return {
      value: listing.story.value,
      beat: listing.story.beat,
      camera: {
        eye: listing.viewer.camera.position.toArray(),
        tgt: target.toArray(),
        fov: listing.viewer.camera.fov,
      },
      openings: {
        frenchDoor: opening(listing.viewer.doors.records, frenchDoorId),
        window: opening(listing.viewer.windows.records, windowId),
        pocketDoor: opening(listing.viewer.doors.records, pocketDoorId),
      },
      zones: {
        residualCurrent: Math.max(...listing.viewer.zones.records.map((record) => record.current)),
        visibleMeshes: listing.viewer.zones.records
          .flatMap((record) => record.meshes)
          .filter((mesh) => mesh.visible).length,
        visibleLabels: [...document.querySelectorAll('.zone-label')]
          .filter((label) => !label.hidden && Number(getComputedStyle(label).opacity) > 0.01).length,
      },
    };
  }, { windowId: WINDOW_ID, frenchDoorId: FRENCH_DOOR_ID, pocketDoorId: POCKET_DOOR_ID });
}

async function windowMeshClearance(page) {
  return page.evaluate((windowId) => {
    const listing = window.__listing;
    const eye = listing.viewer.camera.position;
    const root = listing.viewer.model.getObjectByName(windowId)
      || listing.viewer.model.getObjectByProperty('pascalId', windowId);
    const clearances = [];
    root?.updateWorldMatrix(true, true);
    root?.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const local = mesh.geometry.boundingBox;
      if (!local) return;
      const Vector = eye.constructor;
      const localEye = mesh.worldToLocal(eye.clone());
      const worldScale = mesh.getWorldScale(new Vector());
      const dx = Math.max(local.min.x - localEye.x, 0, localEye.x - local.max.x) * Math.abs(worldScale.x);
      const dy = Math.max(local.min.y - localEye.y, 0, localEye.y - local.max.y) * Math.abs(worldScale.y);
      const dz = Math.max(local.min.z - localEye.z, 0, localEye.z - local.max.z) * Math.abs(worldScale.z);
      clearances.push({
        mesh: mesh.name,
        distance: Math.hypot(dx, dy, dz),
        localEye: localEye.toArray(),
        localBounds: { min: local.min.toArray(), max: local.max.toArray() },
      });
    });
    clearances.sort((a, b) => a.distance - b.distance);
    return clearances[0] || null;
  }, WINDOW_ID);
}

mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: fullChromium(),
  headless: false,
  args: ['--headless=new', '--use-angle=metal', '--enable-unsafe-webgpu'],
});

const direct = await openListing(browser, { forceWebGL: '1', pose: '' }, true);
const { page } = direct;
const captures = [];
await page.addStyleTag({ content: '.beat-photo-card { display: none !important; }' });

await seekStoryValue(page, 1);
const blinkSamples = [];
for (const value of [1.49, 1.501, 1.51, 1.55]) {
  if (value > 1.49) await seekStoryValue(page, 1);
  await seekStoryValue(page, value);
  const sample = await state(page);
  blinkSamples.push(sample);
  if (value === 1.501) {
    const path = join(outputDir, 'cam2-floor-sejour-no-zone-blink-t0501.png');
    await page.screenshot({ path });
    captures.push({ path, state: sample });
  }
}

const scrubCaptures = [
  { value: 1.51, name: 'cam2-floor-sejour-before-scrub-t051.png', key: 'frenchDoor' },
  { value: 4.46, name: 'cam2-balcon-chambre1-before-scrub-t046.png', key: 'window' },
  { value: 5.57, name: 'cam2-chambre1-salledeau-before-scrub-t057.png', key: 'pocketDoor' },
];
for (const definition of scrubCaptures) {
  await seekStoryValue(page, definition.value);
  const sample = await state(page);
  const path = join(outputDir, definition.name);
  await page.screenshot({ path });
  captures.push({ path, state: sample });
  if (sample.openings[definition.key].progress !== 0 || sample.openings[definition.key].actionTime !== 0) {
    throw new Error(`${definition.key} was not closed below its scrub start: ${JSON.stringify(sample)}`);
  }
}

await seekStoryValue(page, 4.7);
const waypointState = await state(page);
const waypointPath = join(outputDir, 'cam2-balcon-chambre1-corridor-t070.png');
await page.screenshot({ path: waypointPath });
captures.push({ path: waypointPath, state: waypointState });

const clearanceSamples = [];
for (let index = 0; index <= 25; index += 1) {
  const progress = 0.4 + (0.5 * index) / 25;
  await seekStoryValue(page, 4 + progress);
  const sampleState = await state(page);
  clearanceSamples.push({
    progress,
    camera: sampleState.camera,
    nearestWindowMesh: await windowMeshClearance(page),
    wall: windowWallClearance(sampleState.camera.eye),
  });
}
const clearanceAudit = {
  range: [0.4, 0.9],
  samples: clearanceSamples.length,
  cameraRadius: 0.1,
  minimumWindowMesh: [...clearanceSamples].sort(
    (a, b) => a.nearestWindowMesh.distance - b.nearestWindowMesh.distance,
  )[0],
  minimumWall: [...clearanceSamples].sort((a, b) => a.wall.distance - b.wall.distance)[0],
  collisions: clearanceSamples.filter((sample) => (
    sample.nearestWindowMesh.distance < 0.1 || sample.wall.distance < 0.1
  )),
};

await seekStoryValue(page, 8);
const directLateState = await state(page);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__listing?.viewer && document.documentElement.dataset.modelReady === '1');
await seekStoryValue(page, 8);
const reloadLateState = await state(page);
await seekStoryValue(page, 0);
const reverseEarlyState = await state(page);

const real = await openListing(browser, { look: 'real' });
await seekStoryValue(real.page, 4);
await real.page.waitForTimeout(500);
const skyPath = join(outputDir, 'cam2-sky-real-balcon-restored.png');
await real.page.screenshot({ path: skyPath });
const skyState = {
  backend: await real.page.evaluate(() => window.__listing.backend),
  look: await real.page.evaluate(() => window.__listing.viewer.look),
  camera: (await state(real.page)).camera,
  path: skyPath,
};

const sketch = await openListing(browser, { look: 'sketch' });
await seekStoryValue(sketch.page, 2);
const sketchState = await sketch.page.evaluate(() => ({
  backend: window.__listing.backend,
  look: window.__listing.viewer.look,
  renderCount: window.__listing.viewer.renderCount,
}));

const report = {
  baseUrl,
  direct: {
    backend: await page.evaluate(() => window.__listing.backend),
    consoleErrors: direct.errors.consoleErrors,
    pageErrors: direct.errors.pageErrors,
  },
  blinkSamples,
  waypointState,
  clearanceAudit,
  endStateConsistency: { directLateState, reloadLateState, reverseEarlyState },
  skyState,
  realErrors: real.errors,
  sketchState,
  sketchErrors: sketch.errors,
  captures,
};

if (blinkSamples.some((sample) => sample.zones.visibleMeshes !== 0)) {
  throw new Error(`Zone mesh appeared during label/off stepping: ${JSON.stringify(blinkSamples)}`);
}
if (clearanceAudit.collisions.length) {
  throw new Error(`Camera entered the window/sash/wall clearance radius: ${JSON.stringify(clearanceAudit)}`);
}
if ([direct.errors, real.errors, sketch.errors]
  .some((errors) => errors.consoleErrors.length || errors.pageErrors.length)) {
  throw new Error(`Browser errors: ${JSON.stringify({ direct: direct.errors, real: real.errors, sketch: sketch.errors })}`);
}

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  reportPath,
  blinkSamples: blinkSamples.map(({ value, zones }) => ({ value, zones })),
  waypointState,
  clearanceAudit,
  skyState,
  sketchState,
}, null, 2));
await browser.close();
