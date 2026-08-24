Implemented the mobile plan-beat fix.

- Plan copy now uses the shared full-width mobile card.
- Added collapsed “Voir le plan / View plan” strip and expandable overlay with scrim and close control.
- Mobile rooms use first tap to highlight, second tap or room action to fly.
- 3D zone labels hide while the overlay is open.
- Plan camera centers the model above the copy sheet without desktop offsets.
- Prevented staging, sun, and compare controls from overlapping mobile copy sheets.
- Added repeatable mobile verification in [verify-mobile.mjs](/Users/wawa/Documents/Projects/pascal/apartment-listing/scripts/verify-mobile.mjs).

390×844 probes:

- [Hero](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p3-mobile-hero.png)
- [Staging](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p3-mobile-staging.png)
- [Balcon](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p3-mobile-balcon.png)
- [Chambre 1](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p3-mobile-chambre1.png)
- [Plan collapsed](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p3-mobile-plan.png)
- [Plan expanded](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p3-mobile-plan-expanded.png)

`bun run build` passes. Browser probes reported zero console and page errors.