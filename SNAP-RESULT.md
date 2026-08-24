Implemented SCROLL FEEL v3 full soft snap.

- Removed the 0.33-beat capture gate.
- Added velocity-directional targeting with a 0.03 beat/s threshold.
- Preserved the velocity-matched, no-overshoot spring.
- Duration scales from 500–1100ms.
- Preserved all exclusions and instant input cancellation.
- Added zero-velocity, directional, cancellation, and document-boundary probes.

Verification passed on WebGL2:

- Rest +0.45: 770ms, 0px error/overshoot.
- Forward +0.45: next center in 830ms, 0px backward movement/overshoot.
- Wheel cancellation: 0.2ms, 0px subsequent movement.
- Last beat: 0px center error, 0px document-scroll drift.
- Console/page errors: 0.
- `bun run build`: pass.

Evidence: [SNAP-RESULT.md](/Users/wawa/Documents/Projects/pascal/apartment-listing/SNAP-RESULT.md:1)  
Implementation: [story.js](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:579)  
Probes: [verify.mjs](/Users/wawa/Documents/Projects/pascal/apartment-listing/scripts/verify.mjs:549)