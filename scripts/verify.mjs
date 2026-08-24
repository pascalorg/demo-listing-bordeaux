#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import pngjs from 'pngjs';
import { BUILDING_ID, PHOTO_CAMS } from '../src/config.js';

const { PNG } = pngjs;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = resolve(process.env.VERIFY_OUTPUT_DIR || join(ROOT, 'scratchpad', 'verify'));
const RESULT_PATH = join(ROOT, 'VERIFY-RESULT.md');
const READY_TIMEOUT = 30_000;
const SETTLE_MS = 1_200;
const EXPECTED_BEATS = ['hero', 'floor', 'sejour', 'staging', 'balcon', 'chambre1', 'salledeau', 'chambres', 'plan'];
const CALIBRATION_ONLY = process.argv.includes('--calib');
const WEBGL2_ONLY = process.argv.includes('--webgl2-only');

function findFullChromium() {
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
  throw new Error(`No full Chromium executable found under ${cache}`);
}

async function responds(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function runBuild() {
  const child = spawn('bun', ['run', 'build'], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  if (code !== 0) throw new Error(`bun run build exited with ${code}:\n${output}`);
  process.stdout.write(output);
}

async function ensureSite() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn('bun', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`bun run preview exited with ${child.exitCode}:\n${output}`);
    if (await responds(url)) return { url, process: child, note: `isolated preview of fresh dist on port ${port}` };
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`Timed out starting bun run preview:\n${output}`);
}

function comparePngs(visibleBuffer, hiddenBuffer) {
  const visible = PNG.sync.read(visibleBuffer);
  const hidden = PNG.sync.read(hiddenBuffer);
  if (visible.width !== hidden.width || visible.height !== hidden.height) {
    throw new Error('Canvas evidence screenshots have different dimensions');
  }
  let changedPixels = 0;
  for (let offset = 0; offset < visible.data.length; offset += 4) {
    const difference = Math.abs(visible.data[offset] - hidden.data[offset])
      + Math.abs(visible.data[offset + 1] - hidden.data[offset + 1])
      + Math.abs(visible.data[offset + 2] - hidden.data[offset + 2]);
    if (difference > 12) changedPixels += 1;
  }
  return { changedPixels, totalPixels: visible.width * visible.height };
}

async function canvasEvidence(page) {
  const canvas = page.locator('#viewer-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('Canvas has no nonzero layout area');
  }

  const previousStyle = await canvas.getAttribute('style');
  await canvas.evaluate((element) => {
    element.style.transition = 'none';
    element.style.opacity = '1';
  });
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const visible = await page.locator('#stage').screenshot();
  await canvas.evaluate((element) => { element.style.opacity = '0'; });
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const hidden = await page.locator('#stage').screenshot();
  await canvas.evaluate((element, style) => {
    if (style === null) element.removeAttribute('style');
    else element.setAttribute('style', style);
  }, previousStyle);

  const comparison = comparePngs(visible, hidden);
  if (comparison.changedPixels === 0) throw new Error('Canvas produced no compositor-visible pixels');
  return { ...comparison, width: Math.round(box.width), height: Math.round(box.height) };
}

function errorText(error) {
  return error?.stack || error?.message || String(error);
}

async function waitForVisibleImage(page, rootSelector, expectedFile) {
  await page.waitForFunction(({ selector, file }) => {
    const root = document.querySelector(selector);
    const current = root?.querySelector('img.is-current');
    if (!current || !new URL(current.currentSrc || current.src, location.href).pathname.endsWith(`/${file}`)) return false;
    if (!current.complete || !current.naturalWidth || Number(getComputedStyle(current).opacity) < 0.999) return false;
    return [...root.querySelectorAll('img:not(.is-current)')]
      .every((image) => Number(getComputedStyle(image).opacity) < 0.001);
  }, { selector: rootSelector, file: expectedFile }, { timeout: 8_000, polling: 'raf' });

  const visible = await page.locator(rootSelector).evaluate((root) => {
    const current = root.querySelector('img.is-current');
    return {
      source: new URL(current.currentSrc || current.src, location.href).pathname,
      opacity: Number(getComputedStyle(current).opacity),
      obscuringSources: [...root.querySelectorAll('img:not(.is-current)')]
        .filter((image) => Number(getComputedStyle(image).opacity) >= 0.001)
        .map((image) => new URL(image.currentSrc || image.src, location.href).pathname),
    };
  });
  if (!visible.source.endsWith(`/${expectedFile}`) || visible.opacity < 0.999 || visible.obscuringSources.length) {
    throw new Error(`visible image state was ${JSON.stringify(visible)}, expected ${expectedFile}`);
  }
  return visible;
}

