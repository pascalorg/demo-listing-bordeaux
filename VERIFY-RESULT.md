# Phase 2 verification result

Run: 2026-08-24T12:33:03.464Z

Site: http://127.0.0.1:51020 (isolated preview of fresh dist on port 51020)

Chromium: /Users/wawa/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing

## Summary

| Launch mode | Launched | Backend reached | Model ready | Canvas evidence | Assertion failures |
| --- | --- | --- | --- | --- | --- |
| Forced WebGL2 fallback | yes | webgl2 | yes | 560547/1215360 compositor pixels changed (1440×844 canvas) | 0 |

## Forced WebGL2 fallback

Backend reached: webgl2

Console errors (verbatim):

```text
None
```

Console warnings (verbatim):

```text
None
```

Page errors (verbatim):

```text
None
```

Phase 2 feature probes:

- asset metrics: layout {"item":45,"wall":48,"door":12,"slab":14,"ceiling":12,"zone":9}, GLB walls 47 + 1 zero-length layout wall
- camera clearance: 9 story eyes and 3 photo eyes clear
- updated model structure and camera clearance: pass
- pacing metrics: center 0.1000, travel 1.9000, ratio 5.26%
- deep dwell velocity pacing: pass
- physical idle metrics: 0.000px maximum movement over 2s, mode idle, 0.00px/s
- parked story has zero idle movement: pass
- physical coast metrics: 2808.00px/s initial, 2363.4ms coast, 0.9744 beats travel, 0.0256-beat next-centre error, 0 velocity growth samples, 0 backwards samples, 0.000px post-rest movement
- calibrated wheel impulse decays into next dwell: pass
- mid-coast blend metrics: 1274.16→2958.96px/s, 0.000000px/s additive error, 0.000px input-frame jump, 24.000px next-frame travel
- mid-coast wheel input blends continuously: pass
- floor labels without zone geometry: pass
- staging visible source: /assets/renders/sejour-bord-de-mer.webp
- staging dissolve: pass
- chambre1 visible source: /assets/renders/chambre1-japandi.webp
- bedroom and shower-room photo cards: pass
- persistent mini-plan camera marker: pass
- sun scrub 8h/13h/20h: pass
- plan hover and click-fly: pass
- walkthrough step and Esc resume: pass
- automatic initialization-failure fallback: pass

Screenshots written:

- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-beat-0-hero.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-beat-1-floor.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-beat-2-sejour.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-beat-3-staging.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-beat-4-balcon.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-beat-5-chambre1.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-beat-6-salledeau.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-beat-7-chambres.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-beat-8-plan.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-hero-en.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-docs.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/webgl2-docs-full.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feedback-docs-diagnostics.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feedback-lightbox-open.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feedback-floor-labels-only.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/renders-webgl2-staging-real.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p2-webgl2-staging-dissolve.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/renders-webgl2-chambre1-japandi.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feedback-chambre1-thumbnail.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feedback-salledeau-thumbnail.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/renders-webgl2-mini-plan-interior.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p2-webgl2-sun-8h.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p2-webgl2-sun-13h.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p2-webgl2-sun-20h.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p2-webgl2-plan-hover.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feedback-plan-orientation.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p2-webgl2-plan-click-fly.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p2-webgl2-walkthrough-enter.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/renders-webgl2-mini-plan-walkthrough.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p2-webgl2-walkthrough-step.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p2-webgl2-walkthrough-resume.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/fallback-recovery.png

Assertion failures:

- None

## Hardening probes

Console errors: 0

Page errors: 0

Screenshots:

- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p3-mobile-hero.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feedback-mobile-chambre1.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/feedback-mobile-salledeau.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p3-mobile-plan.png
- /Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/p3-door-approach.png

Assertion failures:

- None
