# GI2 result — GI1 audit fixes

Date: 2026-08-24

## Result

All six audit findings are fixed. WebGPU now defaults to the realistic SSGI/AO chain with TRAA and no screen-space ink. `?look=sketch` selects the inexpensive outline chain without SSGI/AO. Forced WebGL2 remains the plain direct render path. `three` remains pinned at `0.185.1`, no dependency was added, and no scroll-feel constant or easing in `src/story.js` was changed.

## 1. Walkthrough convergence

The walkthrough frame loop now distinguishes actual camera changes from convergence work:

- camera movement or view input calls `viewer.invalidate()` and renders;
- an active door animation renders through the viewer's existing scene-motion path without an extra walkthrough invalidation;
- after input/door motion stops, the loop continues calling `viewer.render()` while `convergenceFramesRemaining > 0`, allowing the budget to drain;
- entry invalidates and renders synchronously once before scheduling the next animation frame, so entry cannot show a stale story frame.

Scripted WebGPU proof in `scratchpad/verify/gi2-report.json`:

- walkthrough entry render count: `33 → 34`, remaining after that first render: `31`;
- after movement stopped (including the nearby authored door finishing), sampled remaining frames: `32 → 24 → 16 → 8 → 0`;
- after convergence, render count stayed `207 → 207` for 1.5 seconds.

## 2. Balcon sun autoplay

Autoplay remains enabled by design while the balcon beat is active. Sun/daylight work is now bounded to a 24 Hz cadence, using elapsed-time-based smoothing so the visual speed does not depend on display refresh rate. Leaving balcon stops advancement, eases daylight back to the default, snaps the final sub-threshold value exactly to the default, then permits normal GI convergence and idle.

The sun clock is reset on every `visibilitychange`; hidden-frame updates consume zero elapsed time, and elapsed time is independently capped at 100 ms. A hidden tab or rAF starvation therefore cannot apply the full missing wall-clock interval on return.

Scripted WebGPU proof:

- active autoplay moved the range from `11.5` to `12.0` with 27 daylight applications in 1.2 seconds (bounded near 24 Hz, with transition timing included);
- after leaving balcon, remaining reached `0`, render count stayed `462 → 462`, and daylight-call count stayed `41 → 41` for 1.5 seconds.

## 3. Staging render lock

The 1.25 second timer now marks only the minimum overlay interval. A separate lock synchronizer calls `story.setRenderSuppressed('staging', true)` only when the overlay is still active, the minimum has elapsed, and `viewer.convergenceFramesRemaining === 0`. If a resize or other invalidation occurs while locked, the lock is released so the new convergence window can drain before it locks again.

Scripted proof deliberately invalidated on every rAF for longer than 1.25 seconds:

- while forced dirty: remaining `32`, lock events `[]`;
- after repeated invalidation stopped: the first lock event had `suppressed: true`, remaining `0`, render count `725`.

## 4. TRAA and real/sketch looks

The selected AA node is r185.1's `TRAANode` through `traa()`, matching the official `webgpu_postprocessing_ssgi.html` approach. It integrates with the recurrent GI/AO chain: the single-sampled scene MRT supplies depth and velocity, recurrent reprojection/denoise resolves GI and AO, the lit scene/zones/backdrop are composited, and TRAA performs the final temporal resolve. No SMAA/FXAA fallback was needed.

TRAA normally owns the camera view offset while jittering. The integration preserves and restores the story's authored view offset around each jitter and scales the subpixel offset for DPR, retaining existing off-center compositions and the POSE-FLY final-camera override.

- `real`: default for WebGPU; SSGI/AO + recurrent denoise + TRAA; no ink outline. `?look=real` forces it explicitly.
- `sketch`: scene/normal MRT + zones/backdrop/grade + ink outline; no SSGI, AO, GI reprojection, recurrent denoise, or temporal convergence budget. Selected with `?look=sketch`.
- WebGL2: unchanged direct `renderer.render(scene, camera)` path; look is reported as `direct`.

Zoomed `520 × 300` contour crops use the same séjour camera. Before/after eye differed by less than `0.000003 m`, FOV by less than `0.000006°`, and quaternion components by less than `0.000001`. The former one-pixel staircase/ink along the diagonal ceiling line is absent in the TRAA result:

- BEFORE: `scratchpad/verify/gi2-aa-before-contour-crop.png`
- AFTER `real`: `scratchpad/verify/gi2-real-contour-crop.png`
- `sketch` outline proof: `scratchpad/verify/gi2-sketch-sejour.png`

All three WebGPU captures reported zero console errors and zero page errors.

## 5. Runtime DPR changes

`resize()` now recomputes the capped DPR every time. It compares against the renderer's current ratio, calls `renderer.setPixelRatio()` when changed, calls `setSize()` even when CSS dimensions are unchanged, and invalidates the temporal history. A renewable `matchMedia('(resolution: …dppx)')` change listener catches moves between displays/zoom DPR changes and registers a new query for the new value.

Code-path proof through Chrome device metrics kept CSS size fixed at `1425 × 844`: raw DPR changed `1 → 2`, renderer DPR changed `1 → 1.5` (desktop cap), and the new convergence window was already at `31` after its first resized render.

## 6. Disposal

`createPostPipeline().dispose()` now disposes `scenePass` and `zonePass` in addition to all real-look GI/reprojection/denoise/TRAA nodes and the render pipeline.

## Backend and regression checks

- Forced WebGL2 (`?forceWebGL=1`): backend `webgl2`, look `direct`, remaining `0`, render count `1 → 1` over 800 ms, zero console errors, zero page errors.
- POSE-FLY in the default WebGPU `real` chain: after fly input stopped, remaining reached `0` and render count stayed `809 → 809` over 900 ms.
- The existing forced-WebGL POSE-FLY verifier also passed after these changes: fly idle `19 → 19`, return idle `44 → 44`, zero console/page errors.

Machine-readable behavioral evidence: `scratchpad/verify/gi2-report.json`.

## Build

`bun run build` passed. Final tail:

```text
dist/assets/index-oUk8xvRT.css               30.15 kB │ gzip:   7.05 kB
dist/assets/config-Dk1WdJBJ.js                1.37 kB │ gzip:   0.67 kB
dist/assets/calibration-CoHRs8b4.js           2.40 kB │ gzip:   1.14 kB
dist/assets/pose-D1rSmS4M.js                  6.39 kB │ gzip:   2.63 kB
dist/assets/index-CXJxWFr4.js               268.60 kB │ gzip:  92.14 kB
dist/assets/three.webgpu-fEnFVguv.js        913.69 kB │ gzip: 250.03 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 924ms
```

The chunk-size message is Vite's existing advisory warning; the build exited successfully.

## Files changed

- `src/features/walkthrough.js`
- `src/features/sun.js`
- `src/features/staging.js`
- `src/viewer.js`
- `src/post.js`
- `scripts/gi2-verify.mjs`
- `scripts/gi2-capture.mjs`
- `GI2-RESULT.md`
- `scratchpad/verify/gi2-report.json`
- `scratchpad/verify/gi2-aa-before-contour-crop.png`
- `scratchpad/verify/gi2-real-contour-crop.png`
- `scratchpad/verify/gi2-sketch-sejour.png`
- Existing `scratchpad/verify/pose-fly-report.json` and `pose-fly-high-topdown.png` were refreshed by the POSE-FLY regression run.
- `dist/` was regenerated by the required production build.
