# WOW2 — user-feedback polish result

Date: 2026-08-24

Implemented all three WOW2 feedback groups without changing dependencies, the story scroll-feel
constants/easing, or any concurrently owned file (`src/post.js`, `src/viewer.js`,
`src/features/{walkthrough,sun,staging}.js`). The DOOR1 authored transitions and pose capture remain
intact.

## 1. Floor-beat room labels

- Replaced the floor-only rectangular, opaque plates with fully rounded pill/chip labels.
- The floor label plate is now `rgb(14 21 19 / 85%)`, with a 10 px backdrop blur, the acid border
  and area text, and white room names.
- Floor-mode label elements remain at full opacity so only the plate background is translucent;
  all eight visible labels stay crisp rather than washed out.

Evidence: `scratchpad/verify/wow2-floor-pill-labels.png`.

## 2. Scroll-hint scrim

- Moved the bottom gradient out of the cue pseudo-element into its own synchronized fixed layer.
- Verified stacking is scrim `z=7` → mini-plan `z=9` → cue text `z=12`, so the gradient remains
  behind the mini-plan and behind the cue text.
- Removed the cue text shadow and kept the stronger text weight. The separate scrim follows the same
  hero-only opacity rule as the cue without changing that rule or its timing.

Evidence: `scratchpad/verify/wow2-hero-scrim-behind-plan.png`.

## 3. Facts beat and retired Diagnostics section

- The figures grid now ends with one double-width energy cell containing two equal-size badge
  buttons. Measured badge sizes are 260.5×58 px each at 1440 px and 164×58 px each at 390 px.
- The badges carry the real values directly:
  - FR: `DPE A · 48 kWhEP/m²/an` and `GES C · 11 kgéqCO₂/m²/an`.
  - EN: `DPE A · 48 kWhEP/m²/year` and `GES C · 11 kgCO₂e/m²/year`.
- Each badge opens its corresponding official chart in the existing shared lightbox: DPE opens
  `dpe.jpeg`; GES opens `dpe-ges.jpeg`.
- Removed the standalone Diagnostics section markup, its section-only translation keys, its styles,
  and its lightbox thumbnail rendering path. The document now has four sections: facts, official
  surfaces/plan, gallery, and Pascal CTA.
- Desktop grid rows are `4 / 4 / 3`. Mobile has five complete two-chip rows followed by one
  intentional full-width energy row, with no page overflow.
- The story still contains nine beats and the progress rail contains exactly nine matching dots;
  there is no diagnostics entry.
- Updated `SPEC.md` so DPE/GES belongs to the figures grid and the standalone section no longer
  exists. Updated the related README asset note and current verification scripts as well.

Charts call: **kept**. Both supplied 744×681 JPEGs are sharp and legible in the contain-style
lightbox, and each remains directly accessible from its matching badge.

Evidence:

- `scratchpad/verify/wow2-facts-desktop.png`
- `scratchpad/verify/wow2-facts-mobile-390.png`
- `scratchpad/verify/wow2-dpe-lightbox.png`
- `scratchpad/verify/wow2-ges-lightbox.png`
- `scratchpad/verify/wow2-document-flow-no-diagnostics.png`
- Machine-readable audit: `scratchpad/verify/wow2-report.json`

The document-flow capture shows the facts grid followed by official surfaces/plan and then the
gallery, with no intervening Diagnostics section. The audit records zero diagnostics elements,
zero diagnostics i18n bindings, four document sections, and 9 beats / 9 rail dots.

## Regression verification

WOW2 browser verification used forced WebGL2 at 1440×900 and 390×844. It reported zero console
errors and zero page errors. The gallery verification also passed in FR and EN with no desktop or
mobile page overflow.

Commands:

```sh
bun scripts/wow2-verify.mjs 'http://127.0.0.1:5199/?forceWebGL=1'
bun scripts/gallery-verify.mjs 'http://127.0.0.1:5199/?forceWebGL=1'
bun scripts/door1-verify.mjs 'http://127.0.0.1:5199/?forceWebGL=1&pose'
```

The focused DOOR1 rerun reproduced the authored French-door clip times at transition points
(`0.162 / 0.679 / 0.991`), the suite pocket-door midpoint (`0.596`), direct late-beat open state,
pose overlay, and zero browser errors. Machine-readable proof remains in
`scratchpad/verify/door1-report.json`.

## Build

`bun run build` passed. Tail of output:

```text
dist/assets/index-oUk8xvRT.css               30.15 kB │ gzip:   7.05 kB
dist/assets/config-Dk1WdJBJ.js                1.37 kB │ gzip:   0.67 kB
dist/assets/pose-CeULQyzN.js                  2.35 kB │ gzip:   1.20 kB
dist/assets/calibration-CoHRs8b4.js           2.40 kB │ gzip:   1.14 kB
dist/assets/index-DMYaUnKh.js               259.81 kB │ gzip:  89.80 kB
dist/assets/three.webgpu-fEnFVguv.js        913.69 kB │ gzip: 250.03 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking
- Adjust chunk size limit via build.chunkSizeWarningLimit.
✓ built in 820ms
```

The chunk-size message is Vite's existing advisory warning; the build exited successfully.

## Files changed

- `index.html`
- `src/main.js`
- `src/story.js` — cue/scrim DOM plumbing only; no scroll constants, interpolation, or easing edits.
- `src/features/lightbox.js`
- `src/copy.js`
- `src/styles.css`
- `SPEC.md`
- `README.md`
- `scripts/verify.mjs`
- `scripts/gallery-verify.mjs`
- `scripts/wow2-verify.mjs`
- `WOW2-RESULT.md`
- `dist/` — regenerated by the required production build.
- `scratchpad/verify/wow2-*` — WOW2 screenshots and machine-readable report.
- `scratchpad/verify/door1-*` — refreshed by the focused DOOR1 regression run.
