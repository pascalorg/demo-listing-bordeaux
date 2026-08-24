# CAM1 result

## Build

`bun run build` passed.

## Evidence

- `scratchpad/verify/cam1-floor-sejour-t036.png` — exterior wow pose at `t≈0.36`.
- `scratchpad/verify/cam1-balcon-chambre1-t043.png` — exterior bedroom approach at `t≈0.43`.
- `scratchpad/verify/cam1-balcon-chambre1-window-entry.png` — window entry at `t≈0.62`; sash is visibly part-open (scrub progress `0.717`).
- `scratchpad/verify/cam1-chambre1-arrival.png` — new suite camera.
- `scratchpad/verify/cam1-chambre1-salledeau-t035.png` — shaped suite path at `t≈0.35`; pocket-door scrub is active.
- `scratchpad/verify/cam1-salledeau-arrival.png` — new salle d'eau camera.
- `scratchpad/verify/cam1-salledeau-chambres-t016.png` — lifted camera at `t≈0.16`, clear of the walls.

The rest of `salledeau → chambres` was checked from the rendered camera at 51 evenly spaced points. No point below the 2.5 m wall top came within the conservative 0.12 m wall threshold; minimum non-opening clearance was 0.422 m. Full states are in `scratchpad/verify/cam1-report.json`.

Copied transition payload:

```json
{ "eye": [5.60, 2.87, -4.36], "tgt": [0.80, 2.25, -3.00], "fov": 58.96, "transition": "floor → sejour", "t": 0.36 }
```

## Implementation notes

- `PHOTO_CAMS.sejour`, `PHOTO_CAMS.chambre1`, and `PHOTO_CAMS.salledeau` are the requested exact source-of-truth poses.
- The bedroom opening is casement `window_cheeuc6e0qbb0e44`, centered at `(-2.2, 5.85)`. The GLB includes `window_cheeuc6e0qbb0e44: open`, so that authored one-second clip is scrubbed absolutely; direct jump/reload/reverse verified progress `1 / 1 / 0`.
- Smoothing tweaks were limited to moving the retained French-door waypoint from `at: 0.58` to `0.70`, placing the supplied at-window waypoint at `0.68`, and disabling the generic added flight arc on the three newly authored `via` paths so their captured elevations remain exact. Door pass-through waypoints and scrubs remain in place.
- `?pose` keeps the same overlay. Copy adds `transition`/`t` while between beats and `beat` when on a beat; a settled suite copy returned `{ ..., "beat": "chambre1" }`.
- Forced WebGL2 verification had zero console/page errors. A WebGPU `real`/TRAA smoke check also had zero errors and converged to `0` remaining frames.
