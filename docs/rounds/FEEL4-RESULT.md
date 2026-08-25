Implemented all four Scroll Feel v4 items. Dev server remains available at `http://127.0.0.1:5180`.

- Replaced snap/settle with additive physical wheel inertia and `a = 0.90` dwell pacing in [story.js](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:8).
- Added 600 ms scroll-triggered yaw/pitch recentering and mouse vertical look.
- Doubled parallax to `0.8° / 0.5°`.
- Fixed idle zone invalidation so settled hover produces zero render frames in [zones.js](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/zones.js:205).
- Replaced snap probes with V1a/b/c inertia probes in [verify.mjs](/Users/wawa/Documents/Projects/pascal/apartment-listing/scripts/verify.mjs:531).
- Updated [SPEC.md](/Users/wawa/Documents/Projects/pascal/apartment-listing/SPEC.md:239).

Key evidence:

- Parked 2 seconds: `0.000 px` movement.
- Calibrated impulse: `0.9744 beats` travel, `0.0256-beat` next-center error, monotonic decay.
- Mid-coast input: `0 px` jump, effectively zero additive velocity error.
- Console errors: `0`; page errors: `0`.
- Forced WebGL2 verification: all assertions pass.
- `bun run build`: passes.

Full constants and measurements are in [FEEL4-RESULT.md](/Users/wawa/Documents/Projects/pascal/apartment-listing/FEEL4-RESULT.md).