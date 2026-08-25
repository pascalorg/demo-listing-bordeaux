# GI1 result — full-quality SSGI post chain

Date: 2026-08-24

## Result

The WebGPU post chain now produces actual screen-space bounced light as well as AO. It uses the official example's medium temporal sampling tier, velocity reprojection, and recurrent denoising with a bounded 32-frame convergence window. After those frames the existing render-on-demand loop idles again. The WebGL2 path remains the original direct scene render.

The Pascal color treatment was retained: renderer exposure remains `0.9`, ACES tone mapping is unchanged, the post grade remains contrast `1.05` / saturation `1.1`, and DPR caps remain `1.5` desktop / `1.25` coarse pointer. The new brightness and color variation is local indirect illumination rather than a global exposure or saturation adjustment.

## Reference and r185.1 adaptations

The current raw `three.js` example was fetched from:

`https://raw.githubusercontent.com/mrdoob/three.js/master/examples/webgpu_postprocessing_ssgi.html`

At the time of this work, current master builds an output/diffuse/normal/velocity MRT, runs SSGI at `sliceCount = 2` and `stepCount = 8`, composites `direct * AO + diffuse * GI`, then temporally resolves the composite with `TRAANode`. The task called for the recurrent-denoise route; that portion was adapted from the APIs and defaults shipped locally in pinned `three@0.185.1` (`TemporalReprojectNode.js` and `RecurrentDenoiseNode.js`) without upgrading Three.

Adaptations made for r185.1:

- Used the separate `getAONode()` and `getGINode()` SSGI outputs.
- Added `velocity` to the scene MRT.
- Built separate AO and GI feedback chains: temporal reprojection with external recurrent-denoise history, followed by diffuse-mode recurrent denoising. Keeping the channels separate preserves `scene * AO + diffuse * GI`; it does not spatially blur the already-lit scene.
- AO is supplied in the raw alpha channel for AO-aware denoise edge stopping. Temporal frame-weight alpha remains separate.
- Disabled MSAA only for the WebGPU scene MRT with `pass(scene, camera, { samples: 0 })`. r185.1's temporal history uses single-sample depth and WebGPU rejects a copy from the renderer's 4× MSAA depth attachment. The zone pass, renderer configuration, and WebGL2 fallback were not changed.
- Kept the existing far-depth AO fade, zone additive composite, screen-space ink, backdrop, grade, and output transform order.

## Quality preset

All tuning is grouped in the single `POST_QUALITY` object at the top of `src/post.js`.

| Setting | Value |
|---|---:|
| SSGI slices | 2 |
| SSGI steps per side | 8 |
| Samples per pixel | 32 (`2 × 8 × 2`) |
| Radius | 12 m |
| Distribution exponent | 2 |
| Thickness | 1 m |
| Backface lighting | 0 |
| AO intensity | 1 |
| GI intensity | 10 |
| Screen-space sampling | true |
| SSGI temporal sample rotation | true |
| Recurrent radius | 5 |
| Luma / depth / normal phi | 5 / 5 / 5 |
| Diffuse phi | 100 |
| Recurrent strength | 0.25 |
| History / convergence frames | 32 |

These are the example's `2 × 8` medium temporal tier plus the r185.1 SSGI and recurrent-denoise defaults made explicit for future dialing.

## Before / after evidence

Method: Chrome for Testing 148, WebGPU enabled through Metal, viewport `1440 × 900`, device scale factor `1`. Each capture used the exact story-track beat position. Camera positions, quaternions, and FOV matched numerically between the before and after captures (differences were below normal easing/float tolerance). The AFTER capture waited for `convergenceFramesRemaining === 0`.

Another agent was concurrently changing the permitted DOM/UI files, so some page chrome differs between sets. The 3D beat and camera framing are matched.

### Séjour — beat 2

- BEFORE: `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/before/webgpu-beat-2-sejour.png`
- AFTER: `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/after/webgpu-beat-2-sejour.png`
- Camera: position approximately `[-3.05, 1.62, -3.72]`, FOV `62°`.

### Chambre 1 / suite — beat 5

- BEFORE: `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/before/webgpu-beat-5-chambre1.png`
- AFTER: `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/after/webgpu-beat-5-chambre1.png`
- Camera: position approximately `[-6.05, 1.40, 5.20]`, FOV `70°`.

### Chambres 2 & 3 — beat 7

- BEFORE: `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/before/webgpu-beat-7-chambres.png`
- AFTER: `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/after/webgpu-beat-7-chambres.png`
- Camera: position approximately `[0.25, 5.80, 2.40]`, FOV `42°`.

The baseline set was captured before either source file was edited.

## Performance and idle evidence

Machine: Apple M5 Max (`arm64`), macOS 26.5.2. Browser: Chrome for Testing 148, WebGPU/Metal. Measurement was taken at the settled séjour beat, `1440 × 900`, DPR 1.

Method: after the scene had already settled and idled, a single `viewer.invalidate()` was issued. A temporary Playwright page probe sampled `viewer.renderCount` on `requestAnimationFrame` until the convergence counter reached zero, then watched the count for another 1.5 seconds. No application instrumentation was added or left behind.

- Frames rendered: **32**
- Total convergence window: **300.9 ms**
- Mean presented-frame interval: **9.13 ms** (roughly **109.6 fps** during convergence)
- Idle check: render count stayed **65 → 65** for **1.5 s** after convergence
- Final `convergenceFramesRemaining`: **0**

This is a rough presented-frame measurement, not a GPU timestamp query.

## Backend checks

- WebGPU: model ready, all three required captures completed after convergence, zero console errors, zero page errors, and zero WebGPU validation errors.
- Forced WebGL2 (`?forceWebGL=1`): backend reported `webgl2`, rendered successfully, `convergenceFramesRemaining` stayed `0`, zero console errors, and zero page errors.

## Build evidence

`bun run build` passed. Tail of the final output:

```text
dist/assets/index-DmnNUiFM.css               30.32 kB │ gzip:   7.09 kB
dist/assets/calibration-Cs_nk21Q.js           2.37 kB │ gzip:   1.13 kB
dist/assets/index-DqO26vUr.js               257.13 kB │ gzip:  88.90 kB
dist/assets/three.webgpu-DSYoYy_N.js        914.74 kB │ gzip: 251.14 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking
- Adjust chunk size limit via build.chunkSizeWarningLimit.
✓ built in 1.18s
```

The chunk-size message is Vite's existing advisory warning; the build exited successfully.

## Files changed

- `src/post.js` — full GI/AO SSGI, velocity MRT, temporal reprojection, recurrent denoise feedback, and the centralized quality preset.
- `src/viewer.js` — minimal bounded convergence counter in the existing dirty render path; exposed a read-only remaining-frame getter for verification.
- `GI1-RESULT.md` — this report.
- `scratchpad/verify/before/*.png` and `scratchpad/verify/after/*.png` — required visual evidence.

`bun run build` also regenerated the normal Vite `dist/` output.
