Implemented all five polish items. Full evidence is in [FEEL5-RESULT.md](/Users/wawa/Documents/Projects/pascal/apartment-listing/FEEL5-RESULT.md).

Key results:

- Drag clamps: `±0.90` yaw / `±0.45` pitch; 600 ms recenter preserved.
- Parallax: `1.6°` yaw / `1.0°` pitch; zero idle renders.
- All nine beats at `1440×900` and `390×844`: zero card/mini-plan/feature-UI overlaps.
- Séjour center: full-3D speed ratio `2.45%`; zero Y reversals within ±0.1 beats.
- Pascal SVG wordmark added to header and footer; favicon unchanged.
- Console errors: `0`; page errors: `0` on forced WebGL2.
- `bun run build`: passes.
- Dev server remains live at `http://127.0.0.1:5180`.

Evidence:

- [Floor beat screenshot](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feel5-floor-1440x900.png)
- [Header logo screenshot](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feel5-header-logo.png)
- [Motion probe results](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feel5-after.json)
- [Layout audit](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feel5-layout.json)