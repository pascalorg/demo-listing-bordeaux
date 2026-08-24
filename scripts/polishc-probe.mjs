import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://localhost:5199/';
const outputDir = join(process.cwd(), 'scratchpad', 'verify');
mkdirSync(outputDir, { recursive: true });

function fullChromium() {
  const bundled = chromium.executablePath();
  if (existsSync(bundled) && !bundled.includes('chromium_headless_shell')) return bundled;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const revisions = readdirSync(cache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .sort((a, b) => Number(b.name.slice(9)) - Number(a.name.slice(9)));
  for (const revision of revisions) {
    const executable = join(
      cache, revision.name, 'chrome-mac-arm64',
      'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing',
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(baseUrl, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('#lightbox'), null, { timeout: 30000 });
await page.evaluate(() => document.querySelector('.lightbox-trigger')?.click());
await page.waitForTimeout(900);

const report = await page.evaluate(() => {
  const measure = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return { selector, missing: true };
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const glyph = el.textContent.trim();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(glyph);
    const fontSize = parseFloat(cs.fontSize);
    const lineHeight = cs.lineHeight === 'normal'
      ? (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)
      : parseFloat(cs.lineHeight);
    // baseline position inside the line box
    const halfLeading = (lineHeight - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2;
    const baselineInLine = halfLeading + m.fontBoundingBoxAscent;
    // content box: padding-box minus padding; button centres its line box in content box
    const padTop = parseFloat(cs.paddingTop);
    const padBottom = parseFloat(cs.paddingBottom);
    const borderTop = parseFloat(cs.borderTopWidth);
    const borderBottom = parseFloat(cs.borderBottomWidth);
    const contentHeight = rect.height - padTop - padBottom - borderTop - borderBottom;
    const lineTopInBorderBox = borderTop + padTop + (contentHeight - lineHeight) / 2;
    const baselineInBorderBox = lineTopInBorderBox + baselineInLine;
    const inkTop = baselineInBorderBox - m.actualBoundingBoxAscent;
    const inkBottom = baselineInBorderBox + m.actualBoundingBoxDescent;
    const inkCentre = (inkTop + inkBottom) / 2;
    return {
      selector, glyph, font: ctx.font,
      buttonHeight: +rect.height.toFixed(2),
      fontSize, lineHeight: +lineHeight.toFixed(2),
      display: cs.display, alignItems: cs.alignItems,
      fontAscent: +m.fontBoundingBoxAscent.toFixed(2),
      fontDescent: +m.fontBoundingBoxDescent.toFixed(2),
      inkAscent: +m.actualBoundingBoxAscent.toFixed(2),
      inkDescent: +m.actualBoundingBoxDescent.toFixed(2),
      inkTop: +inkTop.toFixed(2),
      inkBottom: +inkBottom.toFixed(2),
      inkCentre: +inkCentre.toFixed(2),
      boxCentre: +(rect.height / 2).toFixed(2),
      // positive => glyph sits ABOVE centre (too high); needs translateY(+offset)
      offsetNeeded: +(rect.height / 2 - inkCentre).toFixed(2),
    };
  };
  return ['.lightbox-previous', '.lightbox-next', '.lightbox-close'].map(measure);
});

console.log(JSON.stringify(report, null, 2));

for (const [name, selector] of [['prev', '.lightbox-previous'], ['next', '.lightbox-next'], ['close', '.lightbox-close']]) {
  const el = await page.$(selector);
  if (el) await el.screenshot({ path: join(outputDir, `polishc-probe-${name}.png`) });
}
await page.screenshot({ path: join(outputDir, 'polishc-probe-full.png') });
await browser.close();