async function runMode({ id, description, launchOptions, expectedBackend, urlSuffix = '', smokeOnly = false }, executablePath, url) {
  const result = {
    id,
    description,
    launched: false,
    backend: null,
    ready: false,
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    screenshots: [],
    featureProbes: [],
    failures: [],
    canvas: null,
  };
  let browser;

  try {
    browser = await chromium.launch({ executablePath, ...launchOptions });
    result.launched = true;
  } catch (error) {
    result.failures.push(`Browser launch failed: ${errorText(error)}`);
    return result;
  }

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    page.on('console', (message) => {
      const entry = message.text();
      if (message.type() === 'error') result.consoleErrors.push(entry);
      if (message.type() === 'warning') result.consoleWarnings.push(entry);
    });
    page.on('pageerror', (error) => result.pageErrors.push(errorText(error)));

    try {
      await page.goto(`${url}${urlSuffix}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (error) {
      result.failures.push(`Site load failed: ${errorText(error)}`);
    }

    try {
      await page.waitForFunction(
        () => document.documentElement.dataset.modelReady === '1' && window.__listing?.backend,
        null,
        { timeout: READY_TIMEOUT },
      );
      result.ready = true;
      result.backend = await page.evaluate(() => window.__listing.backend);
      if (expectedBackend && result.backend !== expectedBackend) {
        result.failures.push(`Expected ${expectedBackend} backend, reached ${result.backend}`);
      }
    } catch (error) {
      result.failures.push(`Model-ready was not reached within ${READY_TIMEOUT / 1000}s: ${errorText(error)}`);
    }

    const actualBeats = await page.locator('[data-beat]').evaluateAll((elements) => elements.map((element) => element.dataset.beat));
    if (JSON.stringify(actualBeats) !== JSON.stringify(EXPECTED_BEATS)) {
      result.failures.push(`Expected beats ${JSON.stringify(EXPECTED_BEATS)}, received ${JSON.stringify(actualBeats)}`);
    }

    const savePageScreenshot = async (filename) => {
      const path = join(OUTPUT_DIR, filename);
      try {
        await page.screenshot({ path });
        if (statSync(path).size === 0) throw new Error('screenshot file is empty');
        result.screenshots.push(path);
      } catch (error) {
        result.failures.push(`Screenshot ${path} failed: ${errorText(error)}`);
      }
    };

    if (smokeOnly) {
      if (result.ready) {
        try {
          result.canvas = await canvasEvidence(page);
          await savePageScreenshot(`${id}-recovery.png`);
        } catch (error) {
          result.failures.push(`Recovery canvas probe failed: ${errorText(error)}`);
        }
      }
      if (result.pageErrors.length) result.failures.push(`Expected zero pageerrors; received ${result.pageErrors.length}`);
      if (result.consoleErrors.length) result.failures.push(`Expected zero console errors; received ${result.consoleErrors.length}`);
      await context.close();
      return result;
    }

    for (const [index, beat] of EXPECTED_BEATS.entries()) {
      try {
        const target = await page.evaluate((beatIndex) => {
          const track = document.querySelector('#story-track');
          const y = track.offsetTop + beatIndex * innerHeight;
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo({ top: y, behavior: 'instant' });
          return y;
        }, index);
        await page.waitForTimeout(SETTLE_MS);
        const position = await page.evaluate(() => ({ y: scrollY, beat: window.__listing?.beat }));
        if (Math.abs(position.y - target) > 1) {
          result.failures.push(`Beat ${index} (${beat}) scroll position was ${position.y}, expected ${target}`);
        }
        if (result.ready && position.beat !== beat) {
          result.failures.push(`Beat ${index} debug handle reported ${JSON.stringify(position.beat)}, expected ${JSON.stringify(beat)}`);
        }
        await savePageScreenshot(`${id}-beat-${index}-${beat}.png`);
      } catch (error) {
        result.failures.push(`Beat ${index} (${beat}) verification failed: ${errorText(error)}`);
      }
    }

    try {
      await page.locator('#lang-toggle').click();
      await page.waitForFunction(() => document.documentElement.lang === 'en');
      await page.evaluate(() => {
        const track = document.querySelector('#story-track');
        window.scrollTo({ top: track.offsetTop, behavior: 'instant' });
      });
      await page.waitForTimeout(SETTLE_MS);
      await savePageScreenshot(`${id}-hero-en.png`);
      await page.locator('#lang-toggle').click();
      await page.waitForFunction(() => document.documentElement.lang === 'fr');
    } catch (error) {
      result.failures.push(`Language toggle verification failed: ${errorText(error)}`);
    }

    try {
      await page.evaluate(() => {
        const documentSection = document.querySelector('#document');
        window.scrollTo({ top: documentSection.offsetTop, behavior: 'instant' });
      });
      await page.waitForTimeout(500);
      await savePageScreenshot(`${id}-docs.png`);

      const documentMetrics = await page.locator('#document').evaluate((element) => ({
        top: element.offsetTop,
        height: element.offsetHeight,
        viewport: innerHeight,
      }));
      for (let y = documentMetrics.top; y < documentMetrics.top + documentMetrics.height; y += documentMetrics.viewport * 0.8) {
        await page.evaluate((scrollTop) => window.scrollTo({ top: scrollTop, behavior: 'instant' }), y);
        await page.waitForTimeout(100);
      }
      await page.waitForFunction(() => [...document.querySelectorAll('#document img')].every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 15_000 });
      const path = join(OUTPUT_DIR, `${id}-docs-full.png`);
      await page.locator('#document').screenshot({ path });
      if (statSync(path).size === 0) throw new Error('screenshot file is empty');
      result.screenshots.push(path);
      await page.locator('.fact-chip-energy').scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await savePageScreenshot('feedback-docs-energy-facts.png');
      await page.locator('.fact-dpe-badge').click();
      await page.waitForFunction(() => !document.querySelector('#lightbox').hidden);
      const lightboxState = await page.evaluate(() => ({
        caption: document.querySelector('.lightbox-frame figcaption span')?.textContent,
        naturalWidth: document.querySelector('.lightbox-frame img')?.naturalWidth,
      }));
      if (!lightboxState.caption?.startsWith('DPE — 48') || !lightboxState.naturalWidth) {
        throw new Error(`energy chart lightbox state ${JSON.stringify(lightboxState)}`);
      }
      await savePageScreenshot('feedback-lightbox-open.png');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#lightbox').hidden);
    } catch (error) {
      result.failures.push(`Document-section screenshot verification failed: ${errorText(error)}`);
    }

    if (result.ready) {
      try {
        await page.evaluate(() => {
          const track = document.querySelector('#story-track');
          window.scrollTo({ top: track.offsetTop, behavior: 'instant' });
        });
        await page.waitForTimeout(SETTLE_MS);
        result.canvas = await canvasEvidence(page);
      } catch (error) {
        result.failures.push(`Canvas pixel assertion failed: ${errorText(error)}`);
      }
    }

    if (result.ready) {
      const goToBeat = async (index) => {
        await page.evaluate((beatIndex) => {
          document.documentElement.style.scrollBehavior = 'auto';
          const track = document.querySelector('#story-track');
          window.scrollTo({ top: track.offsetTop + beatIndex * innerHeight, behavior: 'instant' });
        }, index);
      };
      const probe = async (name, action) => {
        try {
          await action();
          result.featureProbes.push(`${name}: pass`);
        } catch (error) {
          result.featureProbes.push(`${name}: fail`);
          result.failures.push(`Phase 2 probe ${name} failed: ${errorText(error)}`);
        }
      };

      await probe('updated model structure and camera clearance', async () => {
        await page.waitForFunction(() => window.__listing.viewer.doors.records.size === 12
          && [...window.__listing.viewer.doors.records.values()]
            .every((record) => record.layout && record.center), null, { timeout: 8_000 });
        const structure = await page.evaluate(async ({ buildingId, photoCams }) => {
          const viewer = window.__listing.viewer;
          const layout = await fetch('assets/data/layout.json').then((response) => response.json());
          const layoutNodes = Object.values(layout.nodes || {});
          const countLayout = (type) => layoutNodes.filter((node) => node.type === type).length;
          const kindCounts = {};
          const itemRoots = [];
          let buildingByPascalId = false;
          viewer.model.traverse((node) => {
            const kind = node.userData?.kind;
            if (kind) kindCounts[kind] = (kindCounts[kind] || 0) + 1;
            if (kind === 'item') itemRoots.push(node);
            if (node.userData?.pascalId === buildingId) buildingByPascalId = true;
          });

          const pointInsideFurniture = (coordinates) => {
            const eye = viewer.camera.position.clone().fromArray(coordinates);
            const hits = [];
            for (const root of itemRoots) {
              let inside = false;
              root.traverse((node) => {
                if (inside || !node.isMesh || !node.geometry) return;
                node.geometry.computeBoundingBox();
                const localEye = node.worldToLocal(eye.clone());
                if (node.geometry.boundingBox?.containsPoint(localEye)) inside = true;
              });
              if (inside) hits.push(root.userData?.pascalId || root.name);
            }
            return hits;
          };

          const resolvedEye = (beat) => {
            if (beat.eye) return beat.eye;
            const [azimuth, elevation, multiplier] = beat.orb;
            const verticalFov = beat.fov * Math.PI / 180;
            const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * viewer.camera.aspect);
            const sinAzimuth = Math.abs(Math.sin(azimuth));
            const cosAzimuth = Math.abs(Math.cos(azimuth));
            const projectedWidth = viewer.size.x * sinAzimuth + viewer.size.z * cosAzimuth;
            const projectedHeight = (viewer.size.x * cosAzimuth + viewer.size.z * sinAzimuth) * Math.sin(elevation)
              + viewer.size.y * Math.cos(elevation);
            const offsetPad = Math.max(
              0.5 / (0.5 - Math.min(0.4, Math.abs(beat.off[0]))),
              0.5 / (0.5 - Math.min(0.4, Math.abs(beat.off[1]))),
            );
            const distance = Math.max(
              (projectedWidth / 2) / Math.tan(horizontalFov / 2),
              (projectedHeight / 2) / Math.tan(verticalFov / 2),
            ) * 1.16 * multiplier * offsetPad;
            return [
              viewer.center.x + distance * Math.cos(elevation) * Math.cos(azimuth),
              viewer.center.y + distance * Math.sin(elevation),
              viewer.center.z + distance * Math.cos(elevation) * Math.sin(azimuth),
            ];
          };

          const storyClearance = window.__listing.story.beats.map((beat) => {
            const eye = resolvedEye(beat);
            return { id: beat.id, eye, hits: pointInsideFurniture(eye) };
          });
          const photoClearance = Object.fromEntries(Object.entries(photoCams).map(([cameraId, camera]) => [
            cameraId,
            { eye: camera.eye, hits: pointInsideFurniture(camera.eye) },
          ]));
          const doors = [...viewer.doors.records.values()].map((record) => ({
            id: record.id,
            clip: record.clip?.name || null,
            center: record.center,
            hasLayout: Boolean(record.layout),
          }));
          const zeroLengthWalls = layoutNodes.filter((node) => node.type === 'wall' && node.start && node.end
            && Math.hypot(node.end[0] - node.start[0], node.end[1] - node.start[1]) < 1e-8).length;
          return {
            buildingByName: Boolean(viewer.model.getObjectByName(buildingId)),
            buildingByPascalId,
            bounds: { min: viewer.bounds.min.toArray(), max: viewer.bounds.max.toArray() },
            layoutCounts: Object.fromEntries(['item', 'wall', 'door', 'slab', 'ceiling', 'zone']
              .map((type) => [type, countLayout(type)])),
            kindCounts,
            zeroLengthWalls,
            zoneLabels: viewer.zones.records.map((record) => record.label),
            doors,
            storyClearance,
            photoClearance,
          };
        }, { buildingId: BUILDING_ID, photoCams: PHOTO_CAMS });

        if (!structure.buildingByName && !structure.buildingByPascalId) {
          throw new Error(`building subtree ${BUILDING_ID} was not resolvable`);
        }
        const expectedLayoutCounts = { item: 45, wall: 48, door: 12, slab: 14, ceiling: 12, zone: 9 };
        if (JSON.stringify(structure.layoutCounts) !== JSON.stringify(expectedLayoutCounts)) {
          throw new Error(`layout counts were ${JSON.stringify(structure.layoutCounts)}`);
        }
        for (const [kind, expected] of Object.entries({ item: 45, door: 12, slab: 14, ceiling: 12, zone: 9 })) {
          if (structure.kindCounts[kind] !== expected) {
            throw new Error(`GLB ${kind} kind count was ${structure.kindCounts[kind]}, expected ${expected}`);
          }
        }
        if (structure.kindCounts.wall + structure.zeroLengthWalls !== expectedLayoutCounts.wall) {
          throw new Error(`GLB/layout wall coverage was ${structure.kindCounts.wall}+${structure.zeroLengthWalls}, expected 48`);
        }
        const expectedZones = ['Chambre 1', 'Salle de Bains', 'WC', 'Balcon', 'Entrée', 'Chambre 2', 'Séjour / Cuisine', "Salle d'eau", 'Chambre 3'];
        if (JSON.stringify([...structure.zoneLabels].sort()) !== JSON.stringify([...expectedZones].sort())) {
          throw new Error(`zone labels were ${JSON.stringify(structure.zoneLabels)}`);
        }
        const expectedBounds = {
          min: [-10.355504, -0.000074, -5.150154],
          max: [-0.378002, 2.55, 8.550148],
        };
        for (const side of ['min', 'max']) {
          for (let axis = 0; axis < 3; axis += 1) {
            if (Math.abs(structure.bounds[side][axis] - expectedBounds[side][axis]) > 0.005) {
              throw new Error(`bounds ${side}[${axis}] was ${structure.bounds[side][axis]}`);
            }
          }
        }
        if (structure.doors.length !== 12 || structure.doors.some((door) => !door.hasLayout || !door.center
          || door.clip !== `${door.id}: open`)) {
          throw new Error(`door controller state was ${JSON.stringify(structure.doors)}`);
        }
        for (const garnishDoor of ['door_cvdmtaj49xgwpnfh', 'door_2udbl7hf9ws2cdnr']) {
          if (!structure.doors.some((door) => door.id === garnishDoor && door.clip === `${garnishDoor}: open`)) {
            throw new Error(`beat garnish door ${garnishDoor} is not resolvable`);
          }
        }
        const blockedStory = structure.storyClearance.filter((camera) => camera.hits.length);
        const blockedPhotos = Object.entries(structure.photoClearance).filter(([, camera]) => camera.hits.length);
        if (blockedStory.length || blockedPhotos.length) {
          throw new Error(`camera/furniture bbox intersections: ${JSON.stringify({ blockedStory, blockedPhotos })}`);
        }
        result.featureProbes.push(`asset metrics: layout ${JSON.stringify(structure.layoutCounts)}, GLB walls ${structure.kindCounts.wall} + ${structure.zeroLengthWalls} zero-length layout wall`);
        result.featureProbes.push(`camera clearance: ${structure.storyClearance.length} story eyes and ${Object.keys(structure.photoClearance).length} photo eyes clear`);
      });

      await probe('deep dwell velocity pacing', async () => {
        const floor = 0.04;
        const power = 1.8;
        const steps = 2048;
        const velocityAt = (value) => floor + (1 - floor) * Math.abs(Math.sin(Math.PI * value)) ** power;
        const lookup = [0];
        let cumulative = 0;
        let previous = velocityAt(0);
        for (let index = 1; index <= steps; index += 1) {
          const next = velocityAt(index / steps);
          cumulative += (previous + next) * 0.5;
          lookup.push(cumulative);
          previous = next;
        }
        const mapped = (rawValue) => {
          const beat = Math.floor(rawValue);
          const local = rawValue - beat;
          const position = local * steps;
          const lower = Math.floor(position);
          const blend = position - lower;
          return beat + (lookup[lower] + (lookup[Math.min(lower + 1, steps)] - lookup[lower]) * blend) / cumulative;
        };
        const epsilon = 0.0001;
        const velocity = (value) => (mapped(value + epsilon) - mapped(value - epsilon)) / (2 * epsilon);
        const centerVelocity = velocity(2);
        const travelVelocity = velocity(2.5);
        const ratio = centerVelocity / travelVelocity;
        if (!(centerVelocity > 0)) throw new Error(`center velocity was ${centerVelocity.toFixed(6)}`);
        if (!(ratio < 0.10)) throw new Error(`center/travel velocity ratio was ${(ratio * 100).toFixed(2)}%`);
        result.featureProbes.push(`pacing metrics: center ${centerVelocity.toFixed(4)}, travel ${travelVelocity.toFixed(4)}, ratio ${(ratio * 100).toFixed(2)}%`);
      });

      await probe('parked story has zero idle movement', async () => {
        const metrics = await page.evaluate(async () => {
          const story = window.__listing.story;
          const track = document.querySelector('#story-track');
          window.scrollTo({ top: track.offsetTop + innerHeight * 3.37, behavior: 'instant' });
          await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
          const start = scrollY;
          let maximumMovement = 0;
          const started = performance.now();
          while (performance.now() - started < 2_000) {
            await new Promise(requestAnimationFrame);
            maximumMovement = Math.max(maximumMovement, Math.abs(scrollY - start));
          }
          return {
            maximumMovement,
            endMovement: Math.abs(scrollY - start),
            mode: story.scrollAuthority.mode,
            velocity: story.scrollAuthority.velocity,
          };
        });
        if (metrics.maximumMovement !== 0 || metrics.endMovement !== 0
          || metrics.mode !== 'idle' || metrics.velocity !== 0) {
          throw new Error(`parked state moved: ${JSON.stringify(metrics)}`);
        }
        result.featureProbes.push(`physical idle metrics: ${metrics.maximumMovement.toFixed(3)}px maximum movement over 2s, mode ${metrics.mode}, ${metrics.velocity.toFixed(2)}px/s`);
      });

      await probe('calibrated wheel impulse decays into next dwell', async () => {
        const metrics = await page.evaluate(async () => {
          const story = window.__listing.story;
          const track = document.querySelector('#story-track');
          const center = track.offsetTop + innerHeight * 2;
          window.scrollTo({ top: center, behavior: 'instant' });
          await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
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
            samples.push({ time: performance.now() - started, y: scrollY, velocity: story.scrollAuthority.velocity });
          }
          const restY = scrollY;
          await new Promise((resolveWait) => setTimeout(resolveWait, 300));
          let velocityGrowthSamples = 0;
          let backwardsSamples = 0;
          for (let index = 1; index < samples.length; index += 1) {
            if (Math.abs(samples[index].velocity) > Math.abs(samples[index - 1].velocity) + 0.01) velocityGrowthSamples += 1;
            if (samples[index].y < samples[index - 1].y) backwardsSamples += 1;
          }
          return {
            initialVelocity: samples[0].velocity,
            durationMs: samples.at(-1).time,
            travelBeats: (restY - center) / innerHeight,
            nextCenterErrorBeats: Math.abs(restY - (center + innerHeight)) / innerHeight,
            velocityGrowthSamples,
            backwardsSamples,
            postRestMovement: Math.abs(scrollY - restY),
            finalMode: story.scrollAuthority.mode,
            finalVelocity: story.scrollAuthority.velocity,
          };
        });
        if (metrics.nextCenterErrorBeats > 0.15 || metrics.velocityGrowthSamples || metrics.backwardsSamples
          || metrics.postRestMovement !== 0 || metrics.finalMode !== 'idle' || metrics.finalVelocity !== 0) {
          throw new Error(`wheel coast state: ${JSON.stringify(metrics)}`);
        }
        result.featureProbes.push(`physical coast metrics: ${metrics.initialVelocity.toFixed(2)}px/s initial, ${metrics.durationMs.toFixed(1)}ms coast, ${metrics.travelBeats.toFixed(4)} beats travel, ${metrics.nextCenterErrorBeats.toFixed(4)}-beat next-centre error, ${metrics.velocityGrowthSamples} velocity growth samples, ${metrics.backwardsSamples} backwards samples, ${metrics.postRestMovement.toFixed(3)}px post-rest movement`);
      });

      await probe('mid-coast wheel input blends continuously', async () => {
        const metrics = await page.evaluate(async () => {
          const story = window.__listing.story;
          const track = document.querySelector('#story-track');
          window.scrollTo({ top: track.offsetTop + innerHeight * 4, behavior: 'instant' });
          await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
          window.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 80, deltaMode: WheelEvent.DOM_DELTA_PIXEL, bubbles: true, cancelable: true,
          }));
          await new Promise((resolveWait) => setTimeout(resolveWait, 180));
          const before = { y: scrollY, velocity: story.scrollAuthority.velocity };
          window.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 60, deltaMode: WheelEvent.DOM_DELTA_PIXEL, bubbles: true, cancelable: true,
          }));
          const after = { y: scrollY, velocity: story.scrollAuthority.velocity };
          const expectedImpulse = 0.6 * story.scrollAuthority.impulseBeatsPerSecond * innerHeight;
          await new Promise(requestAnimationFrame);
          const nextY = scrollY;
          while (story.scrollAuthority.mode !== 'idle') await new Promise(requestAnimationFrame);
          return {
            beforeVelocity: before.velocity,
            afterVelocity: after.velocity,
            blendError: Math.abs(after.velocity - before.velocity - expectedImpulse),
            inputPositionJump: Math.abs(after.y - before.y),
            nextFrameMovement: nextY - after.y,
            finalMode: story.scrollAuthority.mode,
            finalVelocity: story.scrollAuthority.velocity,
          };
        });
        if (metrics.blendError > 0.01 || metrics.inputPositionJump !== 0 || metrics.nextFrameMovement <= 0
          || metrics.finalMode !== 'idle' || metrics.finalVelocity !== 0) {
          throw new Error(`mid-coast blend state: ${JSON.stringify(metrics)}`);
        }
        result.featureProbes.push(`mid-coast blend metrics: ${metrics.beforeVelocity.toFixed(2)}→${metrics.afterVelocity.toFixed(2)}px/s, ${metrics.blendError.toFixed(6)}px/s additive error, ${metrics.inputPositionJump.toFixed(3)}px input-frame jump, ${metrics.nextFrameMovement.toFixed(3)}px next-frame travel`);
      });

      await probe('floor labels without zone geometry', async () => {
        await goToBeat(1);
        await page.waitForTimeout(1_400);
        const floorState = await page.evaluate(() => ({
          visibleMeshes: window.__listing.viewer.zones.records.flatMap((record) => record.meshes).filter((mesh) => mesh.visible).length,
          visibleLabels: [...document.querySelectorAll('.zone-label')].filter((label) => !label.hidden && Number(getComputedStyle(label).opacity) > 0.2).length,
        }));
        if (floorState.visibleMeshes !== 0 || floorState.visibleLabels < 5) throw new Error(`floor overlay state ${JSON.stringify(floorState)}`);
        await savePageScreenshot('feedback-floor-labels-only.png');
      });

      await probe('staging dissolve', async () => {
        await goToBeat(3);
        await page.waitForFunction(() => document.querySelector('#staging-overlay')?.classList.contains('is-active'), null, { timeout: 8_000 });
        await page.waitForTimeout(1_350);
        const opacity = await page.locator('#staging-overlay').evaluate((element) => Number(getComputedStyle(element).opacity));
        if (opacity < 0.9) throw new Error(`staging opacity was ${opacity}`);
        await page.locator('#staging-picker [data-style="bord-de-mer"]').click();
        const visible = await waitForVisibleImage(page, '#staging-overlay', 'sejour-bord-de-mer.webp');
        result.featureProbes.push(`staging visible source: ${visible.source}`);
        await savePageScreenshot(`renders-${id}-staging-real.png`);
        const beforeIdle = await page.evaluate(() => window.__listing.viewer.renderCount);
        await page.waitForTimeout(600);
        const afterIdle = await page.evaluate(() => window.__listing.viewer.renderCount);
        if (afterIdle !== beforeIdle) throw new Error(`idle staging rendered ${afterIdle - beforeIdle} extra SSGI frames`);
        await savePageScreenshot(`p2-${id}-staging-dissolve.png`);
      });

      await probe('bedroom and shower-room photo cards', async () => {
        if (await page.locator('#compare-overlay').count()) throw new Error('legacy compare overlay is still mounted');
        for (const [index, beat] of [[5, 'chambre1'], [6, 'salledeau']]) {
          await goToBeat(index);
          await page.waitForFunction((id) => Number(getComputedStyle(document.querySelector(`[data-photo-beat='${id}']`)).opacity) > 0.95, beat, { timeout: 8_000 });
          await page.waitForTimeout(500);
          if (beat === 'chambre1') {
            await page.locator('[data-photo-beat="chambre1"] [data-style="japandi"]').click();
            const visible = await waitForVisibleImage(
              page,
              '[data-photo-beat="chambre1"]',
              'chambre1-japandi.webp',
            );
            result.featureProbes.push(`chambre1 visible source: ${visible.source}`);
            await savePageScreenshot(`renders-${id}-chambre1-japandi.png`);
          }
          await savePageScreenshot(`feedback-${beat}-thumbnail.png`);
        }
      });

      await probe('persistent mini-plan camera marker', async () => {
        await goToBeat(2);
        await page.waitForFunction(() => document.querySelector('#plan-panel')?.classList.contains('is-mini')
          && document.querySelector('.plan-camera-cone')?.getAttribute('d'), null, { timeout: 8_000 });
        const marker = await page.evaluate(() => ({
          visible: document.querySelector('#plan-panel')?.getAttribute('aria-hidden') === 'false',
          dot: [
            Number(document.querySelector('.plan-camera-dot')?.getAttribute('cx')),
            Number(document.querySelector('.plan-camera-dot')?.getAttribute('cy')),
          ],
          cone: document.querySelector('.plan-camera-cone')?.getAttribute('d'),
        }));
        if (!marker.visible || marker.dot.some((value) => !Number.isFinite(value)) || !marker.cone) {
          throw new Error(`mini-plan marker state was ${JSON.stringify(marker)}`);
        }
        await savePageScreenshot(`renders-${id}-mini-plan-interior.png`);
      });

      await probe('sun scrub 8h/13h/20h', async () => {
        await goToBeat(4);
        await page.waitForFunction(() => document.querySelector('#sun-scrub')?.classList.contains('is-active'), null, { timeout: 8_000 });
        await page.waitForTimeout(700);
        for (const hour of [8, 13, 20]) {
          await page.locator('#sun-range').evaluate((input, value) => {
            input.value = String(value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }, hour);
          await page.waitForTimeout(450);
          const output = await page.locator('#sun-scrub output').textContent();
          const expected = await page.evaluate((value) => new Intl.DateTimeFormat('fr-FR', {
            hour: 'numeric', timeZone: 'UTC',
          }).format(new Date(Date.UTC(2020, 0, 1, value))), hour);
          if (output !== expected) throw new Error(`sun output was ${JSON.stringify(output)}, expected ${JSON.stringify(expected)}`);
          await savePageScreenshot(`p2-${id}-sun-${hour}h.png`);
        }
      });

      await probe('plan hover and click-fly', async () => {
        await goToBeat(8);
        await page.waitForTimeout(1_800);
        await page.waitForFunction(() => document.querySelector('#plan-panel')?.classList.contains('is-active')
          && document.querySelector('#plan-panel')?.dataset.ready === '1', null, { timeout: 8_000 });
        const layoutState = await page.evaluate(() => {
          const viewer = window.__listing.viewer;
          const stageRect = document.querySelector('#stage').getBoundingClientRect();
          const projected = [];
          for (const record of viewer.zones.records) {
            for (const [x, z] of record.polygon) {
              const point = viewer.center.clone().set(x, 0.02, z).project(viewer.camera);
              projected.push({
                x: stageRect.left + (point.x * 0.5 + 0.5) * stageRect.width,
                y: stageRect.top + (-point.y * 0.5 + 0.5) * stageRect.height,
              });
            }
          }
          const model = {
            left: Math.min(...projected.map((point) => point.x)),
            right: Math.max(...projected.map((point) => point.x)),
            top: Math.min(...projected.map((point) => point.y)),
            bottom: Math.max(...projected.map((point) => point.y)),
          };
          const rect = (selector) => {
            const value = document.querySelector(selector).getBoundingClientRect();
            return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
          };
          const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          const targets = viewer.zones.records.map((record) => record.target);
          const centroids = Object.fromEntries(['balcon', 'sejour', 'chambre1'].map((key) => {
            const record = viewer.zones.records.find((entry) => entry.key === key);
            const point = record.position.clone().project(viewer.camera);
            return [key, { x: point.x, y: point.y }];
          }));
          return {
            model,
            panelOverlap: overlap(model, rect('#plan-panel')),
            copyOverlap: overlap(model, rect('[data-beat="plan"]')),
            targets,
            centroids,
          };
        });
        if (layoutState.panelOverlap) throw new Error(`plan panel overlaps projected model bounds ${JSON.stringify(layoutState.model)}`);
        if (layoutState.copyOverlap) throw new Error(`plan copy overlaps projected model bounds ${JSON.stringify(layoutState.model)}`);
        if (!(layoutState.centroids.balcon.x > layoutState.centroids.sejour.x
          && layoutState.centroids.balcon.x > layoutState.centroids.chambre1.x
          && layoutState.centroids.sejour.y > layoutState.centroids.chambre1.y)) {
          throw new Error(`3D plan orientation does not match SVG plan-space mapping: ${JSON.stringify(layoutState.centroids)}`);
        }
        if (layoutState.targets.some((target) => Math.abs(target - 0.3) > 0.001)) {
          throw new Error(`plan resting zone targets were ${JSON.stringify(layoutState.targets)}, expected 0.3`);
        }
        const zone = page.locator('#plan-panel [data-zone-key="sejour"]');
        await zone.hover();
        await page.waitForTimeout(300);
        const hoverTargets = await page.evaluate(() => window.__listing.viewer.zones.records.map((record) => ({
          key: record.key,
          target: record.target,
        })));
        if (hoverTargets.find((record) => record.key === 'sejour')?.target !== 1
          || hoverTargets.some((record) => record.key !== 'sejour' && Math.abs(record.target - 0.3) > 0.001)) {
          throw new Error(`plan hover zone targets were ${JSON.stringify(hoverTargets)}`);
        }
        await savePageScreenshot(`p2-${id}-plan-hover.png`);
        await savePageScreenshot('feedback-plan-orientation.png');
        const before = await page.evaluate(() => window.__listing.viewer.camera.position.toArray());
        await zone.click();
        await page.waitForTimeout(1_000);
        const after = await page.evaluate(() => window.__listing.viewer.camera.position.toArray());
        const moved = Math.hypot(...after.map((value, index) => value - before[index]));
        if (moved < 0.25) throw new Error(`plan click camera moved only ${moved.toFixed(3)}m`);
        const browseState = await page.evaluate(() => ({
          mini: document.querySelector('#plan-panel')?.classList.contains('is-browsing'),
          returnVisible: getComputedStyle(document.querySelector('.plan-return')).display !== 'none',
          visibleZones: window.__listing.viewer.zones.records.flatMap((record) => record.meshes).filter((mesh) => mesh.visible).length,
        }));
        if (!browseState.mini || !browseState.returnVisible) throw new Error(`plan browse UI state was ${JSON.stringify(browseState)}`);
        if (browseState.visibleZones) throw new Error(`${browseState.visibleZones} zone meshes remained visible in interior browse`);
        const beforeIdle = await page.evaluate(() => window.__listing.viewer.renderCount);
        await page.waitForTimeout(600);
        const afterIdle = await page.evaluate(() => window.__listing.viewer.renderCount);
        if (afterIdle !== beforeIdle) throw new Error(`settled browse rendered ${afterIdle - beforeIdle} extra SSGI frames`);
        await savePageScreenshot(`p2-${id}-plan-click-fly.png`);
        await page.locator('.plan-return').click();
        await page.waitForFunction(() => !document.querySelector('#plan-panel')?.classList.contains('is-browsing'));
      });

      await probe('walkthrough step and Esc resume', async () => {
        const before = await page.evaluate(() => ({ y: scrollY }));
        await page.locator('.walk-trigger-header').click();
        await page.waitForFunction(() => document.body.classList.contains('walkthrough-active'));
        const walkState = await page.evaluate(() => ({
          sightline: window.__listing.walkthrough.spawnSightline,
          visibleZones: window.__listing.viewer.zones.records.flatMap((record) => record.meshes).filter((mesh) => mesh.visible).length,
        }));
        if (!(walkState.sightline > 3)) throw new Error(`spawn sightline was ${walkState.sightline}, expected > 3m`);
        if (walkState.visibleZones) throw new Error(`${walkState.visibleZones} zone meshes remained visible in walkthrough`);
        const fov = await page.evaluate(() => window.__listing.viewer.camera.fov);
        if (Math.abs(fov - 60) > 0.01) throw new Error(`walkthrough FOV was ${fov}, expected 60`);
        await page.locator('#viewer-canvas').click({ position: { x: 720, y: 430 } });
        await page.waitForTimeout(450);
        if (!await page.evaluate(() => window.__listing.walkthrough.pointerLocked)) {
          await page.evaluate(() => {
            const canvas = document.querySelector('#viewer-canvas');
            let locked = null;
            Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
            canvas.requestPointerLock = () => {
              locked = canvas;
              document.dispatchEvent(new Event('pointerlockchange'));
              return Promise.resolve();
            };
            document.exitPointerLock = () => {
              locked = null;
              document.dispatchEvent(new Event('pointerlockchange'));
            };
          });
          await page.locator('#viewer-canvas').click({ position: { x: 720, y: 430 } });
        }
        await page.waitForFunction(() => window.__listing.walkthrough.pointerLocked, null, { timeout: 4_000 });
        await page.keyboard.press('p');
        await page.waitForFunction(() => window.__listing.walkthrough.pointerPaused && window.__listing.walkthrough.active);
        await page.keyboard.press('p');
        await page.waitForFunction(() => window.__listing.walkthrough.pointerLocked && !window.__listing.walkthrough.pointerPaused, null, { timeout: 4_000 });
        await savePageScreenshot(`p2-${id}-walkthrough-enter.png`);
        const walkMini = await page.evaluate(() => ({
          active: document.querySelector('#plan-panel')?.classList.contains('is-walkthrough'),
          visible: getComputedStyle(document.querySelector('#plan-panel')).display !== 'none',
          cone: document.querySelector('.plan-camera-cone')?.getAttribute('d'),
        }));
        if (!walkMini.active || !walkMini.visible || !walkMini.cone) throw new Error(`walkthrough mini-plan state was ${JSON.stringify(walkMini)}`);
        await savePageScreenshot(`renders-${id}-mini-plan-walkthrough.png`);
        await page.waitForTimeout(1_300);
        const beforeIdle = await page.evaluate(() => window.__listing.viewer.renderCount);
        await page.waitForTimeout(600);
        const afterIdle = await page.evaluate(() => window.__listing.viewer.renderCount);
        if (afterIdle !== beforeIdle) throw new Error(`idle walkthrough rendered ${afterIdle - beforeIdle} extra SSGI frames`);
        const start = await page.evaluate(() => window.__listing.viewer.camera.position.toArray());
        await page.keyboard.down('w');
        await page.waitForTimeout(700);
        await page.keyboard.up('w');
        const afterStep = await page.evaluate(() => window.__listing.viewer.camera.position.toArray());
        const moved = Math.hypot(...afterStep.map((value, index) => value - start[index]));
        if (moved < 0.05) throw new Error(`W step moved only ${moved.toFixed(3)}m`);
        await savePageScreenshot(`p2-${id}-walkthrough-step.png`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        if (await page.evaluate(() => window.__listing.walkthrough.pointerLocked)) {
          await page.evaluate(() => document.exitPointerLock());
        }
        await page.waitForFunction(() => !document.body.classList.contains('walkthrough-active'));
        const resumedY = await page.evaluate(() => scrollY);
        if (Math.abs(resumedY - before.y) > 1) throw new Error(`Esc resumed at ${resumedY}, expected ${before.y}`);
        await savePageScreenshot(`p2-${id}-walkthrough-resume.png`);
      });
    }

    if (id === 'webgl2') {
      try {
        await page.goto(`${url}?simulateWebGPUFailure=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForFunction(
          () => document.documentElement.dataset.modelReady === '1' && window.__listing?.backend === 'webgl2',
          null,
          { timeout: READY_TIMEOUT },
        );
        result.featureProbes.push('automatic initialization-failure fallback: pass');
        await savePageScreenshot('fallback-recovery.png');
      } catch (error) {
        result.featureProbes.push('automatic initialization-failure fallback: fail');
        result.failures.push(`Automatic initialization-failure fallback failed: ${errorText(error)}`);
      }
      result.hardening = await runHardeningProbes(executablePath, url, browser);
    }

    if (result.pageErrors.length) result.failures.push(`Expected zero pageerrors; received ${result.pageErrors.length}`);
    if (result.consoleErrors.length) result.failures.push(`Expected zero console errors; received ${result.consoleErrors.length}`);
    await context.close();
  } catch (error) {
    result.failures.push(`Mode verification aborted: ${errorText(error)}`);
  } finally {
    await browser.close();
  }

  return result;
}

