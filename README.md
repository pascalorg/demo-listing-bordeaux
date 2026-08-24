# Pascal apartment listing — Phase 2

A Bun + Vite, scroll-driven presentation of the Cenon Pascal capture. It uses the authored GLB at its original metre scale, Three.js WebGPU/TSL when available, and an explicit WebGL2 fallback.

## Run

```sh
bun install
bun run dev
```

Open `http://localhost:5173`. Production commands are `bun run build` and `bun run preview`.

## Content and replacement files

- `public/assets/model/apartment.glb` is the authored Pascal model and must stay in its original coordinate system.
- `public/assets/data/layout.json` supplies opening and fence metadata; runtime zone geometry comes from the GLB extras.
- `public/assets/diagnostics/` contains the official DPE A (48 kWhEP/m²/an) and GES C
  (11 kgéqCO₂/m²/an) charts opened from the embedded figures-grid badges in the shared lightbox.
- `public/assets/renders/` ships seven optimized 1920px WebPs: three séjour projections
  (`bord-de-mer`, `boheme`, `scandinave`) and four Chambre 1 projections
  (`scandinave`, `japandi`, `boheme`, `cosy`). They are included in the story switchers and gallery lightbox.
- Confirm that source `photo-1` is Chambre 2 rather than Chambre 3.
- Daylight uses the confirmed listing orientation: the north-east balcony edge maps to world +X.

## Interactive features

- `?calib=sejour`, `?calib=chambre1`, and `?calib=salledeau` enable the development-only photo calibration overlay. Use WASD + QE for the eye, arrow keys for the target, `[` / `]` for FOV, Shift for fine steps, and `C` to log/copy the current values.
- `?pose` enables the lightweight live camera-pose overlay in both story and walkthrough modes; press `C` to log/copy a paste-ready pose. Press `F` for unconstrained pointer-lock fly mode: mouse look, WASD, Q/E or Space/Ctrl vertically, Shift to accelerate, wheel to change speed, and `[` / `]` for FOV.
- The staging beat dissolves to the current photograph and three shipped, decoded-on-selection séjour renders.
- The bedroom and en-suite beats use photo-matched cameras with compact thumbnail cards that leave the 3D model visible around them; Chambre 1 also switches between its photograph and four shipped staging styles.
- The balcony scrub uses a simple summer solar approximation for Cenon (44.857, −0.522), with world +X mapped to north-east so morning light reaches the balcony.
- The generated SVG plan uses model polygons for interaction and official areas for display. Its persistent desktop mini-plan (also visible in walkthrough, and walkthrough-only on mobile) shows the live camera point and horizontal-FOV cone using the same X/Z orientation. Clicking expands the full panel; room clicks enter a temporary camera-browse pause, and scrolling resumes the story.
- Fine-pointer story mode adds reduced-motion-aware mouse parallax plus clamped drag yaw/pitch that recentres during story travel. Discrete wheel input uses additive physical inertia with no idle snap, while trackpad, keyboard, scrollbar, deep-link, and below-story document scrolling stay native. Beat dwell uses a monotonic sinusoidal velocity dip rather than a stop plateau.
- Desktop free visit uses click-to-acquire pointer lock, 0.002 rad/px look, 60° FOV, WASD/arrow keys, Shift run, and `P` pointer release/reacquire. Escape exits and restores the exact story scroll position. Mobile keeps drag-to-look and a hold-to-walk-forward control. Both use polygon bounds and authored door openings.

The authored balcony door opens on approach, and the suite pocket door opens during the transition into the shower-room beat.

## Performance notes

Three.js is pinned and self-hosted at `0.185.1`. Desktop DPR is capped at 1.5 and coarse-pointer/mobile DPR at 1.25. WebGPU uses the Pascal-style AO/denoise/ink pipeline; WebGL2 renders the authored PBR scene directly with shadows and IBL.
