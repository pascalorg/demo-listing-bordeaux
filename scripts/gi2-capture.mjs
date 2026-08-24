import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:5197/';
const mode = process.argv[3] || 'after';
const outputDir = join(process.cwd(), 'scratchpad', 'verify');

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

const browser = await chromium.launch({
  executablePath: fullChromium(),
  headless: false,
  args: ['--headless=new', '--use-angle=metal', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

const url = new URL(baseUrl);
if (mode === 'sketch') url.searchParams.set('look', 'sketch');
else url.searchParams.set('look', 'real');
await page.goto(url.href, { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForFunction(() => window.__listing?.viewer && document.documentElement.dataset.modelReady === '1');
await page.evaluate(() => {
  document.documentElement.style.scrollBehavior = 'auto';
  const track = document.querySelector('#story-track');
  window.scrollTo({ top: track.offsetTop + innerHeight * 2, behavior: 'instant' });
});
await page.waitForFunction(() => (
  Math.abs(window.__listing.story.value - 2) < 0.002
  && window.__listing.viewer.convergenceFramesRemaining === 0
), null, { timeout: 30_000 });

const state = await page.evaluate(() => ({
  backend: window.__listing.backend,
  look: window.__listing.viewer.look,
  eye: window.__listing.viewer.camera.position.toArray(),
  quaternion: window.__listing.viewer.camera.quaternion.toArray(),
  fov: window.__listing.viewer.camera.fov,
  remaining: window.__listing.viewer.convergenceFramesRemaining,
  renderCount: window.__listing.viewer.renderCount,
}));
const prefix = mode === 'before' ? 'gi2-aa-before' : `gi2-${mode}`;
if (mode === 'sketch') {
  await page.screenshot({ path: join(outputDir, `${prefix}-sejour.png`) });
} else {
  await page.screenshot({
    path: join(outputDir, `${prefix}-contour-crop.png`),
    clip: { x: 840, y: 56, width: 520, height: 300 },
  });
}

console.log(JSON.stringify({ url: url.href, state, consoleErrors, pageErrors }, null, 2));
await browser.close();