function fenceVerbatim(entries) {
  if (!entries.length) return '```text\nNone\n```';
  const body = entries.join('\n\n');
  const fence = body.includes('```') ? '````' : '```';
  return `${fence}text\n${body}\n${fence}`;
}

function tableCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

async function runCalibration(executablePath, url) {
  const screenshots = [];
  const consoleErrors = [];
  const pageErrors = [];
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(errorText(error)));

    for (const id of Object.keys(PHOTO_CAMS)) {
      for (const view of ['blend', 'model', 'photo']) {
        const target = new URL(url);
        target.searchParams.set('forceWebGL', '1');
        target.searchParams.set('calib', id);
        target.searchParams.set('calibView', view);
        await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForFunction(
          ({ cameraId, cameraView }) => document.documentElement.dataset.modelReady === '1'
            && document.querySelector('#calibration-overlay')?.dataset.view === cameraView
            && new URLSearchParams(location.search).get('calib') === cameraId,
          { cameraId: id, cameraView: view },
          { timeout: READY_TIMEOUT },
        );
        await page.waitForFunction(() => {
          const image = document.querySelector('#calibration-overlay img');
          return image?.complete && image.naturalWidth > 0;
        }, null, { timeout: 15_000 });
        await page.waitForTimeout(350);
        const path = join(OUTPUT_DIR, `${id}-${view}.png`);
        await page.screenshot({ path });
        const png = PNG.sync.read(await page.screenshot());
        if (png.width !== 1440 || png.height !== 900) {
          throw new Error(`${id}-${view} was ${png.width}×${png.height}, expected 1440×900`);
        }
        if (statSync(path).size === 0) throw new Error(`${path} is empty`);
        screenshots.push(path);
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }
  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`Calibration emitted ${consoleErrors.length} console errors and ${pageErrors.length} pageerrors:\n${[
      ...consoleErrors,
      ...pageErrors,
    ].join('\n')}`);
  }
  return screenshots;
}

