Implemented all four feature items.

- Seven real 1920px WebP renders shipped and integrated into staging, Chambre 1 tabs, and the gallery/lightbox.
- Added subtle reduced-motion-aware mouse parallax.
- Added persistent live mini-plan with camera dot/FOV cone, including walkthrough and mobile behavior.
- Added discrete-wheel glide and monotonic dwell easing.
- Removed placeholder SVGs and probe logic.
- Updated [SPEC.md](/Users/wawa/Documents/Projects/pascal/apartment-listing/SPEC.md) and [README.md](/Users/wawa/Documents/Projects/pascal/apartment-listing/README.md).

Evidence: [RENDERS-RESULT.md](/Users/wawa/Documents/Projects/pascal/apartment-listing/RENDERS-RESULT.md)

Verification:

- Full WebGL2 verification: passed
- Assertions, console errors, warnings, page errors: 0
- Pacing ratio: 8.11% (`0.1500` centre vs `1.8500` travel)
- `bun run build`: passed
- Dev server `:5180`: HTTP 200 and remains loadable