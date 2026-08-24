# DOOR1 result — scrubbed doors, camera pose capture, and via paths

Date: 2026-08-24

## Result

The two requested authored door animations are now driven directly from absolute story-transition progress. Story playback never advances an animation mixer autonomously: each action is paused, its time is set explicitly, and `mixer.update(0)` evaluates that exact pose. Reverse scrolling therefore closes each door along the same timeline.

Door time uses a gentle quintic ease of the transition's existing paced value. It clamps to closed before the mapped transition and open after it, so the door remains open on all later beats.

## Door and clip mapping

| Transition | Node | GLB clip | Rendered center | Verification |
|---|---|---|---|---|
| `floor → sejour` | `door_cvdmtaj49xgwpnfh` | `door_cvdmtaj49xgwpnfh: open` | `(-2.200, 1.100, -3.100)` | The 1.50 m, two-leaf French door is exactly on the seeded path and is the opening the camera crosses. The neighboring 0.90 m hinged door at Z `-1.670` is not on the sightline, so it was deliberately left unmapped. |
| `chambre1 → salledeau` | `door_2udbl7hf9ws2cdnr` | `door_2udbl7hf9ws2cdnr: open` | `(-7.350, 1.100, 6.750)` | `layout.json` identifies it as the pocket door on the shared Chambre 1 / Salle d'eau boundary; the mid-transition browser capture shows its leaf part-open. |

At the three French-door evidence points, measured story values were approximately `t=0.299 / 0.598 / 0.899`; the eased clip times were `0.162 / 0.679 / 0.991 s` on the 1-second clip. The suite pocket-door capture used story `t=0.551`, producing clip time `0.596 s`.

## Direct jumps and reloads

Door state is recomputed from the absolute current story value on every active story frame, rather than inferred from traversal history. This makes progress-dot jumps, direct scroll changes, hash navigation, and reloads converge to the same state:

- before a transition: clip time `0`;
- during it: eased transition fraction × clip duration;
- at and after the destination: clip time `duration`.

The layout loader's authored `operationState` handoff is guarded so it cannot overwrite an already-scrubbed action. The scrub cache also validates the actual action time before skipping work. This prevents the async `layout.json` load from leaving the pocket door half-open during a direct hash load.

Verification after a direct dot jump to `plan`, a fresh `#plan` navigation, and a `#plan` reload found both records at progress `1`, action time `1`, paused `true`, and moving `false`.

## Optional `via` format

`via` belongs on the destination beat and shapes the transition into that beat:

```js
{
  id: 'destination',
  eye: [x, y, z],
  tgt: [x, y, z],
  fov: 60,
  via: [
    { eye: [x, y, z], tgt: [x, y, z], fov: 64, at: 0.55 },
    { eye: [x, y, z], tgt: [x, y, z] },
  ],
}
```

- `eye` and `tgt` are required on every intermediate pose.
- `fov` is optional; when omitted, it follows the transition's endpoint FOV interpolation.
- `at` is an optional transition fraction in `[0, 1]`; omitted values default to evenly spaced positions.
- One or more poses are supported. Eye, target, and FOV use a shape-preserving cubic Hermite path, passing through each pose with continuous direction and no waypoint kink.
- Beats without `via` retain their previous linear eye/target/FOV interpolation exactly.

The seeded `sejour` waypoint is:

```js
{ eye: [-1.55, 1.64, -3.1], tgt: [-6.2, 1.18, -2.72], fov: 66, at: 0.58 }
```

It descends from the floor overview to standing height just outside the French door, looks into the living room, then passes through the open leaves to the authored séjour pose. The rendered camera was approximately `[-1.65, 1.64, -3.10]` at story `t≈0.60`.

## Pose capture tool

`?pose` dynamically imports the capture module. Without the parameter there is no pose DOM (`noPoseDomCount: 0`) and the module is not requested.

The overlay shows the rendered eye, target, FOV, transition ids, and transition progress to two decimals. Story targets come from the final composed story camera. In walkthrough, target is derived from camera position plus its live world look direction. Pressing `C` always logs the JSON and writes it to the clipboard when permission allows; the overlay briefly flashes `copied`.

Verified clipboard payload:

```json
{ "eye": [-1.65, 1.64, -3.10], "tgt": [-6.24, 1.18, -2.72], "fov": 65.99 }
```

The overlay updates from actual viewer renders and does not run its own animation loop. Story metadata avoids DOM writes when its rounded display value is unchanged.

## Render-on-demand and backend verification

- Door scrubs call the existing `viewer.invalidate()`, which resets GI1's bounded WebGPU convergence counter through the same dirty path.
- WebGPU/Metal audit: backend `webgpu`, French action paused at exact time `0.500`, convergence remaining `0`, zero console/page errors, and render count stayed `75 → 75` over 800 ms after settling.
- Forced WebGL2 evidence run: zero console errors and zero page errors. After the final scrub, render count stayed `205 → 205` over 800 ms and convergence remained `0`.
- Walkthrough pose audit returned eye `[-7.05, 1.60, 2.20]` and unit-direction-derived target `[-7.69, 1.57, 1.44]`.

Machine-readable verification: `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/door1-report.json`.

## Screenshots

- `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/door1-floor-sejour-t03.png`
- `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/door1-floor-sejour-t06.png`
- `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/door1-floor-sejour-t09.png`
- `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/door1-suite-salledeau-mid.png`
- `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/door1-sejour-open.png`
- `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/door1-direct-dot-late.png`
- `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/door1-pose-overlay.png`

