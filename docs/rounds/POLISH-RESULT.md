Implemented all three polish items.

- Bathroom camera: `eye [-7.55, 1.5, 6.5]`, `target [-8.65, 0.9, 7.65]`, `fov 78`. The wider FOV was needed to avoid clipping both fixtures. Updated in [config.js](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/config.js:38).
- Desktop offsets: Chambre 1 `0.20`; salle d’eau `0.14`, with mobile behavior unchanged. See [story.js](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/story.js:36).
- All visible FR/EN apostrophes normalized to `’` in [copy.js](/Users/wawa/Documents/Projects/pascal/apartment-listing/src/copy.js:78).

Evidence:

- [Reframed salle d’eau beat](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/polish-salledeau-reframed.png)
- [Offset Chambre 1 beat](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/polish-chambre1-offset.png)
- Bathroom calibration: [blend](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/salledeau-blend.png), [model](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/salledeau-model.png), [photo](/Users/wawa/Documents/Projects/pascal/apartment-listing/scratchpad/verify/salledeau-photo.png)

Checks passed:

- Visible-string straight-apostrophe grep: `0`
- Forced-WebGL production verification: all nine beats reached, zero console/page errors
- Runtime FR/EN visible-text scan: zero straight apostrophes
- `bun run build`: passed
- Calibration regeneration: zero console/page errors