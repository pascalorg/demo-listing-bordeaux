# CAM2 result

## Build

`bun run build` passed.

## Evidence

- `scratchpad/verify/cam2-floor-sejour-no-zone-blink-t0501.png` — direct reduced-motion step from `floor` to story `t=0.501`; zone fade still had `current=0.595`, but visible zone meshes stayed `0` (also `0` at stepped `t=0.49/0.51/0.55`).
- `scratchpad/verify/cam2-balcon-chambre1-waypoint-t076.png` — exact waypoint: eye `[-3.00, 0.88, 5.50]`, target `[-7.88, 0.74, 6.59]`, FOV `69.75`.
- `scratchpad/verify/cam2-floor-sejour-before-scrub-t051.png` — French door closed below the `0.52` start (`progress=time=0`).
- `scratchpad/verify/cam2-balcon-chambre1-before-scrub-t046.png` — bedroom window closed below the `0.47` start (`progress=time=0`).
- `scratchpad/verify/cam2-chambre1-salledeau-before-scrub-t057.png` — pocket door closed below the `0.58` start (`progress=time=0`).
- `scratchpad/verify/cam2-sky-real-balcon-restored.png` — WebGPU `real` balcon view that was black before the fix; the blue/haze backdrop is restored.

The window pass used 26 samples over `t=0.4…0.9`. Minimum conservative camera-to-window-mesh AABB clearance was `0.124 m` at `t=0.70`; no sample entered the `0.10 m` camera radius. Direct-late/reload-late/reverse-early opening states remained exactly `1 / 1 / 0`. WebGPU `real`, WebGPU `sketch`, and forced WebGL2 produced zero console/page errors. Full values: `scratchpad/verify/cam2-report.json`.

## Root causes and fixes

- Zone blink: changing `labels → off` left a nonzero fade value, while `zones.tick()` treated every mode except `labels` as geometry-visible. `off` now keeps meshes hidden; only `context` and `active` may render zone geometry.
- Missing sky: TRAA was temporally resolving clear-depth pixels despite their having no scene velocity/history, replacing the correct pre-TRAA backdrop with black. Clear-depth pixels now take the graded backdrop after TRAA; scene pixels retain the SSGI/TRAA result. Exterior and through-window checks show the backdrop again.

Opening starts are per destination transition and remap only scrub progress before the existing quintic ease. No scroll-feel constants/easing or dependencies changed.

## Follow-up — refined balcon → chambre1 corridor

This supersedes the earlier `t=0.76` single-waypoint fix. The transition now passes exactly through the supplied `t=0.46 / 0.70 / 0.80` poses using the existing shape-preserving Hermite curve; the window scrub still starts at `t=0.47`.

- `scratchpad/verify/cam2-balcon-chambre1-corridor-t070.png` — exact through-opening pose at `t=0.70`: eye `[-1.98, 0.92, 5.67]`, target `[-6.97, 0.73, 5.75]`, FOV `69.47`, with no window clipping.
- Clearance sweep, 26 samples over `t=0.4…0.9`: minimum oriented window/sash clearance `0.169 m`; minimum solid-wall clearance outside the aperture `0.314 m`; zero intersections for the `0.10 m` camera radius.
- `bun run build` passed.

Refreshed machine values: `scratchpad/verify/cam2-report.json`.
