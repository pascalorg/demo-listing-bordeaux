import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:5197/';
const outputPath = join(process.cwd(), 'scratchpad', 'verify', 'gi2-report.json');

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

async function seekBeat(page, index) {
  await page.evaluate((beat) => {
    document.documentElement.style.scrollBehavior = 'auto';
    const track = document.querySelector('#story-track');
    window.scrollTo({ top: track.offsetTop + innerHeight * beat, behavior: 'instant' });
  }, index);
  await page.waitForFunction((beat) => (
    Math.abs(window.__listing.story.targetValue - beat) < 0.003
    && Math.abs(window.__listing.story.value - beat) < 0.003
  ), index, { timeout: 15_000 });
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

mkdirSync(join(process.cwd(), 'scratchpad', 'verify'), { recursive: true });
const browser = await chromium.launch({
  executablePath: fullChromium(),
  headless: false,
  args: ['--headless=new', '--use-angle=metal', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const primaryCdp = await page.context().newCDPSession(page);
const primaryErrors = observeErrors(page);
const url = new URL(baseUrl);
url.searchParams.delete('look');
url.searchParams.set('pose', '');
await page.goto(url.href, { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForFunction(() => window.__listing?.viewer && document.documentElement.dataset.modelReady === '1');
await page.waitForFunction(() => window.__listing.viewer.convergenceFramesRemaining === 0, null, { timeout: 30_000 });

const walkthroughEntry = await page.evaluate(async () => {
  const listing = window.__listing;
  const before = listing.viewer.renderCount;
  await listing.walkthrough.enter();
  return {
    before,
    after: listing.viewer.renderCount,
    renderedImmediately: listing.viewer.renderCount > before,
    remaining: listing.viewer.convergenceFramesRemaining,
  };
});
await page.keyboard.down('w');
await page.waitForTimeout(350);
await page.keyboard.up('w');
const walkthroughDrain = await page.evaluate(async () => {
  const viewer = window.__listing.viewer;
  const started = performance.now();
  const samples = [];
  let lastRemaining = null;
  while (viewer.convergenceFramesRemaining > 0 && performance.now() - started < 10_000) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const remaining = viewer.convergenceFramesRemaining;
    if (remaining !== lastRemaining && (remaining === 32 || remaining % 8 === 0)) {
      samples.push({
        ms: Math.round(performance.now() - started),
        remaining,
        renderCount: viewer.renderCount,
      });
    }
    lastRemaining = remaining;
  }
  if (samples.at(-1)?.remaining !== viewer.convergenceFramesRemaining) {
    samples.push({
      ms: Math.round(performance.now() - started),
      remaining: viewer.convergenceFramesRemaining,
      renderCount: viewer.renderCount,
    });
  }
  const beforeIdle = viewer.renderCount;
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return {
    samples,
    finalRemaining: viewer.convergenceFramesRemaining,
    beforeIdle,
    afterIdle: viewer.renderCount,
  };
});
await page.evaluate(() => window.__listing.walkthrough.exit());

await seekBeat(page, 4);
await page.waitForFunction(() => document.querySelector('#sun-scrub')?.classList.contains('is-active'));
await page.evaluate(() => {
  const viewer = window.__listing.viewer;
  window.__gi2DaylightCalls = [];
  const original = viewer.setDaylight.bind(viewer);
  viewer.setDaylight = (settings) => {
    window.__gi2DaylightCalls.push(performance.now());
    return original(settings);
  };
});
const sunAutoplay = await page.evaluate(async () => {
  const range = document.querySelector('#sun-range');
  const hourBefore = Number(range.value);
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  return {
    hourBefore,
    hourAfter: Number(range.value),
    daylightUpdates: window.__gi2DaylightCalls.length,
    durationMs: window.__gi2DaylightCalls.length > 1
      ? window.__gi2DaylightCalls.at(-1) - window.__gi2DaylightCalls[0]
      : 0,
  };
});
await seekBeat(page, 5);
await page.waitForFunction(() => (
  !document.querySelector('#sun-scrub')?.classList.contains('is-active')
  && window.__listing.viewer.convergenceFramesRemaining === 0
), null, { timeout: 15_000 });
const sunExitIdle = await page.evaluate(async () => {
  const viewer = window.__listing.viewer;
  const before = viewer.renderCount;
  const daylightCallsBefore = window.__gi2DaylightCalls.length;
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return {
    remaining: viewer.convergenceFramesRemaining,
    renderCountBefore: before,
    renderCountAfter: viewer.renderCount,
    daylightCallsBefore,
    daylightCallsAfter: window.__gi2DaylightCalls.length,
  };
});

await page.evaluate(() => {
  const listing = window.__listing;
  window.__gi2StagingLocks = [];
  const original = listing.story.setRenderSuppressed.bind(listing.story);
  listing.story.setRenderSuppressed = (key, suppressed) => {
    window.__gi2StagingLocks.push({
      key,
      suppressed,
      remaining: listing.viewer.convergenceFramesRemaining,
      renderCount: listing.viewer.renderCount,
      time: performance.now(),
    });
    return original(key, suppressed);
  };
  window.__gi2PulseActive = true;
  const pulse = () => {
    if (!window.__gi2PulseActive) return;
    listing.viewer.invalidate();
    requestAnimationFrame(pulse);
  };
  requestAnimationFrame(pulse);
});
await seekBeat(page, 3);
await page.waitForFunction(() => document.querySelector('#staging-overlay')?.classList.contains('is-active'));
await page.waitForTimeout(1_600);
const stagingWhileInflated = await page.evaluate(() => ({
  remaining: window.__listing.viewer.convergenceFramesRemaining,
  lockEvents: [...window.__gi2StagingLocks],
}));
await page.evaluate(() => { window.__gi2PulseActive = false; });
await page.waitForFunction(() => window.__gi2StagingLocks.some((event) => event.suppressed), null, { timeout: 15_000 });
const stagingAfterDrain = await page.evaluate(() => ({
  remaining: window.__listing.viewer.convergenceFramesRemaining,
  lockEvents: [...window.__gi2StagingLocks],
}));

await seekBeat(page, 2);
await page.keyboard.press('f');
await page.waitForFunction(() => document.querySelector('.pose-capture')?.classList.contains('is-fly'));
await page.keyboard.down('e');
await page.waitForTimeout(250);
await page.keyboard.up('e');
await page.waitForFunction(() => window.__listing.viewer.convergenceFramesRemaining === 0, null, { timeout: 15_000 });
const poseFlyIdle = await page.evaluate(async () => {
  const viewer = window.__listing.viewer;
  const before = viewer.renderCount;
  await new Promise((resolve) => setTimeout(resolve, 900));
  return {
    flyActive: document.querySelector('.pose-capture')?.classList.contains('is-fly'),
    remaining: viewer.convergenceFramesRemaining,
    renderCountBefore: before,
    renderCountAfter: viewer.renderCount,
  };
});
await page.keyboard.press('f');
await page.waitForFunction(() => !document.querySelector('.pose-capture')?.textContent.includes('RETURN'));
await page.waitForFunction(() => window.__listing.viewer.convergenceFramesRemaining === 0, null, { timeout: 15_000 });

const dprBefore = await page.evaluate(() => ({
  devicePixelRatio,
  rendererPixelRatio: window.__listing.viewer.renderer.getPixelRatio(),
  cssSize: [document.querySelector('#stage').clientWidth, document.querySelector('#stage').clientHeight],
}));
await primaryCdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false,
});
await page.waitForFunction(() => (
  devicePixelRatio === 2
  && Math.abs(window.__listing.viewer.renderer.getPixelRatio() - 1.5) < 0.001
), null, { timeout: 5_000 });
const dprAfter = await page.evaluate(() => ({
  devicePixelRatio,
  rendererPixelRatio: window.__listing.viewer.renderer.getPixelRatio(),
  cssSize: [document.querySelector('#stage').clientWidth, document.querySelector('#stage').clientHeight],
  remaining: window.__listing.viewer.convergenceFramesRemaining,
}));

const fallbackPage = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
const fallbackErrors = observeErrors(fallbackPage);
const fallbackUrl = new URL(baseUrl);
fallbackUrl.searchParams.set('forceWebGL', '1');
await fallbackPage.goto(fallbackUrl.href, { waitUntil: 'networkidle', timeout: 30_000 });
await fallbackPage.waitForFunction(() => window.__listing?.viewer && document.documentElement.dataset.modelReady === '1');
const fallback = await fallbackPage.evaluate(async () => {
  const listing = window.__listing;
  const before = listing.viewer.renderCount;
  await new Promise((resolve) => setTimeout(resolve, 800));
  return {
    backend: listing.backend,
    look: listing.viewer.look,
    remaining: listing.viewer.convergenceFramesRemaining,
    renderCountBefore: before,
    renderCountAfter: listing.viewer.renderCount,
  };
});

const report = {
  url: url.href,
  backend: await page.evaluate(() => window.__listing.backend),
  look: await page.evaluate(() => window.__listing.viewer.look),
  walkthroughEntry,
  walkthroughDrain,
  sunAutoplay,
  sunExitIdle,
  stagingWhileInflated,
  stagingAfterDrain,
  poseFlyIdle,
  dprChange: { before: dprBefore, after: dprAfter },
  primaryErrors,
  fallback: { ...fallback, ...fallbackErrors },
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