The direct-jump shot keeps the `plan` chapter visibly active while using the existing browse camera to look back through the fully open French door. The report records both mapped actions at exact time `1` for that shot.

## Build

`bun run build` passed. Tail of output:

```text
dist/assets/index-DmnNUiFM.css               30.32 kB │ gzip:   7.09 kB
dist/assets/config-Dk1WdJBJ.js                1.37 kB │ gzip:   0.67 kB
dist/assets/pose-CeULQyzN.js                  2.35 kB │ gzip:   1.20 kB
dist/assets/calibration-CoHRs8b4.js           2.40 kB │ gzip:   1.14 kB
dist/assets/index-CAmuJei0.js               259.53 kB │ gzip:  89.86 kB
dist/assets/three.webgpu-fEnFVguv.js        913.69 kB │ gzip: 250.03 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking
- Adjust chunk size limit via build.chunkSizeWarningLimit.
✓ built in 859ms
```

The chunk-size message is Vite's existing advisory warning; the build exited successfully.

## Files changed

- `src/viewer.js` — exact paused-action scrubbing, async layout-state race guard, render subscriptions.
- `src/story.js` — per-destination door mappings, absolute transition scrubbing, optional via interpolation, seeded séjour waypoint, pose metadata accessors. Scroll-feel constants and wheel/inertia easing logic were not changed.
- `src/pose.js` — query-gated live capture overlay and clipboard/log behavior.
- `src/main.js` — dynamic `?pose` mount.
- `README.md` — pose-tool usage note.
- `scripts/door1-verify.mjs` — visual, navigation, clipboard, walkthrough, backend, and idle evidence harness.
- `DOOR1-RESULT.md` — this report.
- `scratchpad/verify/door1-*.png` and `scratchpad/verify/door1-report.json` — evidence.
- `dist/` — regenerated by the required production build.

---

## Follow-up — unconstrained `?pose` FLY mode

The pose feature now includes a fully unconstrained six-axis camera mode. Press `F` to detach at the currently rendered pose. `F` again or `Esc` starts a 750 ms smooth handoff back to the live scroll-driven pose.

Controls shown in the injected overlay:

- pointer-lock mouse look (`F` requests lock; clicking the canvas reacquires it if the browser declines the keyboard request);
- `WASD` view-relative movement;
- `Q` / `Ctrl` down and `E` / `Space` up in world space;
- `Shift` for 4× speed;
- mouse wheel for a clamped `0.1–40 m/s` base speed;
- `[` / `]` for live FOV adjustment, clamped to `20–90°`;
- `C` retains JSON logging/clipboard capture.

FLY has no collision, zone, or eye-height constraints. Its capture target is always `eye + worldDirection × 5 m`. Story scrolling continues to resolve its authored camera underneath a minimal final-camera override, so the return animation always targets the current story pose rather than a stale entry pose. No story DOM/markup or scroll-feel code was changed for this follow-up.

The pose module still owns and injects all its styling. Because it remains dynamically imported by the existing query check, `?pose` absent creates no pose/fly DOM or input listeners; browser verification found `noPoseDomCount: 0`.

### Evidence

High, downward-looking FLY pose, unreachable by the séjour scroll path:

- screenshot: `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/pose-fly-high-topdown.png`
- machine report: `/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/pose-fly-report.json`
- eye: `[-3.05, 9.82, -3.72]`
- direction: approximately `[-0.010, -0.99995, 0.003]`
- derived target: `[-3.10, 4.82, -3.71]`
- FOV: `69.00°`
- copied JSON: `{ "eye": [-3.05, 9.82, -3.72], "tgt": [-3.10, 4.82, -3.71], "fov": 69.00 }`

Forced-WebGL2 verification had zero console/page errors. After fly input stopped and convergence completed, render count stayed `17 → 17` over 900 ms. After the smooth return completed, it stayed `42 → 42` over 900 ms. `F` exit and `Esc` exit both cleared FLY state.

A separate Chrome WebGPU/Metal audit moved the camera to Y `5.71`, then stopped input: convergence reached `0`, render count stayed `128 → 128` over 900 ms, and there were zero console/page errors. Both paths invalidate through `viewer.invalidate()`, preserving GI1's bounded convergence and render-on-demand idle behavior.

### Follow-up files changed

- `src/pose.js` — fly controls, injected FLY styling, 5 m capture target, return interpolation.
- `src/story.js` — minimal final-camera override hook and setter only; no DOM/markup or scroll-feel changes.
- `README.md` — FLY control reference.
- `scripts/pose-fly-verify.mjs` — screenshot, controls, clipboard, return, and idle audit.
- `scratchpad/verify/pose-fly-high-topdown.png`
- `scratchpad/verify/pose-fly-report.json`
- `DOOR1-RESULT.md` — this follow-up record.
- `dist/` — regenerated by the production build.

### Follow-up build

`bun run build` passed. Tail of output:

```text
dist/assets/index-oUk8xvRT.css               30.15 kB │ gzip:   7.05 kB
dist/assets/config-Dk1WdJBJ.js                1.37 kB │ gzip:   0.67 kB
dist/assets/calibration-CoHRs8b4.js           2.40 kB │ gzip:   1.14 kB
dist/assets/pose-D1rSmS4M.js                  6.39 kB │ gzip:   2.63 kB
dist/assets/index-BJ-U-osX.js               259.94 kB │ gzip:  89.84 kB
dist/assets/three.webgpu-fEnFVguv.js        913.69 kB │ gzip: 250.03 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking
- Adjust chunk size limit via build.chunkSizeWarningLimit.
✓ built in 857ms
```
