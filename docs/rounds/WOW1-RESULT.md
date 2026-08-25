# WOW1 — UI polish result

Completed all six requested polish items without changing the story’s scroll constants/easing, `src/post.js`, `src/viewer.js`, dependencies, or the pinned Three.js version.

## 1. Floor labels

- Floor-beat zone labels now settle at full element opacity (`1`).
- The floor-only label plate is solid `rgb(14 21 19)` with the existing acid border/text treatment preserved.
- Browser verification found eight visible labels, all with computed opacity `1` and an opaque background.

## 2. Scroll-hint scrim

- Added a viewport-wide transparent-to-40%-black bottom gradient behind the scroll cue.
- The scrim is the cue’s pseudo-element, so it inherits the cue’s existing opacity/show-hide behavior and cannot remain behind after the cue fades.
- Increased text weight and added a restrained dark text shadow for bright-floor contrast.

## 3. Progress dots capsule

- Added a dedicated vertical capsule around the chapter dots: `rgba(15 22 20 / 65%)`, fully rounded, 1 px light border, blur/saturation, and comfortable padding.
- Inactive dots are dim light; the active dot is larger, acid-bright, and softly ringed.
- Chapter labels remain outside the capsule as rounded dark chips. Existing click, active, hover, and mobile-hide behavior is unchanged.

## 4. Balcony time autoplay

- Changed `Heure solaire` / `Solar time` to `Heure` / `Time` in both dictionaries.
- The slider advances continuously through 07:00–21:00 on a calm 40-second loop while the balcony beat is active.
- It stops off-beat, resumes on re-entry if untouched, and is permanently paused for the visit on pointer, keyboard, or slider input.
- `prefers-reduced-motion: reduce` disables autoplay.
- Verification: 12:01 → 13:49 over 5 seconds without input; unchanged off-beat; resumed on re-entry; unchanged after user input; reduced-motion remained 11.5 → 11.5.

## 5. Suite/staging controls

Root cause: the suite card’s inline hit testing was coupled to its fade and enabled only above `0.92` opacity. The chip row could therefore be clearly visible but inert unless the scroll position was almost perfectly centered; the parent copy layer itself intentionally does not receive pointer events.

- Enabled the photo card’s hit testing throughout its meaningfully visible phase (`opacity > 0.35`) without changing any scroll/easing behavior.
- Kept hit testing disabled while the card is effectively hidden, preserving stage drag behavior.
- Unified the bedroom photo/staging tabs and séjour staging picker with the site’s dominant pill-control language already used by the language toggle and gallery area chips: fully rounded ends, light border, dark translucent fill, compact uppercase typography, and acid selected state.
- Browser proof at an off-center story value: card opacity `0.51`, pointer events `auto`.
- Clicking `Japandi` changed the selected button and current image to `/assets/renders/chambre1-japandi.webp`.

## 6. Facts beat

- Added nine restrained 14 px inline SVG line icons (`stroke: currentColor`, 1.5 px) for the relevant facts.
- Replaced plain `DPE A · GES C` with an official-style green DPE A badge (`#319834`) and a smaller class-C mauve GES badge.
- The diagnostic badge is a keyboard-accessible button and opens the existing diagnostics lightbox at `dpe.jpeg`.
- Desktop uses a 12-column layout ending `4 / 4 / 3`, removing the lone-item row.
- Mobile ends with a full-width diagnostic badge row; all rows fill the grid and the 390 px audit has no page overflow.

## Evidence

- `scratchpad/verify/wow1-hero-scrim-dots.png`
- `scratchpad/verify/wow1-floor-opaque-labels.png`
- `scratchpad/verify/wow1-balcon-autoplay-1.png`
- `scratchpad/verify/wow1-balcon-autoplay-2.png`
- `scratchpad/verify/wow1-suite-photo-chip.png`
- `scratchpad/verify/wow1-suite-japandi-chip.png`
- `scratchpad/verify/wow1-staging-pill-row.png`
- `scratchpad/verify/wow1-facts-icons-dpe-grid.png`
- Machine-readable audit: `scratchpad/verify/wow1-report.json`

Verification command:

```sh
bun scripts/wow1-verify.mjs 'http://127.0.0.1:5197/?forceWebGL=1'
```

Result: WebGL2 backend, zero console errors, zero page errors; desktop 1440×900, mobile 390×844, and reduced-motion checks passed.

## Build

`bun run build` passed. Tail of output:

```text
dist/assets/calibration-Cs_nk21Q.js           2.37 kB │ gzip:   1.13 kB
dist/assets/index-DqO26vUr.js               257.13 kB │ gzip:  88.90 kB
dist/assets/three.webgpu-DSYoYy_N.js        914.74 kB │ gzip: 251.14 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 829ms
```

## Files changed

- `src/zones.js`
- `src/story.js` (DOM rail wrapper and photo-card hit-testing only; no scroll constants/easing)
- `src/styles.css`
- `src/copy.js`
- `src/features/sun.js`
- `src/features/lightbox.js`
- `src/main.js`
- `scripts/wow1-verify.mjs`
- `WOW1-RESULT.md`
