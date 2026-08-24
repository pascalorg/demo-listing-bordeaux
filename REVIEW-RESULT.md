Verdict: **not ship-ready**. The fresh production build succeeds and forced WebGPU/WebGL2 checks pass, but the following contract and correctness defects remain.

## High

1. **Automatic renderer fallback races two renderers on the same canvas**

   [src/viewer.js:41](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/viewer.js:41), [src/viewer.js:53](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/viewer.js:53)

   `Promise.race()` abandons neither the initialization promise nor its renderer. On timeout or initialization failure, a second `WebGPURenderer` is created on the same canvas without disposing the first.

   Failure scenario: WebGPU initialization exceeds four seconds and later completes while the forced-WebGL renderer is initializing. Both attempts retain backend/context resources and can interfere with the canvas. The verifier’s `?forceWebGL=1` path bypasses this race rather than testing it.

   Minimal fix: retain the first renderer, clear the timeout, dispose it in every failure/timeout path, and only then construct the forced-WebGL renderer.

2. **Walkthrough permits crossing visibly closed doors**

   [src/features/walkthrough.js:37](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/walkthrough.js:37), [src/features/walkthrough.js:53](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/walkthrough.js:53), [public/assets/data/layout.json:140](/Users/wawa/Documents/Projects/pascal/apartment-listing/public/assets/data/layout.json:140)

   Every authored door becomes a collision opening regardless of `operationState`. Most doors have `operationState: 0`, while only the pocket door is fully open.

   Failure scenario: the camera walks directly through a closed bedroom, bathroom, or balcony door that remains visibly present in the GLB.

   Minimal fix: only admit openings whose `operationState` is sufficiently open, or animate/open the matching door before making its opening passable. Closed door leaves should remain colliders.

3. **Plan browse can trap the story and permanently render the full SSGI pipeline**

   [src/story.js:282](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:282), [src/story.js:299](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:299), [src/story.js:326](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:326)

   Browse mode is cleared only by `wheel` or `touchmove`; actual `scroll` events merely invalidate. `Boolean(browse)` also keeps `cameraMoving` true forever, even after the 900 ms flight has settled.

   Failure scenarios:

   - After clicking a room, Page Down, arrow-key scrolling, scrollbar dragging, or assistive scrolling changes the story position but leaves the camera frozen in browse mode.
   - Leaving the plan browse view idle continuously renders the expensive WebGPU SSGI/denoise pipeline.

   Minimal fix: resume browse on any user-originated scroll/navigation input, and track flight settlement separately so invalidation stops once `elapsed === 1`.

## Medium

4. **The final plan beat is cut short by 40% of a viewport**

   [src/story.js:71](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:71), [src/story.js:237](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:237), [src/styles.css:213](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/styles.css:213)

   The plan beat spans scroll positions `7vh–8vh`, but document mode begins at `7.6vh`. Its card, plan panel, labels, and rail therefore disappear while the user is still inside the story track.

   Failure scenario: the last 40% of the promised one-viewport plan chapter becomes a bare stage before the document reaches the viewport.

   Minimal fix: enter document mode at the document/track boundary, not `track.offsetHeight - innerHeight * 0.4`.

5. **Resizing or rotating can jump to a different beat**

   [src/story.js:71](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:71), [src/story.js:76](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:76), [src/story.js:325](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:325)

   `sizeTrack()` changes the scroll-to-beat denominator without preserving the current normalized story position.

   Failure scenario: beat 4 at a 900 px viewport is `scrollY=3600`; resizing to 700 px reinterprets that position as approximately beat 5.14.

   Minimal fix: capture the current beat/progress before resizing and restore the equivalent scroll position using the new track span.

6. **The interactive plan overlaps its story card on mobile**

   [src/styles.css:433](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/styles.css:433), [src/styles.css:460](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/styles.css:460)

   At a tested 390×844 viewport, the plan panel occupied approximately `y=64–468` while the plan card occupied `y=286–834`, producing about 182 px of overlap. Because the panel has the higher stacking order, it covers the copy.

   Minimal fix: give the panel and bottom sheet mutually exclusive vertical regions, or collapse/reduce one of them at narrow widths.