async function runHardeningProbes(executablePath, url, sharedBrowser = null) {
  const screenshots = [];
  const failures = [];
  const consoleErrors = [];
  const pageErrors = [];
  const browser = sharedBrowser || await chromium.launch({ executablePath, headless: true });
  const attachErrors = (page) => {
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(errorText(error)));
  };
  const save = async (page, name) => {
    const path = join(OUTPUT_DIR, name);
    await page.screenshot({ path });
    if (!statSync(path).size) throw new Error(`${name} is empty`);
    screenshots.push(path);
  };

  try {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await mobile.newPage();
    attachErrors(page);
    await page.goto(`${url}?forceWebGL=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => document.documentElement.dataset.modelReady === '1', null, { timeout: READY_TIMEOUT });
    await page.waitForTimeout(SETTLE_MS);
    await save(page, 'p3-mobile-hero.png');

    for (const [index, beat] of [[5, 'chambre1'], [6, 'salledeau']]) {
      await page.evaluate((beatIndex) => {
        const track = document.querySelector('#story-track');
        window.scrollTo({ top: track.offsetTop + innerHeight * beatIndex, behavior: 'instant' });
      }, index);
      await page.waitForFunction((beatId) => window.__listing.beat === beatId
        && Number(getComputedStyle(document.querySelector(`[data-photo-beat='${beatId}']`)).opacity) > 0.9, beat, { timeout: 12_000 });
      const mobileLayout = await page.evaluate((beatId) => {
        const photo = document.querySelector(`[data-photo-beat='${beatId}']`).getBoundingClientRect();
        const card = document.querySelector(`[data-beat='${beatId}']`).getBoundingClientRect();
        return { overlap: photo.bottom > card.top, photo: { top: photo.top, bottom: photo.bottom }, card: { top: card.top, bottom: card.bottom } };
      }, beat);
      if (mobileLayout.overlap) failures.push(`Mobile ${beat} photo/card overlap: ${JSON.stringify(mobileLayout)}`);
      await save(page, `feedback-mobile-${beat}.png`);
    }

    await page.evaluate(() => {
      const track = document.querySelector('#story-track');
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo({ top: track.offsetTop + innerHeight * 8, behavior: 'instant' });
    });
    await page.waitForFunction(() => document.querySelector('#plan-panel')?.classList.contains('is-active')
      && Number(getComputedStyle(document.querySelector('[data-beat="plan"]')).opacity) > 0.85, null, { timeout: 20_000 });
    const planLayout = await page.evaluate(() => {
      const panel = document.querySelector('#plan-panel').getBoundingClientRect();
      const card = document.querySelector('[data-beat="plan"]').getBoundingClientRect();
      const walk = getComputedStyle(document.querySelector('.walk-trigger-header'));
      return {
        panel: { top: panel.top, bottom: panel.bottom },
        card: { top: card.top, bottom: card.bottom },
        overlap: panel.top < card.bottom && panel.bottom > card.top,
        walkDisplay: walk.display,
      };
    });
    if (planLayout.overlap) failures.push(`Mobile plan/card overlap: ${JSON.stringify(planLayout)}`);
    if (planLayout.walkDisplay === 'none') failures.push('Mobile header walkthrough control is hidden');
    await save(page, 'p3-mobile-plan.png');

    const finalBeat = await page.evaluate(() => {
      const track = document.querySelector('#story-track');
      window.scrollTo({ top: track.offsetTop + innerHeight * 8.65, behavior: 'instant' });
      return new Promise((resolveProbe) => requestAnimationFrame(() => requestAnimationFrame(() => resolveProbe({
        docMode: document.body.classList.contains('document-mode'),
        planActive: document.querySelector('#plan-panel')?.classList.contains('is-active'),
      }))));
    });
    if (finalBeat.docMode || !finalBeat.planActive) failures.push(`Final plan beat ended early: ${JSON.stringify(finalBeat)}`);

    const beforeResize = await page.evaluate(() => {
      const track = document.querySelector('#story-track');
      window.scrollTo({ top: track.offsetTop + innerHeight * 4.25, behavior: 'instant' });
      return 4.25;
    });
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForTimeout(300);
    const afterResize = await page.evaluate(() => {
      const track = document.querySelector('#story-track');
      const position = (scrollY - track.offsetTop) / innerHeight;
      return position;
    });
    if (Math.abs(afterResize - beforeResize) > 0.03) {
      failures.push(`Resize changed normalized story position from ${beforeResize} to ${afterResize}`);
    }
    await mobile.close();

    const walkthroughContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const doorPage = await walkthroughContext.newPage();
    attachErrors(doorPage);
    await doorPage.goto(`${url}?forceWebGL=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await doorPage.waitForFunction(() => document.documentElement.dataset.modelReady === '1', null, { timeout: READY_TIMEOUT });
    await doorPage.locator('.walk-trigger-header').click();
    await doorPage.waitForFunction(() => document.body.classList.contains('walkthrough-active'));
    await doorPage.evaluate(() => {
      const position = window.__listing.viewer.camera.position;
      const target = [-6.4, 5.4];
      window.__listing.walkthrough.setHeading(Math.atan2(-(target[0] - position.x), -(target[1] - position.z)));
    });
    await doorPage.keyboard.down('w');
    await doorPage.waitForFunction(() => {
      const door = window.__listing.viewer.doors.records.get('door_3kh9r2ppabwi0z9z');
      return door?.moving && door.progress > 0.15 && door.progress < 0.75;
    }, null, { timeout: 6_000 });
    await save(doorPage, 'p3-door-approach.png');
    const midOpen = await doorPage.evaluate(() => {
      const door = window.__listing.viewer.doors.records.get('door_3kh9r2ppabwi0z9z');
      return { progress: door.progress, passable: window.__listing.viewer.doors.isPassable(door.id) };
    });
    await doorPage.keyboard.up('w');
    if (!(midOpen.progress > 0.15 && midOpen.progress < 0.75)) {
      failures.push(`Door probe did not capture mid-open state: ${JSON.stringify(midOpen)}`);
    }
    await walkthroughContext.close();
  } catch (error) {
    failures.push(`Hardening probes aborted: ${errorText(error)}`);
  } finally {
    if (!sharedBrowser) await browser.close();
  }
  if (consoleErrors.length) failures.push(`Hardening probes emitted ${consoleErrors.length} console errors`);
  if (pageErrors.length) failures.push(`Hardening probes emitted ${pageErrors.length} page errors`);
  return { screenshots, failures, consoleErrors, pageErrors };
}

function buildReport({ url, serverNote, executablePath, results, hardening }) {
  const timestamp = new Date().toISOString();
  const lines = [
    '# Phase 2 verification result',
    '',
    `Run: ${timestamp}`,
    '',
    `Site: ${url} (${serverNote})`,
    '',
    `Chromium: ${executablePath}`,
    '',
    '## Summary',
    '',
    '| Launch mode | Launched | Backend reached | Model ready | Canvas evidence | Assertion failures |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const result of results) {
    const canvas = result.canvas
      ? `${result.canvas.changedPixels}/${result.canvas.totalPixels} compositor pixels changed (${result.canvas.width}×${result.canvas.height} canvas)`
      : 'not established';
    lines.push(`| ${tableCell(result.description)} | ${result.launched ? 'yes' : 'no'} | ${result.backend || 'not reached'} | ${result.ready ? 'yes' : 'no'} | ${tableCell(canvas)} | ${result.failures.length} |`);
  }

  for (const result of results) {
    lines.push(
      '',
      `## ${result.description}`,
      '',
      `Backend reached: ${result.backend || 'not reached'}`,
      '',
      'Console errors (verbatim):',
      '',
      fenceVerbatim(result.consoleErrors),
      '',
      'Console warnings (verbatim):',
      '',
      fenceVerbatim(result.consoleWarnings),
      '',
      'Page errors (verbatim):',
      '',
      fenceVerbatim(result.pageErrors),
      '',
      'Phase 2 feature probes:',
      '',
    );
    if (result.featureProbes.length) lines.push(...result.featureProbes.map((probe) => `- ${probe}`));
    else lines.push('- None');
    lines.push(
      '',
      'Screenshots written:',
      '',
    );
    if (result.screenshots.length) lines.push(...result.screenshots.map((path) => `- ${path}`));
    else lines.push('- None');
    lines.push('', 'Assertion failures:', '');
    if (result.failures.length) lines.push(...result.failures.map((failure) => `- ${failure.replaceAll('\n', '\n  ')}`));
    else lines.push('- None');
  }
  lines.push(
    '',
    '## Hardening probes',
    '',
    `Console errors: ${hardening.consoleErrors.length}`,
    '',
    `Page errors: ${hardening.pageErrors.length}`,
    '',
    'Screenshots:',
    '',
    ...hardening.screenshots.map((path) => `- ${path}`),
    '',
    'Assertion failures:',
    '',
    ...(hardening.failures.length ? hardening.failures.map((failure) => `- ${failure}`) : ['- None']),
  );
  return `${lines.join('\n')}\n`;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const executablePath = findFullChromium();
await runBuild();
const site = await ensureSite();
if (CALIBRATION_ONLY) {
  try {
    const screenshots = await runCalibration(executablePath, site.url);
    process.stdout.write(`Calibration evidence: pass\n${screenshots.map((path) => `- ${path}`).join('\n')}\nConsole errors: 0\nPage errors: 0\n`);
  } catch (error) {
    process.stderr.write(`Calibration evidence: fail\n${errorText(error)}\n`);
    process.exitCode = 1;
  } finally {
    if (site.process) site.process.kill('SIGTERM');
  }
} else {
  const modes = [
  {
    id: 'webgpu',
    description: 'WebGPU-enabling headless-new',
    expectedBackend: 'webgpu',
    launchOptions: {
      headless: false,
      args: ['--headless=new', '--use-angle=metal', '--enable-unsafe-webgpu'],
    },
  },
  {
    id: 'webgl2',
    description: 'Forced WebGL2 fallback',
    expectedBackend: 'webgl2',
    urlSuffix: '?forceWebGL=1',
    launchOptions: { headless: true },
  },
  ].filter((mode) => !WEBGL2_ONLY || mode.id === 'webgl2');

  const results = [];
  let hardening = { screenshots: [], failures: ['Hardening probes did not run'], consoleErrors: [], pageErrors: [] };
  try {
    for (const mode of modes) {
      const result = await runMode(mode, executablePath, site.url);
      results.push(result);
      process.stdout.write(`[verify] ${mode.id}: ${result.failures.length ? `${result.failures.length} failure(s)` : 'pass'}\n`);
      if (result.failures.length) process.stdout.write(`${result.failures.map((failure) => `  - ${failure}\n`).join('')}`);
    }
    hardening = results.find((result) => result.hardening)?.hardening || hardening;
  } finally {
    if (site.process) site.process.kill('SIGTERM');
  }

  const report = buildReport({
    url: site.url,
    serverNote: site.note,
    executablePath,
    results,
    hardening,
  });
  writeFileSync(RESULT_PATH, report);
  process.stdout.write(report);
  if (results.some((result) => result.failures.length) || hardening.failures.length) process.exitCode = 1;
}