7. **The single-dictionary/i18n contract is incomplete**

   Relevant locations:

   - French-only visible placeholder artwork: [sejour-a.svg:2](/Users/wawa/Documents/Projects/pascal/apartment-listing/public/assets/renders/sejour-a.svg:2), [sejour-a.svg:8](/Users/wawa/Documents/Projects/pascal/apartment-listing/public/assets/renders/sejour-a.svg:8), with the same issue in B/C.
   - French-only calibration badge: [src/calibration.js:22](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/calibration.js:22)
   - Hardcoded time labels/format: [src/features/sun.js:44](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/sun.js:44), [src/features/sun.js:68](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/sun.js:68)
   - Visible official-area strings outside `copy.js`: [src/config.js:46](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/config.js:46), consumed directly at [src/features/plan.js:135](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/plan.js:135)
   - Plan SVG’s accessible name is created once and not updated on language changes: [src/features/plan.js:127](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/plan.js:127), [src/features/plan.js:155](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/plan.js:155)
   - Initial title duplicated outside the dictionary: [index.html:7](/Users/wawa/Documents/Projects/pascal/apartment-listing/index.html:7)

   Failure scenario: switch to English and select Ambiance A/B/C; the full-screen artwork still says “Rendu en préparation.” Calibration remains French, and a screen reader continues announcing the French plan title after a language switch.

   Minimal fix: make placeholder artwork textless and overlay dictionary-driven HTML, add calibration/time strings to `copy.js`, keep official numeric data language-neutral and format it through i18n, and update the SVG `aria-label` in `rebuildLabels()`.

8. **Staging controls are enabled before their sources exist**

   [src/features/staging.js:36](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/staging.js:36), [src/features/staging.js:40](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/staging.js:40), [src/features/staging.js:43](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/staging.js:43)

   `sources` initially contains only the current photo. A style click before the three asynchronous HEAD requests complete is silently ignored. Images are also switched into the dissolve before loading/decoding finishes.

   Failure scenario: deep-link to `#staging` on a slow connection and immediately select Ambiance A; nothing happens.

   Minimal fix: seed A/B/C synchronously with their SVG sources, upgrade them to JPG after probing, and preload/decode the next image before starting its crossfade.

9. **Lifecycle cleanup leaves active listeners and RAF work**

   [src/story.js:223](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:223), [src/story.js:309](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:309), [src/story.js:334](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:334), [src/story.js:387](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:387), [src/features/walkthrough.js:305](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/walkthrough.js:305), [src/features/walkthrough.js:324](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/features/walkthrough.js:324)

   `story.destroy()` does not cancel its recursively scheduled RAF or remove stage pointer and window scroll listeners. `walkthrough.destroy()` leaves click handlers attached to both persistent `.walk-trigger` buttons.

   Failure scenario: dispose/recreate the experience in an SPA or test harness; the old story continues running, and old walkthrough triggers can invoke a disposed viewer.

   Minimal fix: retain every handler and RAF ID, add a destroyed guard, cancel the RAF, and remove all listeners during teardown.

10. **The built site is not deployable under a subpath**

   [vite.config.js:3](/Users/wawa/Documents/Projects/pascal/apartment-listing/vite.config.js:3), [src/config.js:1](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/config.js:1), [src/copy.js:5](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/copy.js:5)

   The build emits root-relative `/assets/...` entry URLs, and runtime model, layout, photo, render, and `/basis/` URLs are also root-relative.

   Failure scenario: serving `dist/` at `https://host.example/apartment/` requests scripts, GLB, and transcoder files from `https://host.example/assets/...` and `https://host.example/basis/...`.

   Minimal fix: configure an appropriate relative/base path and construct runtime asset URLs from `import.meta.env.BASE_URL` or `new URL(..., import.meta.url)`.

## Low

11. **The required header walkthrough entry is removed on mobile**

   [src/styles.css:456](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/styles.css:456)

   At widths up to 900 px, the header walkthrough button is `display:none`; only the CTA far below the story remains.

   Minimal fix: retain a compact header icon/button on mobile.

12. **The verifier can produce a false green against a stale or unrelated server**

   [scripts/verify.mjs:9](/Users/wawa/Documents/Projects/pascal/apartment-listing/scripts/verify.mjs:9), [scripts/verify.mjs:16](/Users/wawa/Documents/Projects/pascal/apartment-listing/scripts/verify.mjs:16), [scripts/verify.mjs:65](/Users/wawa/Documents/Projects/pascal/apartment-listing/scripts/verify.mjs:65), [scripts/verify.mjs:606](/Users/wawa/Documents/Projects/pascal/apartment-listing/scripts/verify.mjs:606)

   Any HTTP 200 at the default URL is accepted without verifying that it serves this project or the current `dist`. The script also depends on machine-specific absolute Playwright/output paths, and its fallback mode directly forces WebGL rather than exercising WebGPU-failure recovery.

   Minimal fix: start the current build’s preview unconditionally on an isolated port or validate a build marker, resolve dependencies/output relative to the project, and add an initialization-failure fallback probe.

**Fix-first:** renderer ownership/fallback, closed-door collision, browse resume/permanent rendering, final-beat/resize math, mobile plan placement, and i18n placeholders.